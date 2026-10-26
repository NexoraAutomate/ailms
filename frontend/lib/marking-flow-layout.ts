import type { Edge, Node } from '@xyflow/react'
import { MarkerType } from '@xyflow/react'
import { markingActionLabel, shortPathId, type MarkingNode } from '@/services/markings'

const H_GAP = 240
const V_GAP = 140
const NODE_W = 188
const NODE_H = 96
/** Pull reply recipient slightly toward the parent so handles face each other. */
const REPLY_DEPTH_PULL = 0.42
const REPLY_LANE_GAP = 0.95

export type MarkingFlowOrientation = 'vertical' | 'horizontal'

export type MarkingFlowFieldKey =
  | 'subtitle'
  | 'action'
  | 'status'
  | 'dueAt'
  | 'instructions'
  | 'pathId'
  | 'createdAt'

export type MarkingFlowNodeData = {
  kind: 'root' | 'marking'
  /** Display name on ribbon — "You" when the node is the logged-in user. */
  label: string
  /** True when label was remapped to "You" for the viewer. */
  isYou?: boolean
  /** True for the letter initiator (root) node. */
  isInitiator?: boolean
  subtitle?: string
  action?: string
  actionLabel?: string
  status?: string
  dueAt?: string
  fromUser?: string
  /** Real holder name (never "You") — used for ACL / click matching. */
  toUser?: string
  instructions?: string
  clientIp?: string
  createdAt?: string
  markingId?: number
  batchId?: number
  pathId?: string
  pathLabel?: string
  direction?: string
  /** Node has reply child(ren) → dual handles on the receive edge. */
  hasReplyHandles?: boolean
  /** This node is a reply recipient — inbound handle faces the replier. */
  isReplyNode?: boolean
  /**
   * Where the reply sits relative to its parent so handles can face:
   * horizontal → above/below; vertical → start/end (left/right).
   */
  replyFace?: 'above' | 'below' | 'start' | 'end'
  /** Per-render field visibility (injected by the flow canvas). */
  visibleFields?: Record<MarkingFlowFieldKey, boolean>
  orientation: MarkingFlowOrientation
}

export type MarkingFlowNode = Node<MarkingFlowNodeData, 'markingPerson'>

export const MARKING_FLOW_FIELD_OPTIONS: { key: MarkingFlowFieldKey; label: string }[] = [
  { key: 'subtitle', label: 'From / path' },
  { key: 'action', label: 'Action' },
  { key: 'status', label: 'Status' },
  { key: 'dueAt', label: 'Due date' },
  { key: 'instructions', label: 'Instructions' },
  { key: 'pathId', label: 'Path id' },
  { key: 'createdAt', label: 'Created' },
]

export const DEFAULT_VISIBLE_FIELDS: Record<MarkingFlowFieldKey, boolean> = {
  subtitle: true,
  action: true,
  status: true,
  dueAt: true,
  instructions: false,
  pathId: false,
  createdAt: false,
}

type LayoutResult = { nodes: MarkingFlowNode[]; edges: Edge[] }

/** Base strokes; dark-mode hover/overrides live in marking-history-flow.css */
const FORWARD_STROKE = '#64748b'
const REPLY_STROKE = '#a855f7'

function sameUser(a?: string | null, b?: string | null) {
  return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase() && !!(a || '').trim()
}

function displayName(realName: string, viewerName?: string | null) {
  const name = (realName || '').trim() || 'Unknown'
  if (viewerName && sameUser(name, viewerName)) return 'You'
  return name
}

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

/**
 * Rebuild nesting from parentMarkingId so promoted roots / partial trees still
 * fan out under their real parent when both ends are present in the payload.
 */
