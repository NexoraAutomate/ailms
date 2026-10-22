'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Badge } from '@/components/cms/ui'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/datetime'
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
      className={`min-w-[160px] max-w-[200px] rounded-lg border bg-white px-3 py-2 shadow-sm transition ${
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
        {data.actionLabel ? <Badge tone="blue">{data.actionLabel}</Badge> : null}
        {data.status && data.status !== 'root' ? (
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
}: {
  tree: MarkingNode[]
  initiatorName: string
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
  const [selected, setSelected] = useState<MarkingFlowNodeData | null>(null)

  useEffect(() => {
    setNodes(graph.nodes)
    setEdges(graph.edges)
    setSelected(null)
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
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.35}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, node) => setSelected(node.data)}
          onPaneClick={() => setSelected(null)}
        >
          <Background gap={16} size={1} color="#e2e8f0" />
          <Controls showInteractive={false} />
          <FitViewOnChange orientation={orientation} />
        </ReactFlow>
      </div>
      {selected ? (
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
          <p className="font-semibold text-slate-800">{selected.label}</p>
          {selected.kind === 'marking' ? (
            <dl className="mt-1 grid gap-0.5 sm:grid-cols-2">
              <div>
                <dt className="text-[10px] uppercase text-slate-400">From</dt>
                <dd>{selected.fromUser}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase text-slate-400">To</dt>
                <dd>{selected.toUser}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase text-slate-400">Action</dt>
                <dd>{selected.actionLabel}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase text-slate-400">Status</dt>
                <dd>{selected.status}</dd>
              </div>
              {selected.batchId != null ? (
                <div>
                  <dt className="text-[10px] uppercase text-slate-400">Batch</dt>
                  <dd>#{selected.batchId}</dd>
                </div>
              ) : null}
              {selected.createdAt ? (
                <div>
                  <dt className="text-[10px] uppercase text-slate-400">Marked</dt>
                  <dd>{formatDateTime(selected.createdAt)}</dd>
                </div>
              ) : null}
              {selected.clientIp ? (
                <div>
                  <dt className="text-[10px] uppercase text-slate-400">IP</dt>
                  <dd>{selected.clientIp}</dd>
                </div>
              ) : null}
              {selected.instructions ? (
                <div className="sm:col-span-2">
                  <dt className="text-[10px] uppercase text-slate-400">Instructions</dt>
                  <dd className="whitespace-pre-wrap">{selected.instructions}</dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <p className="mt-1 text-slate-500">Correspondence initiator (root hold).</p>
          )}
        </div>
      ) : (
        <p className="text-[10px] text-slate-400">Click a person to see marking details.</p>
      )}
    </div>
  )
}

export function MarkingHistoryFlow({
  tree,
  initiatorName,
}: {
  tree: MarkingNode[]
  initiatorName: string
}) {
  return (
    <ReactFlowProvider>
      <MarkingHistoryFlowInner tree={tree} initiatorName={initiatorName} />
    </ReactFlowProvider>
  )
}
