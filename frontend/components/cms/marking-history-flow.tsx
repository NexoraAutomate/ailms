'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type EdgeProps,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Badge } from '@/components/cms/ui'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/lib/datetime'
import { cn } from '@/lib/utils'
import {
  buildMarkingFlowGraph,
  type MarkingFlowNode,
  type MarkingFlowNodeData,
  type MarkingFlowOrientation,
} from '@/lib/marking-flow-layout'
import type { MarkingNode } from '@/services/markings'

const ORIENTATION_KEY = 'ailms.markingFlow.orientation'

function readOrientation(): MarkingFlowOrientation {
  if (typeof window === 'undefined') return 'vertical'
  try {
    const raw = localStorage.getItem(ORIENTATION_KEY)
    return raw === 'horizontal' ? 'horizontal' : 'vertical'
  } catch {
    return 'vertical'
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

function MarkingPersonNode({ data, selected }: NodeProps<MarkingFlowNode>) {
  const horizontal = data.orientation === 'horizontal'
  return (
    <div
      className={`min-w-[160px] max-w-[200px] cursor-pointer rounded-lg border bg-white px-3 py-2 shadow-sm transition ${
        selected ? 'border-[#1769aa] ring-2 ring-[#1769aa]/20' : 'border-slate-200'
      }`}
    >
      <Handle
        type="target"
        position={horizontal ? Position.Left : Position.Top}
        className="!h-2 !w-2 !border-2 !border-white !bg-[#0d3763]"
      />
      <p className="truncate text-xs font-bold text-[#102a43]">{data.label}</p>
      {data.subtitle ? <p className="truncate text-[10px] text-slate-500">{data.subtitle}</p> : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {data.actionLabel ? (
          <Badge tone={data.direction === 'reply' ? 'violet' : 'blue'}>{data.actionLabel}</Badge>
        ) : null}
        {data.status === 'active' && data.createdAt ? (
          <Badge tone="green">{formatDate(data.createdAt)}</Badge>
        ) : data.status && data.status !== 'root' && data.status !== 'active' ? (
          <Badge tone={statusTone(data.status)}>{data.status}</Badge>
        ) : null}
      </div>
      {data.dueAt ? <p className="mt-1 text-[10px] text-amber-700">Due {data.dueAt}</p> : null}
      <Handle
        type="source"
        position={horizontal ? Position.Right : Position.Bottom}
        className="!h-2 !w-2 !border-2 !border-white !bg-[#0d3763]"
      />
    </div>
  )
}

const nodeTypes = { markingPerson: MarkingPersonNode }

/**
 * U-turn edge for reply markings placed beside their source at the same depth.
 * Vertical: loops below the pair. Horizontal: loops to the side.
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
    // Side-by-side (vertical layout) — U-turn under both nodes.
    const bottom = Math.max(sourceY, targetY) + bulge
    path = `M ${sourceX},${sourceY} C ${sourceX},${bottom} ${targetX},${bottom} ${targetX},${targetY}`
    labelX = (sourceX + targetX) / 2
    labelY = bottom
  } else {
    // Stacked (horizontal layout) — U-turn to the outer side.
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
              color: (labelStyle as { fill?: string } | undefined)?.fill ?? '#7c3aed',
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

function FitViewOnChange({ orientation }: { orientation: MarkingFlowOrientation }) {
  const { fitView } = useReactFlow()
  useEffect(() => {
    const id = window.setTimeout(() => {
      void fitView({ padding: 0.2, duration: 200 })
    }, 50)
    return () => window.clearTimeout(id)
  }, [orientation, fitView])
  return null
}

function MarkingHistoryFlowInner({
  tree,
  initiatorName,
  onMarkingClick,
}: {
  tree: MarkingNode[]
  initiatorName: string
  onMarkingClick?: (data: MarkingFlowNodeData) => void
}) {
  const [orientation, setOrientation] = useState<MarkingFlowOrientation>('vertical')

  useEffect(() => {
    setOrientation(readOrientation())
  }, [])

  const graph = useMemo(
    () => buildMarkingFlowGraph(tree, initiatorName, orientation),
    [tree, initiatorName, orientation],
  )
  const [nodes, setNodes, onNodesChange] = useNodesState<MarkingFlowNode>(graph.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(graph.edges)

  useEffect(() => {
    setNodes(graph.nodes)
    setEdges(graph.edges)
  }, [graph, setNodes, setEdges])

  const setOrient = (next: MarkingFlowOrientation) => {
    setOrientation(next)
    writeOrientation(next)
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Marking pathway
        </p>
        <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5">
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
        </div>
      </div>
      <div className="h-[320px] min-h-[280px] overflow-hidden rounded-xl border border-slate-200 bg-slate-50 md:h-[400px]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          zoomOnScroll={false}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.35}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, node) => {
            if (node.data.kind === 'marking' || node.data.kind === 'root') {
              onMarkingClick?.(node.data)
            }
          }}
        >
          <Background gap={16} size={1} color="#e2e8f0" />
          <Controls showInteractive={false} />
          <FitViewOnChange orientation={orientation} />
        </ReactFlow>
      </div>
      <p className="text-[10px] text-slate-400">
        Click your node to view your comments and attachments; other nodes jump to the timeline.
      </p>
    </div>
  )
}

export function MarkingHistoryFlow({
  tree,
  initiatorName,
  onMarkingClick,
}: {
  tree: MarkingNode[]
  initiatorName: string
  onMarkingClick?: (data: MarkingFlowNodeData) => void
}) {
  return (
    <ReactFlowProvider>
      <MarkingHistoryFlowInner
        tree={tree}
        initiatorName={initiatorName}
        onMarkingClick={onMarkingClick}
      />
    </ReactFlowProvider>
  )
}