function nestByParentMarkingId(tree: MarkingNode[]): MarkingNode[] {
  const flat: MarkingNode[] = []
  const walk = (n: MarkingNode) => {
    flat.push(n)
    ;(n.children ?? []).forEach(walk)
  }
  tree.forEach(walk)

  const byId = new Map<number, MarkingNode>()
  for (const n of flat) {
    if (n.status === 'revoked') continue
    if (byId.has(n.id)) continue
    byId.set(n.id, { ...n, children: [] })
  }

  const roots: MarkingNode[] = []
  for (const node of byId.values()) {
    const parentId = node.parentMarkingId
    if (parentId != null && byId.has(parentId)) {
      byId.get(parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  // Stable sibling order by marking id (creation order).
  const sortRec = (nodes: MarkingNode[]) => {
    nodes.sort((a, b) => a.id - b.id)
    nodes.forEach((n) => sortRec(n.children))
  }
  sortRec(roots)
  return roots
}

function forwardChildren(node: MarkingNode): MarkingNode[] {
  return visibleChildren(node).filter((c) => !isReplyMarking(c))
}

function replyChildren(node: MarkingNode): MarkingNode[] {
  return visibleChildren(node).filter((c) => isReplyMarking(c))
}

/**
 * Lane span for fan-out. Single-child chains stay width 1 (straight spine).
 * Multi-child subtrees sum child spans so siblings can sit equally above/below.
 * Nested reply chains are walked too (fan-outs often sit under a reply hop).
 */
function subtreeLaneSpan(node: MarkingNode): number {
  const forwards = forwardChildren(node)
  const replies = replyChildren(node)
  let span = 1
  if (forwards.length === 1) span = subtreeLaneSpan(forwards[0]!)
  else if (forwards.length > 1) span = forwards.reduce((sum, c) => sum + subtreeLaneSpan(c), 0)
  for (const reply of replies) {
    // Reply sits on a side lane and may itself fan out further.
    span = Math.max(span, subtreeLaneSpan(reply) + REPLY_LANE_GAP * 2)
  }
  return Math.max(1, span)
}

function positionAt(
  depth: number,
  lane: number,
  orientation: MarkingFlowOrientation,
): { x: number; y: number } {
  if (orientation === 'horizontal') {
    return {
      x: depth * H_GAP,
      y: lane * V_GAP - NODE_H / 2,
    }
  }
  return {
    x: lane * H_GAP - NODE_W / 2,
    y: depth * V_GAP,
  }
}

function replyFaceForIndex(
  index: number,
  orientation: MarkingFlowOrientation,
): NonNullable<MarkingFlowNodeData['replyFace']> {
  const aboveOrStart = index % 2 === 0
  if (orientation === 'horizontal') return aboveOrStart ? 'above' : 'below'
  return aboveOrStart ? 'start' : 'end'
}

function pushMarkingNode(
  node: MarkingNode,
  depth: number,
  lane: number,
  orientation: MarkingFlowOrientation,
  viewerName: string | undefined,
  nodes: MarkingFlowNode[],
  opts?: { isReplyNode?: boolean; replyFace?: MarkingFlowNodeData['replyFace'] },
): string {
  const id = `m-${node.id}`
  const pathLabel = shortPathId(node.pathId) || undefined
  const replies = replyChildren(node)
  const realTo = node.toUser
  const label = displayName(realTo, viewerName)
  const isReplyNode = !!opts?.isReplyNode || isReplyMarking(node)
  // Guard against duplicate marking ids (React Flow collapses same-id nodes).
  if (nodes.some((n) => n.id === id)) {
    return ''
  }
  nodes.push({
    id,
    type: 'markingPerson',
    position: positionAt(depth, lane, orientation),
    data: {
      kind: 'marking',
      label,
      isYou: label === 'You',
      isInitiator: false,
      subtitle: pathLabel
        ? `${isReplyNode ? '↩' : '←'} ${displayName(node.fromUser, viewerName)} · ${pathLabel}`
        : `from ${displayName(node.fromUser, viewerName)}`,
      action: node.action,
      actionLabel: isReplyNode ? 'Reply' : markingActionLabel(node.action),
      status: node.status,
      dueAt: node.dueAt || undefined,
      fromUser: node.fromUser,
      toUser: realTo,
      instructions: node.instructions || undefined,
      clientIp: node.clientIp || undefined,
      createdAt: node.createdAt || undefined,
      markingId: node.id,
      batchId: node.batchId,
      pathId: node.pathId || undefined,
      pathLabel,
      direction: node.direction || 'forward',
      hasReplyHandles: replies.length > 0,
      isReplyNode,
      replyFace: opts?.replyFace,
      orientation,
    },
    draggable: true,
    connectable: false,
    deletable: false,
  })
  return id
}

function pushEdge(
  parentId: string,
  id: string,
  node: MarkingNode,
  edges: Edge[],
  opts: { fanOut: boolean; fromReplyHandle: boolean },
): void {
  const reply = isReplyMarking(node)
  const stroke = reply ? REPLY_STROKE : FORWARD_STROKE
  // 1→many forwards use bezier; 1→1 stays straight; replies use bezier between facing handles.
  const type = reply ? 'default' : opts.fanOut ? 'default' : 'straight'
  edges.push({
    id: `e-${parentId}-${id}`,
    source: parentId,
    target: id,
    sourceHandle: opts.fromReplyHandle ? 'reply' : 'out',
    targetHandle: reply ? 'reply-in' : 'in',
    type,
    animated: node.status === 'active',
    className: reply ? 'ailms-edge-reply' : 'ailms-edge-forward',
    data: { kind: reply ? 'reply' : 'forward' },
    style: {
      stroke,
      strokeWidth: 1.75,
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: stroke,
      width: 14,
      height: 14,
    },
    selectable: false,
    focusable: false,
    deletable: false,
  })
}

/**
 * Layout outbound hops from an already-placed node:
 * - replies (and nested reply chains) on side lanes with facing handles
 * - 0/1 forwards on the same lane (straight spine)
 * - N>1 forwards distributed equally above/below
 *
 * Critical: must recurse into reply→reply→… so fan-outs under a reply hop
 * (e.g. Iqbal↔Masood replies then Iqbal→S.Khan + Z.Raza) are not dropped.
 */
function layoutOutbound(
  node: MarkingNode,
  depth: number,
  lane: number,
  nodeId: string,
  orientation: MarkingFlowOrientation,
  viewerName: string | undefined,
  nodes: MarkingFlowNode[],
  edges: Edge[],
): void {
  const forwards = forwardChildren(node)
  const replies = replyChildren(node)

  replies.forEach((reply, index) => {
    const face = replyFaceForIndex(index, orientation)
    const laneOffset =
      face === 'above' || face === 'start'
        ? -REPLY_LANE_GAP * (Math.floor(index / 2) + 1)
        : REPLY_LANE_GAP * (Math.floor(index / 2) + 1)
    // First reply sits slightly toward the parent; nested reply↔reply hops
    // step forward so later fan-outs are not stacked under earlier spine nodes.
    const replyDepth = isReplyMarking(node)
      ? depth + 0.55
      : Math.max(0, depth - REPLY_DEPTH_PULL)
    const replyLane = lane + laneOffset
    const replyId = pushMarkingNode(
      reply,
      replyDepth,
      replyLane,
      orientation,
      viewerName,
      nodes,
      { isReplyNode: true, replyFace: face },
    )
    if (!replyId) return
    pushEdge(nodeId, replyId, reply, edges, { fanOut: false, fromReplyHandle: true })
    // Recurse: nested replies AND forwards under this reply hop.
    layoutOutbound(
      reply,
      replyDepth,
      replyLane,
      replyId,
      orientation,
      viewerName,
      nodes,
      edges,
    )
  })

  if (forwards.length === 0) return

  const nextDepth = depth + 1
  if (forwards.length === 1) {
    layoutMarking(
      forwards[0]!,
      nextDepth,
      lane,
      nodeId,
      orientation,
      viewerName,
      nodes,
      edges,
      false,
      false,
    )
    return
  }

  const spans = forwards.map(subtreeLaneSpan)
  const total = spans.reduce((a, b) => a + b, 0)
  let cursor = lane - total / 2
  for (let i = 0; i < forwards.length; i++) {
    const span = spans[i]!
    layoutMarking(
      forwards[i]!,
      nextDepth,
      cursor + span / 2,
      nodeId,
      orientation,
      viewerName,
      nodes,
      edges,
      true,
      false,
    )
    cursor += span
  }
}

/**
 * Place this marking on `lane`, wire from parent, then layout its outbound hops.
 */
function layoutMarking(
  node: MarkingNode,
  depth: number,
  lane: number,
  parentId: string,
  orientation: MarkingFlowOrientation,
  viewerName: string | undefined,
  nodes: MarkingFlowNode[],
  edges: Edge[],
  parentFanOut: boolean,
  fromReplyHandle: boolean,
): void {
  const id = pushMarkingNode(node, depth, lane, orientation, viewerName, nodes, {
    isReplyNode: isReplyMarking(node),
  })
  if (!id) return
  pushEdge(parentId, id, node, edges, { fanOut: parentFanOut, fromReplyHandle })
  layoutOutbound(node, depth, lane, id, orientation, viewerName, nodes, edges)
}

/** Build React Flow nodes/edges from marking tree + initiator root (revoked omitted). */
export function buildMarkingFlowGraph(
  tree: MarkingNode[],
  initiatorName: string,
  orientation: MarkingFlowOrientation = 'horizontal',
  viewerName?: string | null,
): LayoutResult {
  const nodes: MarkingFlowNode[] = []
  const edges: Edge[] = []
  const rootId = 'root'
  const name = (initiatorName || '').trim() || 'Initiator'
  const viewer = (viewerName || '').trim() || undefined
  const visible = nestByParentMarkingId(filterTree(tree))
  const label = displayName(name, viewer)

  const rootForwards = visible.filter((n) => !isReplyMarking(n))
  const rootReplies = visible.filter((n) => isReplyMarking(n))

  nodes.push({
    id: rootId,
    type: 'markingPerson',
    position: positionAt(0, 0, orientation),
    data: {
      kind: 'root',
      label,
      isYou: label === 'You',
      isInitiator: true,
      subtitle: 'Initiator',
      status: 'root',
      // Registered is stored on the letter in the DB — not shown as a badge on the graph.
      toUser: name,
      fromUser: name,
      hasReplyHandles: rootReplies.length > 0,
      orientation,
    },
    draggable: true,
    connectable: false,
    deletable: false,
  })

  rootReplies.forEach((reply, index) => {
    const face = replyFaceForIndex(index, orientation)
    const laneOffset =
      face === 'above' || face === 'start'
        ? -REPLY_LANE_GAP * (Math.floor(index / 2) + 1)
        : REPLY_LANE_GAP * (Math.floor(index / 2) + 1)
    const replyId = pushMarkingNode(reply, 0, laneOffset, orientation, viewer, nodes, {
      isReplyNode: true,
      replyFace: face,
    })
    if (!replyId) return
    pushEdge(rootId, replyId, reply, edges, { fanOut: false, fromReplyHandle: true })
    layoutOutbound(reply, 0, laneOffset, replyId, orientation, viewer, nodes, edges)
  })

  if (rootForwards.length === 1) {
    layoutMarking(rootForwards[0]!, 1, 0, rootId, orientation, viewer, nodes, edges, false, false)
  } else if (rootForwards.length > 1) {
    const spans = rootForwards.map(subtreeLaneSpan)
    const total = spans.reduce((a, b) => a + b, 0)
    let cursor = -total / 2
    for (let i = 0; i < rootForwards.length; i++) {
      const span = spans[i]!
      const childLane = cursor + span / 2
      layoutMarking(
        rootForwards[i]!,
        1,
        childLane,
        rootId,
        orientation,
        viewer,
        nodes,
        edges,
        true,
        false,
      )
      cursor += span
    }
  }

  return { nodes, edges }
}
