import type { Edge, Node } from '@xyflow/react'
import { MarkerType } from '@xyflow/react'
import { markingActionLabel, type MarkingNode } from '@/services/markings'

const H_GAP = 220
const V_GAP = 120
const NODE_W = 180
const NODE_H = 88

export type MarkingFlowOrientation = 'vertical' | 'horizontal'

export type MarkingFlowNodeData = {
  kind: 'root' | 'marking'
  label: string
  subtitle?: string
  action?: string
  actionLabel?: string
  status?: string
  dueAt?: string
  fromUser?: string
  toUser?: string
  instructions?: string
  clientIp?: string
  createdAt?: string
  markingId?: number
  batchId?: number
  orientation: MarkingFlowOrientation
}

export type MarkingFlowNode = Node<MarkingFlowNodeData, 'markingPerson'>

type LayoutResult = { nodes: MarkingFlowNode[]; edges: Edge[] }

/** Drop revoked markings (and their subtrees) from the pathway graph. */
function visibleChildren(node: MarkingNode): MarkingNode[] {
  return (node.children ?? []).filter((c) => c.status !== 'revoked').map(stripRevokedDescendants)
}

function stripRevokedDescendants(node: MarkingNode): MarkingNode {
  return { ...node, children: visibleChildren(node) }
}

function filterTree(tree: MarkingNode[]): MarkingNode[] {
  return tree.filter((n) => n.status !== 'revoked').map(stripRevokedDescendants)
}

function subtreeWidth(node: MarkingNode): number {
  const kids = visibleChildren(node)
  if (!kids.length) return 1
  return kids.reduce((sum, c) => sum + subtreeWidth(c), 0)
}

function positionAt(
  depth: number,
  centerSlot: number,
  orientation: MarkingFlowOrientation,
): { x: number; y: number } {
  if (orientation === 'horizontal') {
    return {
      x: depth * H_GAP,
      y: centerSlot * V_GAP - NODE_H / 2,
    }
  }
  return {
    x: centerSlot * H_GAP - NODE_W / 2,
    y: depth * V_GAP,
  }
}

function layoutMarking(
  node: MarkingNode,
  depth: number,
  leftSlot: number,
  parentId: string,
  orientation: MarkingFlowOrientation,
  nodes: MarkingFlowNode[],
  edges: Edge[],
): number {
  const width = subtreeWidth(node)
  const centerSlot = leftSlot + width / 2
  const id = `m-${node.id}`

  nodes.push({
    id,
    type: 'markingPerson',
    position: positionAt(depth, centerSlot, orientation),
    data: {
      kind: 'marking',
      label: node.toUser,
      subtitle: `from ${node.fromUser}`,
      action: node.action,
      actionLabel: markingActionLabel(node.action),
      status: node.status,
      dueAt: node.dueAt || undefined,
      fromUser: node.fromUser,
      toUser: node.toUser,
      instructions: node.instructions || undefined,
      clientIp: node.clientIp || undefined,
      createdAt: node.createdAt || undefined,
      markingId: node.id,
      batchId: node.batchId,
      orientation,
    },
    draggable: false,
    connectable: false,
  })

  edges.push({
    id: `e-${parentId}-${id}`,
    source: parentId,
    target: id,
    type: 'smoothstep',
    animated: node.status === 'active',
    style: {
      stroke: '#64748b',
      strokeWidth: 1.5,
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: '#64748b',
      width: 14,
      height: 14,
    },
    label: markingActionLabel(node.action),
    labelStyle: { fontSize: 9, fill: '#64748b' },
    selectable: false,
    focusable: false,
    deletable: false,
  })

  let slot = leftSlot
  for (const child of visibleChildren(node)) {
    const w = subtreeWidth(child)
    layoutMarking(child, depth + 1, slot, id, orientation, nodes, edges)
    slot += w
  }
  return width
}

/** Build React Flow nodes/edges from marking tree + initiator root (revoked omitted). */
export function buildMarkingFlowGraph(
  tree: MarkingNode[],
  initiatorName: string,
  orientation: MarkingFlowOrientation = 'vertical',
): LayoutResult {
  const nodes: MarkingFlowNode[] = []
  const edges: Edge[] = []
  const rootId = 'root'
  const name = (initiatorName || '').trim() || 'Initiator'
  const visible = filterTree(tree)

  const rootsWidth = visible.length ? visible.reduce((s, n) => s + subtreeWidth(n), 0) : 1
  const rootCenter = rootsWidth / 2

  nodes.push({
    id: rootId,
    type: 'markingPerson',
    position: positionAt(0, rootCenter, orientation),
    data: {
      kind: 'root',
      label: name,
      subtitle: 'Initiator',
      status: 'root',
      actionLabel: 'Registered',
      orientation,
    },
    draggable: false,
    connectable: false,
  })

  let slot = 0
  for (const child of visible) {
    const w = subtreeWidth(child)
    layoutMarking(child, 1, slot, rootId, orientation, nodes, edges)
    slot += w
  }

  return { nodes, edges }
}
