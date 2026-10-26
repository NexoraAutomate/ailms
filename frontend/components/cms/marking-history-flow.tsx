'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  NodeToolbar,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './marking-history-flow.css'
import {
  Eraser,
  Maximize2,
  Minimize2,
  MousePointer2,
  Pencil,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { Badge } from '@/components/cms/ui'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/lib/datetime'
import { strokeToSvgPath, type FreehandPoint } from '@/lib/freehand-path'
import { cn } from '@/lib/utils'
import {
  buildMarkingFlowGraph,
  DEFAULT_VISIBLE_FIELDS,
  MARKING_FLOW_FIELD_OPTIONS,
  type MarkingFlowFieldKey,
  type MarkingFlowNode,
  type MarkingFlowNodeData,
  type MarkingFlowOrientation,
} from '@/lib/marking-flow-layout'
import type { MarkingNode } from '@/services/markings'

const ORIENTATION_KEY = 'ailms.markingFlow.orientation'
const DRAFT_ID = '__draft-freehand'
const DRAW_COLORS = ['#38bdf8', '#ec4899', '#a3e635', '#f97316', '#f8fafc', '#facc15']

type InteractionMode = 'select' | 'draw' | 'erase'
type FieldScope = 'selected' | 'all'

type FreehandNodeData = {
  path: string
  color: string
  width: number
  height: number
}

type FlowNode = MarkingFlowNode | Node<FreehandNodeData, 'freehandStroke'>

function readOrientation(): MarkingFlowOrientation {
  if (typeof window === 'undefined') return 'horizontal'
  try {
    const raw = localStorage.getItem(ORIENTATION_KEY)
    if (raw === 'vertical') return 'vertical'
    return 'horizontal'
  } catch {
    return 'horizontal'
  }
}

function writeOrientation(next: MarkingFlowOrientation) {
  try {
    localStorage.setItem(ORIENTATION_KEY, next)
  } catch {
    /* ignore */
  }
}

function statusTone(status?: string): string {
  switch (status) {
    case 'active':
      return 'green'
    case 'responded':
      return 'blue'
    case 'superseded':
      return 'slate'
    case 'root':
      return 'slate'
    default:
      return 'slate'
  }
}

function effectiveFields(
  nodeId: string,
  globalFields: Record<MarkingFlowFieldKey, boolean>,
  overrides: Record<string, Partial<Record<MarkingFlowFieldKey, boolean>>>,
): Record<MarkingFlowFieldKey, boolean> {
  return { ...globalFields, ...(overrides[nodeId] || {}) }
}

function MarkingPersonNode({ data, selected }: NodeProps<MarkingFlowNode>) {
  const horizontal = data.orientation === 'horizontal'
  const fields = data.visibleFields || DEFAULT_VISIBLE_FIELDS
  const dual = !!data.hasReplyHandles
  const isReplyNode = !!data.isReplyNode

  // Forward spine: left→right (horizontal) or top→bottom (vertical).
  const forwardIn = horizontal ? Position.Left : Position.Top
  const forwardOut = horizontal ? Position.Right : Position.Bottom

  // Reply recipient faces the replier: inbound on the edge toward the parent.
  // Parent reply source sits on the same facing axis (req: handles face each other).
  let replyInPos = forwardIn
  let replyOutPos = forwardIn
  if (horizontal) {
    // Reply nodes sit above/below and slightly left — face parent on the right edge.
    replyInPos = Position.Right
    // Replier keeps dual handles on the left (receive + reply out toward recipient).
    replyOutPos = Position.Left
  } else {
    replyInPos = Position.Bottom
    replyOutPos = Position.Top
  }

  // Offset dual handles on the shared inbound edge of the replier.
  const dualInStyle = dual
    ? horizontal
      ? { top: '32%' }
      : { left: '32%' }
    : undefined
  const dualReplyStyle = dual
    ? horizontal
      ? { top: '68%' }
      : { left: '68%' }
    : undefined

  return (
    <div
      className={cn(
        'ailms-flow-node cursor-grab active:cursor-grabbing',
        selected && 'is-selected',
        data.isInitiator && 'is-initiator',
        data.isYou && 'is-you',
      )}
    >
      {/* Handles stay outside overflow:hidden so they remain visible */}
      {!isReplyNode ? (
        <Handle
          id="in"
          type="target"
          position={forwardIn}
          className="ailms-flow-handle"
          style={dualInStyle}
        />
      ) : null}
      {isReplyNode ? (
        <Handle
          id="reply-in"
          type="target"
          position={replyInPos}
          className="ailms-flow-handle is-reply"
        />
      ) : null}
      {dual ? (
        <Handle
          id="reply"
          type="source"
          position={replyOutPos}
          className="ailms-flow-handle is-reply"
          style={dualReplyStyle}
        />
      ) : null}
      <Handle id="out" type="source" position={forwardOut} className="ailms-flow-handle" />

      <div className="ailms-flow-node-inner">
        <p
          className={cn(
            'ailms-flow-ribbon',
            data.isYou && 'is-you',
            data.isInitiator && 'is-initiator',
          )}
          title={data.toUser || data.label}
        >
          {data.label}
        </p>

        <div className="ailms-flow-body">
          {fields.subtitle && data.subtitle ? (
            <p className="truncate text-[10px]" style={{ color: 'var(--ailms-node-muted)' }}>
              {data.subtitle}
            </p>
          ) : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {fields.action && data.actionLabel ? (
              <Badge tone={data.direction === 'reply' ? 'violet' : 'blue'}>{data.actionLabel}</Badge>
            ) : null}
            {fields.status && data.status === 'active' && data.createdAt ? (
              <Badge tone="green">{formatDate(data.createdAt)}</Badge>
            ) : fields.status && data.status && data.status !== 'root' && data.status !== 'active' ? (
              <Badge tone={statusTone(data.status)}>{data.status}</Badge>
            ) : null}
            {fields.pathId && data.pathLabel ? <Badge tone="slate">{data.pathLabel}</Badge> : null}
          </div>
          {fields.dueAt && data.dueAt ? (
            <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">Due {data.dueAt}</p>
          ) : null}
          {fields.instructions && data.instructions ? (
            <p className="mt-1 line-clamp-2 text-[10px]" style={{ color: 'var(--ailms-node-muted)' }}>
              {data.instructions}
            </p>
          ) : null}
          {fields.createdAt && data.createdAt && data.status !== 'active' ? (
            <p className="mt-1 text-[10px]" style={{ color: 'var(--ailms-node-muted)' }}>
              {formatDate(data.createdAt)}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function FreehandStrokeNode({ data, selected }: NodeProps<Node<FreehandNodeData, 'freehandStroke'>>) {
  return (
    <svg
      width={data.width}
      height={data.height}
      className={cn(selected && 'opacity-90')}
      style={{ overflow: 'visible', display: 'block' }}
    >
      <path d={data.path} fill={data.color} stroke="none" />
    </svg>
  )
}

const nodeTypes = {
  markingPerson: MarkingPersonNode,
  freehandStroke: FreehandStrokeNode,
}

/**
 * U-turn edge for reply markings placed beside their source at the same depth.
 */
function ReplyUTurnEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  style,
  label,
  labelStyle,
}: EdgeProps) {
  const dx = Math.abs(sourceX - targetX)
  const dy = Math.abs(sourceY - targetY)
  const bulge = 52
  let path: string
  let labelX: number
  let labelY: number

  if (dx >= dy) {
    const bottom = Math.max(sourceY, targetY) + bulge
    path = `M ${sourceX},${sourceY} C ${sourceX},${bottom} ${targetX},${bottom} ${targetX},${targetY}`
    labelX = (sourceX + targetX) / 2
    labelY = bottom
  } else {
    const side = Math.max(sourceX, targetX) + bulge
    path = `M ${sourceX},${sourceY} C ${side},${sourceY} ${side},${targetY} ${targetX},${targetY}`
    labelX = side
    labelY = (sourceY + targetY) / 2
  }

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute text-[9px] font-semibold"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              color: (labelStyle as { fill?: string } | undefined)?.fill ?? '#a855f7',
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}

const edgeTypes = { replyUTurn: ReplyUTurnEdge }

function FitViewOnChange({
  orientation,
  treeKey,
}: {
  orientation: MarkingFlowOrientation
  treeKey: string
}) {
  const { fitView } = useReactFlow()
  useEffect(() => {
    const id = window.setTimeout(() => {
      void fitView({ padding: 0.2, duration: 200 })
    }, 50)
    return () => window.clearTimeout(id)
  }, [orientation, treeKey, fitView])
  return null
}

function pointsToFreehandNode(
  points: FreehandPoint[],
  color: string,
  id: string,
): Node<FreehandNodeData, 'freehandStroke'> | null {
  if (points.length < 2) return null
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const maxX = Math.max(...xs)
  const maxY = Math.max(...ys)
  const pad = 10
  const local: FreehandPoint[] = points.map(([x, y, p]) => [x - minX + pad, y - minY + pad, p])
  const path = strokeToSvgPath(local, { size: 7 })
  if (!path) return null
  return {
    id,
    type: 'freehandStroke',
    position: { x: minX - pad, y: minY - pad },
    data: {
      path,
      color,
      width: Math.max(maxX - minX + pad * 2, 12),
      height: Math.max(maxY - minY + pad * 2, 12),
    },
    draggable: false,
    selectable: true,
    connectable: false,
    deletable: true,
    focusable: false,
  }
}

function MarkingHistoryFlowInner({
  tree,
  initiatorName,
  viewerName,
  onMarkingClick,
}: {
  tree: MarkingNode[]
  initiatorName: string
  viewerName?: string
  onMarkingClick?: (data: MarkingFlowNodeData) => void
}) {
  const [orientation, setOrientation] = useState<MarkingFlowOrientation>('horizontal')
  const [mode, setMode] = useState<InteractionMode>('select')
  const [drawColor, setDrawColor] = useState(DRAW_COLORS[0]!)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [globalFields, setGlobalFields] =
    useState<Record<MarkingFlowFieldKey, boolean>>(DEFAULT_VISIBLE_FIELDS)
  const [fieldOverrides, setFieldOverrides] = useState<
    Record<string, Partial<Record<MarkingFlowFieldKey, boolean>>>
  >({})
  const [fieldScope, setFieldScope] = useState<FieldScope>('all')
  const [fieldsOpen, setFieldsOpen] = useState(true)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const drawingRef = useRef(false)
  const draftPointsRef = useRef<FreehandPoint[]>([])
  const rf = useReactFlow()

  useEffect(() => {
    setOrientation(readOrientation())
  }, [])

  const graph = useMemo(
    () => buildMarkingFlowGraph(tree, initiatorName, orientation, viewerName),
    [tree, initiatorName, orientation, viewerName],
  )
  const treeKey = useMemo(
    () => tree.map((n) => `${n.id}:${n.status}:${(n.children || []).length}`).join('|'),
    [tree],
  )

  const annotateMarkingNodes = useCallback(
    (markingNodes: MarkingFlowNode[]): MarkingFlowNode[] =>
      markingNodes.map((n) => ({
        ...n,
        data: {
          ...n.data,
          visibleFields: effectiveFields(n.id, globalFields, fieldOverrides),
        },
      })),
    [globalFields, fieldOverrides],
  )

  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(annotateMarkingNodes(graph.nodes))
  const [edges, setEdges, onEdgesChange] = useEdgesState(graph.edges)
  const resetLayoutRef = useRef(false)

  useEffect(() => {
    setNodes((prev) => {
      const drawings = prev.filter((n) => n.type === 'freehandStroke' && n.id !== DRAFT_ID)
      const prevMarkingIds = new Set(
        prev.filter((n) => n.type === 'markingPerson').map((n) => n.id),
      )
      const nextIds = new Set(graph.nodes.map((n) => n.id))
      // Structure changed (new/missing hops) → re-apply full spine layout so
      // fan-out children are not left stacked or off-canvas from old positions.
      const structureChanged =
        resetLayoutRef.current ||
        prevMarkingIds.size !== nextIds.size ||
        [...nextIds].some((id) => !prevMarkingIds.has(id))

      if (structureChanged) {
        resetLayoutRef.current = false
        window.setTimeout(() => {
          void rf.fitView({ padding: 0.22, duration: 220 })
        }, 60)
        return [...annotateMarkingNodes(graph.nodes), ...drawings] as FlowNode[]
      }
      const prevById = new Map(prev.map((n) => [n.id, n]))
      const nextMarking = annotateMarkingNodes(graph.nodes).map((n) => {
        const existing = prevById.get(n.id)
        return existing && existing.type === 'markingPerson'
          ? { ...n, position: existing.position }
          : n
      })
      return [...nextMarking, ...drawings] as FlowNode[]
    })
    setEdges(graph.edges)
  }, [graph, annotateMarkingNodes, rf, setNodes, setEdges])

  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => {
        if (n.type !== 'markingPerson') return n
        return {
          ...n,
          data: {
            ...n.data,
            visibleFields: effectiveFields(n.id, globalFields, fieldOverrides),
          },
        }
      }) as FlowNode[],
    )
  }, [globalFields, fieldOverrides, setNodes])

  useEffect(() => {
    const onFs = () => {
      const el = containerRef.current
      setIsFullscreen(!!el && document.fullscreenElement === el)
    }
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  const setOrient = (next: MarkingFlowOrientation) => {
    resetLayoutRef.current = true
    setOrientation(next)
    writeOrientation(next)
  }

  /** Re-apply serial-06 spine layout (straight chain + equal fan-out) and fit view. */
  const resetAlignment = useCallback(() => {
    resetLayoutRef.current = true
    setNodes((prev) => {
      const drawings = prev.filter((n) => n.type === 'freehandStroke' && n.id !== DRAFT_ID)
      return [...annotateMarkingNodes(graph.nodes), ...drawings] as FlowNode[]
    })
    setEdges(graph.edges)
    window.setTimeout(() => {
      void rf.fitView({ padding: 0.2, duration: 280 })
    }, 40)
  }, [annotateMarkingNodes, graph.edges, graph.nodes, rf, setEdges, setNodes])

  const toggleFullscreen = async () => {
    const el = containerRef.current
    if (!el) return
    try {
      if (document.fullscreenElement === el) {
        await document.exitFullscreen()
      } else {
        await el.requestFullscreen()
      }
    } catch {
      // Fallback CSS fullscreen when Fullscreen API is blocked.
      setIsFullscreen((v) => !v)
    }
  }

  const clearAllDrawings = () => {
    setNodes((prev) => prev.filter((n) => n.type !== 'freehandStroke') as FlowNode[])
  }

  const eraseOneDrawing = (nodeId: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== nodeId) as FlowNode[])
  }

  const setField = (key: MarkingFlowFieldKey, value: boolean) => {
    if (fieldScope === 'all' || !selectedNodeId) {
      setGlobalFields((prev) => ({ ...prev, [key]: value }))
      return
    }
    setFieldOverrides((prev) => ({
      ...prev,
      [selectedNodeId]: { ...(prev[selectedNodeId] || {}), [key]: value },
    }))
  }

  const toolbarFields =
    fieldScope === 'selected' && selectedNodeId
      ? effectiveFields(selectedNodeId, globalFields, fieldOverrides)
      : globalFields

  const isDrawUiTarget = (target: EventTarget | null) => {
    const el = target as HTMLElement | null
    if (!el?.closest) return false
    return !!el.closest(
      '.react-flow__panel, .react-flow__controls, .react-flow__minimap, .ailms-flow-draw-ui',
    )
  }

  const onDrawPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (mode !== 'draw') return
    if (isDrawUiTarget(event.target)) return
    if ((event.target as HTMLElement).closest?.('.react-flow__node-markingPerson')) return
    event.preventDefault()
    ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
    drawingRef.current = true
    const { x, y } = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY })
    draftPointsRef.current = [[x, y, event.pressure || 0.5]]
    const draft = pointsToFreehandNode(draftPointsRef.current, drawColor, DRAFT_ID)
    if (draft) {
      setNodes((prev) => [...prev.filter((n) => n.id !== DRAFT_ID), draft] as FlowNode[])
    }
  }

  const onDrawPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawingRef.current || mode !== 'draw') return
    const { x, y } = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY })
    draftPointsRef.current = [...draftPointsRef.current, [x, y, event.pressure || 0.5]]
    const draft = pointsToFreehandNode(draftPointsRef.current, drawColor, DRAFT_ID)
    if (draft) {
      setNodes((prev) => {
        const without = prev.filter((n) => n.id !== DRAFT_ID)
        return [...without, draft] as FlowNode[]
      })
    }
  }

  const finishStroke = (event?: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawingRef.current) return
    drawingRef.current = false
    if (event) {
      try {
        ;(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId)
      } catch {
        /* ignore */
      }
    }
    const pts = draftPointsRef.current
    draftPointsRef.current = []
    const final = pointsToFreehandNode(
      pts,
      drawColor,
      `draw-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    )
    setNodes((prev) => {
      const without = prev.filter((n) => n.id !== DRAFT_ID)
      return final ? ([...without, final] as FlowNode[]) : (without as FlowNode[])
    })
  }

  const selectedMarking = nodes.find(
    (n) => n.id === selectedNodeId && n.type === 'markingPerson',
  ) as MarkingFlowNode | undefined

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Marking pathway
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="h-7 gap-1 px-2.5 text-[11px]"
            onClick={resetAlignment}
            title="Reset nodes to straight-line layout (fan-out above/below)"
          >
            <RotateCcw className="size-3.5" />
            Reset alignment
          </Button>
          <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5 dark:border-slate-200 dark:bg-slate-100">
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className={cn(
                'h-7 px-2.5 text-[11px]',
                orientation === 'horizontal' && 'bg-slate-100 font-semibold text-slate-800',
              )}
              onClick={() => setOrient('horizontal')}
            >
              Horizontal
            </Button>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className={cn(
                'h-7 px-2.5 text-[11px]',
                orientation === 'vertical' && 'bg-slate-100 font-semibold text-slate-800',
              )}
              onClick={() => setOrient('vertical')}
            >
              Vertical
            </Button>
          </div>
        </div>
      </div>

      <div
        ref={containerRef}
        className={cn(
          'ailms-marking-flow relative h-[min(52vh,420px)] min-h-[260px] overflow-hidden rounded-xl border border-slate-200 md:h-[440px]',
          mode === 'draw' && 'draw-mode',
          mode === 'erase' && 'erase-mode',
          isFullscreen && 'is-fullscreen h-screen min-h-screen',
        )}
        style={{ background: 'var(--ailms-flow-bg)' }}
        onPointerDown={onDrawPointerDown}
        onPointerMove={onDrawPointerMove}
        onPointerUp={finishStroke}
        onPointerCancel={finishStroke}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={mode === 'select'}
          nodesConnectable={false}
          elementsSelectable={mode !== 'draw'}
          panOnDrag={mode !== 'draw'}
          selectionOnDrag={false}
          zoomOnScroll
          zoomOnPinch
          zoomOnDoubleClick={mode === 'select'}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          maxZoom={2.5}
          proOptions={{ hideAttribution: true }}
          deleteKeyCode={null}
          onPaneClick={() => {
            if (mode === 'select') setSelectedNodeId(null)
          }}
          onNodeClick={(_, node) => {
            if (mode === 'erase') {
              if (node.type === 'freehandStroke') eraseOneDrawing(node.id)
              return
            }
            if (mode === 'draw') return
            setSelectedNodeId(node.id)
            if (node.type === 'markingPerson') {
              onMarkingClick?.(node.data as MarkingFlowNodeData)
            }
          }}
        >
          <Background gap={18} size={1} color="var(--ailms-flow-dot)" />
          <Controls showInteractive={false} className="!shadow-md" />
          <FitViewOnChange orientation={orientation} treeKey={treeKey} />

          {/* Top-left: selection vs draw (+ erase / color) */}
          <Panel position="top-left" className="ailms-flow-draw-ui m-2 flex max-w-[min(100%,320px)] flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white/95 p-1 shadow-sm backdrop-blur dark:border-slate-300 dark:bg-slate-100/95">
              <Button
                type="button"
                size="xs"
                variant={mode === 'select' ? 'default' : 'ghost'}
                className="h-7 gap-1 px-2 text-[11px]"
                onClick={() => setMode('select')}
                title="Selection mode"
              >
                <MousePointer2 className="size-3.5" />
                <span className="hidden sm:inline">Select</span>
              </Button>
              <Button
                type="button"
                size="xs"
                variant={mode === 'draw' ? 'default' : 'ghost'}
                className="h-7 gap-1 px-2 text-[11px]"
                onClick={() => setMode('draw')}
                title="Draw mode"
              >
                <Pencil className="size-3.5" />
                <span className="hidden sm:inline">Draw</span>
              </Button>
              <Button
                type="button"
                size="xs"
                variant={mode === 'erase' ? 'default' : 'ghost'}
                className="h-7 gap-1 px-2 text-[11px]"
                onClick={() => setMode('erase')}
                title="Erase drawings (nodes untouched)"
              >
                <Eraser className="size-3.5" />
                <span className="hidden sm:inline">Erase</span>
              </Button>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="h-7 gap-1 px-2 text-[11px] text-rose-600"
                onClick={clearAllDrawings}
                title="Clear all drawings"
              >
                <Trash2 className="size-3.5" />
                <span className="hidden sm:inline">Clear</span>
              </Button>
            </div>
            {(mode === 'draw' || mode === 'erase') && (
              <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white/95 px-2 py-1.5 shadow-sm dark:border-slate-300 dark:bg-slate-100/95">
                <span className="text-[10px] font-medium text-slate-500">Ink</span>
                {DRAW_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Color ${c}`}
                    className={cn(
                      'size-5 rounded-full border-2 transition',
                      drawColor === c ? 'border-slate-800 scale-110' : 'border-transparent',
                    )}
                    style={{ background: c }}
                    onClick={() => {
                      setDrawColor(c)
                      setMode('draw')
                    }}
                  />
                ))}
                <input
                  type="color"
                  value={drawColor.startsWith('#') && drawColor.length === 7 ? drawColor : '#38bdf8'}
                  aria-label="Custom draw color"
                  className="h-6 w-7 cursor-pointer rounded border border-slate-200 bg-transparent p-0"
                  onChange={(e) => {
                    setDrawColor(e.target.value)
                    setMode('draw')
                  }}
                />
              </div>
            )}
          </Panel>

          {/* Top-right: fields + fullscreen */}
          <Panel position="top-right" className="ailms-flow-draw-ui m-2 flex flex-col items-end gap-1.5">
            <div className="flex flex-wrap items-center justify-end gap-1 rounded-lg border border-slate-200 bg-white/95 p-1 shadow-sm dark:border-slate-300 dark:bg-slate-100/95">
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="h-7 gap-1 px-2 text-[11px]"
                onClick={resetAlignment}
                title="Reset alignment to straight spine"
              >
                <RotateCcw className="size-3.5" />
                <span className="hidden sm:inline">Reset</span>
              </Button>
              <Button
                type="button"
                size="xs"
                variant={fieldsOpen ? 'default' : 'ghost'}
                className="h-7 px-2 text-[11px]"
                onClick={() => setFieldsOpen((v) => !v)}
                title="Show or hide field toggles"
              >
                Fields
              </Button>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="h-7 gap-1 px-2 text-[11px]"
                onClick={() => void toggleFullscreen()}
                title={isFullscreen ? 'Exit full screen' : 'Full screen'}
              >
                {isFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                <span className="hidden sm:inline">{isFullscreen ? 'Exit' : 'Full screen'}</span>
              </Button>
            </div>
            {fieldsOpen ? (
              <div className="w-[min(100vw-2rem,240px)] rounded-lg border border-slate-200 bg-white/95 p-2 shadow-sm dark:border-slate-300 dark:bg-slate-100/95">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Node fields
                  </p>
                  <div className="inline-flex rounded border border-slate-200 p-0.5">
                    <button
                      type="button"
                      className={cn(
                        'rounded px-1.5 py-0.5 text-[10px]',
                        fieldScope === 'all' && 'bg-slate-200 font-semibold',
                      )}
                      onClick={() => setFieldScope('all')}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      className={cn(
                        'rounded px-1.5 py-0.5 text-[10px]',
                        fieldScope === 'selected' && 'bg-slate-200 font-semibold',
                        !selectedMarking && 'opacity-40',
                      )}
                      disabled={!selectedMarking}
                      onClick={() => setFieldScope('selected')}
                    >
                      Selected
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                  {MARKING_FLOW_FIELD_OPTIONS.map((opt) => (
                    <label
                      key={opt.key}
                      className="flex cursor-pointer items-center gap-1.5 text-[10px] text-slate-600"
                    >
                      <input
                        type="checkbox"
                        className="size-3 accent-[#1769aa]"
                        checked={!!toolbarFields[opt.key]}
                        onChange={(e) => setField(opt.key, e.target.checked)}
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
          </Panel>

          {selectedMarking ? (
            <NodeToolbar
              nodeId={selectedMarking.id}
              isVisible={mode === 'select'}
              position={Position.Top}
              className="rounded-md border border-slate-200 bg-white/95 px-2 py-1 text-[10px] shadow-sm dark:border-slate-300 dark:bg-slate-100/95"
            >
              <span className="font-semibold text-slate-600">
                {selectedMarking.data.label}
                {selectedMarking.data.isYou ? ' (you)' : ''}
              </span>
              <span className="mx-1 text-slate-300">·</span>
              <span className="text-slate-500">Toggle fields in the Fields panel</span>
            </NodeToolbar>
          ) : null}
        </ReactFlow>
      </div>
      <p className="text-[10px] text-slate-400">
        Drag nodes to rearrange · Reset alignment restores the straight spine (fan-out above/below) ·
        scroll to zoom · Select/Draw/Erase for annotations · click your node for comments and
        attachments.
      </p>
    </div>
  )
}

export function MarkingHistoryFlow({
  tree,
  initiatorName,
  viewerName,
  onMarkingClick,
}: {
  tree: MarkingNode[]
  initiatorName: string
  viewerName?: string
  onMarkingClick?: (data: MarkingFlowNodeData) => void
}) {
  return (
    <ReactFlowProvider>
      <MarkingHistoryFlowInner
        tree={tree}
        initiatorName={initiatorName}
        viewerName={viewerName}
        onMarkingClick={onMarkingClick}
      />
    </ReactFlowProvider>
  )
}
