import type { Edge, Node } from '@xyflow/react'
import { MarkerType } from '@xyflow/react'
import { markingActionLabel, shortPathId, type MarkingNode } from '@/services/markings'

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
  pathId?: string
  pathLabel?: string
  direction?: string
  orientation: MarkingFlowOrientation
}

export type MarkingFlowNode = Node<MarkingFlowNodeData, 'markingPerson'>

type LayoutResult = { nodes: MarkingFlowNode[]; edges: Edge[] }

function isReplyMarking(node: MarkingNode) {
  return (node.direction || '').toLowerCase() === 'reply'
}

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

function forwardChildren(node: MarkingNode): MarkingNode[] {
  return visibleChildren(node).filter((c) => !isReplyMarking(c))
}

function replyChildren(node: MarkingNode): MarkingNode[] {
  return visibleChildren(node).filter((c) => isReplyMarking(c))
}

/**
 * Horizontal span in "slots". Replies sit beside their parent at the same depth,
 * so width is max(forward subtree, 1 + reply count).
 */
function subtreeWidth(node: MarkingNode): number {
  const forwards = forwardChildren(node)
  const replies = replyChildren(node)
  const forwardWidth =
    forwards.length === 0 ? 1 : forwards.reduce((sum, c) => sum + subtreeWidth(c), 0)
  return Math.max(forwardWidth, 1 + replies.length)
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

function pushMarkingNode(
  node: MarkingNode,
  depth: number,
  centerSlot: number,
  orientation: MarkingFlowOrientation,
  nodes: MarkingFlowNode[],
): string {
  const id = `m-${node.id}`
  const pathLabel = shortPathId(node.pathId) || undefined
  nodes.push({
    id,
    type: 'markingPerson',
    position: positionAt(depth, centerSlot, orientation),
    data: {
      kind: 'marking',
      label: node.toUser,
      subtitle: pathLabel
        ? `${isReplyMarking(node) ? '↩' : '←'} ${node.fromUser} · ${pathLabel}`
        : `from ${node.fromUser}`,
      action: node.action,
      actionLabel: isReplyMarking(node) ? 'Reply' : markingActionLabel(node.action),
      status: node.status,
      dueAt: node.dueAt || undefined,
      fromUser: node.fromUser,
      toUser: node.toUser,
      instructions: node.instructions || undefined,
      clientIp: node.clientIp || undefined,
      createdAt: node.createdAt || undefined,
      markingId: node.id,
      batchId: node.batchId,
      pathId: node.pathId || undefined,
      pathLabel,
      direction: node.direction || 'forward',
      orientation,
    },
    draggable: false,
    connectable: false,
  })
  return id
}

function pushEdge(
  parentId: string,
  id: string,
  node: MarkingNode,
  edges: Edge[],
): void {
  const reply = isReplyMarking(node)
  edges.push({
    id: `e-${parentId}-${id}`,
    source: parentId,
    target: id,
    type: reply ? 'replyUTurn' : 'smoothstep',
    animated: node.status === 'active',
    style: {
      stroke: reply ? '#7c3aed' : '#64748b',
      strokeWidth: 1.5,
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: reply ? '#7c3aed' : '#64748b',
      width: 14,
      height: 14,
    },
    label: reply ? 'Reply' : markingActionLabel(node.action),
    labelStyle: {
      fontSize: 9,
      fill: reply ? '#7c3aed' : '#64748b',
    },
    selectable: false,
    focusable: false,
    deletable: false,
  })
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
  const forwards = forwardChildren(node)
  const replies = replyChildren(node)
  const width = subtreeWidth(node)

  // This node sits in the first slot of its span; reply children occupy slots to its side
  // at the same depth (U-turn back), while forwards continue to depth + 1.
  const selfCenter = leftSlot + 0.5
  const id = pushMarkingNode(node, depth, selfCenter, orientation, nodes)
  pushEdge(parentId, id, node, edges)

  replies.forEach((reply, index) => {
    // Same depth as parent ("previous node"); place immediately to the side.
    layoutMarking(reply, depth, leftSlot + 1 + index, id, orientation, nodes, edges)
  })

  let slot = leftSlot
  for (const child of forwards) {
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

  const rootForwards = visible.filter((n) => !isReplyMarking(n))
  const rootReplies = visible.filter((n) => isReplyMarking(n))

  nodes.push({
    id: rootId,
    type: 'markingPerson',
    position: positionAt(0, 0.5, orientation),
    data: {
      kind: 'root',
      label: name,
      subtitle: 'Initiator',
      status: 'root',
      actionLabel: 'Registered',
      toUser: name,
      fromUser: name,
      orientation,
    },
    draggable: false,
    connectable: false,
  })

  rootReplies.forEach((reply, index) => {
    layoutMarking(reply, 0, 1 + index, rootId, orientation, nodes, edges)
  })

  let slot = 0
  for (const child of rootForwards) {
    const w = subtreeWidth(child)
    layoutMarking(child, 1, slot, rootId, orientation, nodes, edges)
    slot += w
  }

  return { nodes, edges }
}
