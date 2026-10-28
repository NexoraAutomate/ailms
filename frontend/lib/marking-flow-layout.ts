import type { Edge, Node } from '@xyflow/react'
import { MarkerType } from '@xyflow/react'
import { markingActionLabel, type MarkingNode } from '@/services/markings'

const H_GAP = 260
const V_GAP = 150
const NODE_W = 188
const NODE_H = 96
/** Side-lane spacing for reply-only persons (no forward inbound). */
const REPLY_ONLY_LANE_GAP = 1.15

export type MarkingFlowOrientation = 'vertical' | 'horizontal'

export type MarkingFlowFieldKey =
  | 'subtitle'
  | 'action'
  | 'status'
  | 'dueAt'
  | 'instructions'
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
  /** Primary marking id (active / latest) for timeline jump. */
  markingId?: number
  /** All markings collapsed onto this person node. */
  markingIds?: number[]
  batchId?: number
  direction?: string
  /** Node has outbound reply edge(s). */
  hasReplyHandles?: boolean
  /** Node has inbound reply edge(s). */
  hasInboundReplies?: boolean
  /** Multiple forward parents fan into this node. */
  inboundFanIn?: boolean
  /** True when this person currently holds / is working the letter. */
  isWorking?: boolean
  /**
   * @deprecated Person-merged layout no longer creates dedicated reply-only
   * recipient cards; kept optional for older click payloads.
   */
  isReplyNode?: boolean
  replyFace?: 'above' | 'below' | 'start' | 'end'
  /** Per-render field visibility (injected by the flow canvas). */
  visibleFields?: Record<MarkingFlowFieldKey, boolean>
  orientation: MarkingFlowOrientation
}

export type MarkingFlowNode = Node<MarkingFlowNodeData, 'markingPerson'>

export const MARKING_FLOW_FIELD_OPTIONS: { key: MarkingFlowFieldKey; label: string }[] = [
  { key: 'subtitle', label: 'From' },
  { key: 'action', label: 'Action' },
  { key: 'status', label: 'Status' },
  { key: 'dueAt', label: 'Due date' },
  { key: 'instructions', label: 'Instructions' },
  { key: 'createdAt', label: 'Created' },
]

export const DEFAULT_VISIBLE_FIELDS: Record<MarkingFlowFieldKey, boolean> = {
  subtitle: true,
  action: true,
  status: true,
  dueAt: true,
  instructions: false,
  createdAt: false,
}

type LayoutResult = { nodes: MarkingFlowNode[]; edges: Edge[] }

const FORWARD_STROKE = '#64748b'
/** Hot orange — high contrast vs slate/cyan forward spine. */
const REPLY_STROKE = '#ea580c'
const ROOT_ID = 'root'

/** Reply source handle ids — one per side so edges can leave toward the recipient. */
export const REPLY_SOURCE_HANDLES = {
  top: 'reply-t',
  right: 'reply-r',
  bottom: 'reply-b',
  left: 'reply-l',
} as const

/** Reply target handle ids — one per side so edges can enter from the sender. */
export const REPLY_TARGET_HANDLES = {
  top: 'reply-in-t',
  right: 'reply-in-r',
  bottom: 'reply-in-b',
  left: 'reply-in-l',
} as const

export type ReplyHandleSide = keyof typeof REPLY_SOURCE_HANDLES

const ALL_SIDES: ReplyHandleSide[] = ['top', 'bottom', 'left', 'right']

function sideNormal(side: ReplyHandleSide): { x: number; y: number } {
  switch (side) {
    case 'top':
      return { x: 0, y: -1 }
    case 'bottom':
      return { x: 0, y: 1 }
    case 'left':
      return { x: -1, y: 0 }
    case 'right':
      return { x: 1, y: 0 }
  }
}

function handleAnchor(
  cx: number,
  cy: number,
  w: number,
  h: number,
  side: ReplyHandleSide,
): { x: number; y: number } {
  switch (side) {
    case 'top':
      return { x: cx, y: cy - h / 2 }
    case 'bottom':
      return { x: cx, y: cy + h / 2 }
    case 'left':
      return { x: cx - w / 2, y: cy }
    case 'right':
      return { x: cx + w / 2, y: cy }
  }
}

/**
 * Case-by-case reply docking:
 * - Replier prefers top / bottom / left (right is last resort — reserved for forward).
 * - Immediate sender prefers top / bottom / left (right last resort).
 * Scores every pair against live geometry so each letter's layout picks what fits.
 */
export function pickReplyHandleSides(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  sourceW = NODE_W,
  sourceH = NODE_H,
  targetW = NODE_W,
  targetH = NODE_H,
): { sourceSide: ReplyHandleSide; targetSide: ReplyHandleSide } {
  const dx = targetX - sourceX
  const dy = targetY - sourceY
  const len = Math.hypot(dx, dy) || 1
  const dirX = dx / len
  const dirY = dy / len

  let bestSource: ReplyHandleSide = 'top'
  let bestTarget: ReplyHandleSide = 'bottom'
  let bestCost = Number.POSITIVE_INFINITY

  for (const sourceSide of ALL_SIDES) {
    for (const targetSide of ALL_SIDES) {
      const a = handleAnchor(sourceX, sourceY, sourceW, sourceH, sourceSide)
      const b = handleAnchor(targetX, targetY, targetW, targetH, targetSide)
      let cost = Math.hypot(b.x - a.x, b.y - a.y)

      // Outward normals should point toward each other.
      const sn = sideNormal(sourceSide)
      const tn = sideNormal(targetSide)
      cost -= 55 * (sn.x * dirX + sn.y * dirY)
      cost -= 55 * (tn.x * -dirX + tn.y * -dirY)

      // Prefer top/bottom docks so the forward left↔right spine stays clear.
      if (sourceSide === 'top' || sourceSide === 'bottom') cost -= 28
      if (targetSide === 'top' || targetSide === 'bottom') cost -= 28
      // Left is allowed (back toward earlier holders); right is last resort.
      if (sourceSide === 'left') cost += dx >= -12 ? 70 : -18
      if (targetSide === 'left') cost += dx <= 12 ? 70 : -12
      if (sourceSide === 'right') cost += 140
      if (targetSide === 'right') cost += 150

      // When nodes sit above/below each other, lock onto vertical docks.
      if (Math.abs(dy) >= Math.abs(dx) * 0.4) {
        if (sourceSide === 'top' || sourceSide === 'bottom') cost -= 36
        if (targetSide === 'top' || targetSide === 'bottom') cost -= 36
        if (dy < 0 && sourceSide === 'top' && targetSide === 'bottom') cost -= 40
        if (dy > 0 && sourceSide === 'bottom' && targetSide === 'top') cost -= 40
      }

      // Back along the spine: replier left → sender top/bottom (or left in extremes).
      if (dx < -30) {
        if (sourceSide === 'left') cost -= 45
        if (targetSide === 'top' || targetSide === 'bottom') cost -= 30
        if (targetSide === 'left' && Math.abs(dy) < 40) cost -= 20
      }

      if (cost < bestCost) {
        bestCost = cost
        bestSource = sourceSide
        bestTarget = targetSide
      }
    }
  }

  return { sourceSide: bestSource, targetSide: bestTarget }
}

export function pickReplyHandles(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  sourceW = NODE_W,
  sourceH = NODE_H,
  targetW = NODE_W,
  targetH = NODE_H,
): { sourceHandle: string; targetHandle: string; sourceSide: ReplyHandleSide; targetSide: ReplyHandleSide } {
  const sides = pickReplyHandleSides(
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourceW,
    sourceH,
    targetW,
    targetH,
  )
  return {
    sourceHandle: REPLY_SOURCE_HANDLES[sides.sourceSide],
    targetHandle: REPLY_TARGET_HANDLES[sides.targetSide],
    sourceSide: sides.sourceSide,
    targetSide: sides.targetSide,
  }
}

function isReplyEdge(e: Edge): boolean {
  return (e.data as { kind?: string } | undefined)?.kind === 'reply' || e.className === 'ailms-edge-reply'
}

/** Re-bind reply edge handles from live node positions (after drag / layout). */
export function rebindReplyEdgeHandles(
  nodes: Array<{ id: string; position: { x: number; y: number }; measured?: { width?: number; height?: number } }>,
  edges: Edge[],
): Edge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  let changed = false
  const next = edges.map((e) => {
    if (!isReplyEdge(e)) return e
    const src = byId.get(e.source)
    const tgt = byId.get(e.target)
    if (!src || !tgt) return e
    const sw = src.measured?.width ?? NODE_W
    const sh = src.measured?.height ?? NODE_H
    const tw = tgt.measured?.width ?? NODE_W
    const th = tgt.measured?.height ?? NODE_H
    const handles = pickReplyHandles(
      src.position.x + sw / 2,
      src.position.y + sh / 2,
      tgt.position.x + tw / 2,
      tgt.position.y + th / 2,
      sw,
      sh,
      tw,
      th,
    )
    const prevData = (e.data || {}) as Record<string, unknown>
    if (
      e.sourceHandle === handles.sourceHandle &&
      e.targetHandle === handles.targetHandle &&
      prevData.replySourceSide === handles.sourceSide &&
      prevData.replyTargetSide === handles.targetSide
    ) {
      return e
    }
    changed = true
    return {
      ...e,
      sourceHandle: handles.sourceHandle,
      targetHandle: handles.targetHandle,
      data: {
        ...prevData,
        replySourceSide: handles.sourceSide,
        replyTargetSide: handles.targetSide,
      },
    }
  })
  return changed ? next : edges
}

type PersonNode = {
  id: string
  key: string
  name: string
  isInitiator: boolean
  markings: MarkingNode[]
}

type GraphEdge = {
  id: string
  sourceId: string
  targetId: string
  reply: boolean
  markings: MarkingNode[]
}

function sameUser(a?: string | null, b?: string | null) {
  return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase() && !!(a || '').trim()
}

function userKey(name?: string | null) {
  return (name || '').trim().toLowerCase()
}

function displayName(realName: string, viewerName?: string | null) {
  const name = (realName || '').trim() || 'Unknown'
  if (viewerName && sameUser(name, viewerName)) return 'You'
  return name
}

function isReplyMarking(node: MarkingNode) {
  return (node.direction || '').toLowerCase() === 'reply'
}

function flattenVisible(tree: MarkingNode[]): MarkingNode[] {
  const out: MarkingNode[] = []
  const walk = (n: MarkingNode) => {
    if (n.status === 'revoked') return
    out.push(n)
    ;(n.children ?? []).forEach(walk)
  }
  tree.forEach(walk)
  // Stable order by id; de-dupe if the payload nests the same row twice.
  const byId = new Map<number, MarkingNode>()
  for (const n of out) {
    if (!byId.has(n.id)) byId.set(n.id, n)
  }
  return [...byId.values()].sort((a, b) => a.id - b.id)
}

function pickPrimaryMarking(markings: MarkingNode[]): MarkingNode | undefined {
  if (markings.length === 0) return undefined
  const active = markings.filter((m) => m.status === 'active')
  const pool = active.length > 0 ? active : markings
  return [...pool].sort((a, b) => {
    const ta = a.createdAt ? Date.parse(a.createdAt) : a.id
    const tb = b.createdAt ? Date.parse(b.createdAt) : b.id
    return tb - ta || b.id - a.id
  })[0]
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

function uniqueNames(names: string[], viewer?: string): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of names) {
    const key = userKey(raw)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(displayName(raw, viewer))
  }
  return out.join(', ')
}

/**
 * Build a person-centric DAG:
 * - one node per distinct recipient (toUser); initiator is always `root`
 * - multiple markings to the same person collapse onto that node (fan-in)
 * - replies are back-edges to the existing person node (no duplicate "You" cards)
 */
function buildPersonGraph(
  flat: MarkingNode[],
  initiatorName: string,
): { persons: Map<string, PersonNode>; edges: GraphEdge[]; byMarkingId: Map<number, MarkingNode> } {
  const initiatorKey = userKey(initiatorName) || 'initiator'
  const byMarkingId = new Map(flat.map((m) => [m.id, m]))
  const persons = new Map<string, PersonNode>()

  const ensurePerson = (rawName: string, asInitiator = false): PersonNode => {
    const key = userKey(rawName) || 'unknown'
    const id = asInitiator || key === initiatorKey ? ROOT_ID : `p-${key}`
    const existing = persons.get(id)
    if (existing) {
      if ((rawName || '').trim() && existing.name === 'Unknown') {
        existing.name = (rawName || '').trim()
      }
      return existing
    }
    const person: PersonNode = {
      id,
      key: id === ROOT_ID ? initiatorKey : key,
      name: (rawName || '').trim() || (asInitiator ? 'Initiator' : 'Unknown'),
      isInitiator: id === ROOT_ID,
      markings: [],
    }
    persons.set(id, person)
    return person
  }

  ensurePerson(initiatorName || 'Initiator', true)

  for (const m of flat) {
    const person = ensurePerson(m.toUser)
    person.markings.push(m)
  }

  const edgeMap = new Map<string, GraphEdge>()

  for (const m of flat) {
    const target = ensurePerson(m.toUser)
    let sourceId = ROOT_ID
    if (m.parentMarkingId != null) {
      const parent = byMarkingId.get(m.parentMarkingId)
      if (parent) {
        sourceId = ensurePerson(parent.toUser).id
      } else {
        // Parent missing from payload — fall back to fromUser when present.
        const from = (m.fromUser || '').trim()
        if (from) sourceId = ensurePerson(from).id
      }
    } else {
      // Top-level marking: edge from initiator, unless fromUser is someone else
      // already in-graph (promoted root under another holder).
      const from = (m.fromUser || '').trim()
      if (from && !sameUser(from, initiatorName)) {
        // Still originate from root for top-level tree roots (API contract).
        sourceId = ROOT_ID
      }
    }

    // Self-loop (rare) — skip visual edge; person node still exists.
    if (sourceId === target.id) continue

    const reply = isReplyMarking(m)
    const edgeId = `e-${sourceId}-${target.id}-${reply ? 'r' : 'f'}`
    const existing = edgeMap.get(edgeId)
    if (existing) {
      existing.markings.push(m)
      continue
    }
    edgeMap.set(edgeId, {
      id: edgeId,
      sourceId,
      targetId: target.id,
      reply,
      markings: [m],
    })
  }

  return { persons, edges: [...edgeMap.values()], byMarkingId }
}

/** Longest-path ranks on the forward DAG only (replies are back-edges). */
function assignDepths(
  persons: Map<string, PersonNode>,
  edges: GraphEdge[],
): Map<string, number> {
  const depth = new Map<string, number>()
  for (const id of persons.keys()) depth.set(id, id === ROOT_ID ? 0 : 0)

  const forward = edges.filter((e) => !e.reply)
  const kids = new Map<string, string[]>()
  const indeg = new Map<string, number>()
  for (const id of persons.keys()) {
    kids.set(id, [])
    indeg.set(id, 0)
  }
  for (const e of forward) {
    if (!persons.has(e.sourceId) || !persons.has(e.targetId)) continue
    kids.get(e.sourceId)!.push(e.targetId)
    indeg.set(e.targetId, (indeg.get(e.targetId) || 0) + 1)
  }

  // Kahn + relax longest path.
  const queue = [...persons.keys()].filter((id) => (indeg.get(id) || 0) === 0)
  const order: string[] = []
  while (queue.length) {
    const id = queue.shift()!
    order.push(id)
    for (const t of kids.get(id) || []) {
      const next = (indeg.get(t) || 0) - 1
      indeg.set(t, next)
      if (next === 0) queue.push(t)
    }
  }

  depth.set(ROOT_ID, 0)
  for (const id of order) {
    const d = depth.get(id) ?? 0
    for (const t of kids.get(id) || []) {
      depth.set(t, Math.max(depth.get(t) ?? 0, d + 1))
    }
  }

  // Persons only reachable via reply (no forward inbound): sit beside their replier.
  const replyOnly = [...persons.keys()].filter((id) => {
    if (id === ROOT_ID) return false
    return !forward.some((e) => e.targetId === id)
  })
  for (const id of replyOnly) {
    const replyParents = edges.filter((e) => e.reply && e.targetId === id)
    if (replyParents.length === 0) {
      depth.set(id, 1)
      continue
    }
    let maxParent = 0
    for (const e of replyParents) {
      maxParent = Math.max(maxParent, depth.get(e.sourceId) ?? 0)
    }
    // Same column as replier — U-turn stays outside the forward spine.
    depth.set(id, maxParent)
  }

  // Unvisited cycles / leftovers: keep non-negative depth.
  for (const id of persons.keys()) {
    if (!depth.has(id)) depth.set(id, id === ROOT_ID ? 0 : 1)
  }

  return depth
}

/**
 * Barycenter lane layout per depth layer.
 * Children of one parent stay consecutive (clear fan-out); fan-in nodes sit on
 * the average of their parents' lanes so edges converge without crossing.
 */
function assignLanes(
  persons: Map<string, PersonNode>,
  edges: GraphEdge[],
  depth: Map<string, number>,
): Map<string, number> {
  const lane = new Map<string, number>()
  lane.set(ROOT_ID, 0)

  const forward = edges.filter((e) => !e.reply)
  const byDepth = new Map<number, string[]>()
  for (const id of persons.keys()) {
    const d = depth.get(id) ?? 0
    if (!byDepth.has(d)) byDepth.set(d, [])
    byDepth.get(d)!.push(id)
  }
  const depths = [...byDepth.keys()].sort((a, b) => a - b)

  const parentsOf = (id: string) =>
    forward.filter((e) => e.targetId === id).map((e) => e.sourceId)

  const childrenOf = (id: string) =>
    forward.filter((e) => e.sourceId === id).map((e) => e.targetId)

  // Seed order at each depth by median parent lane, then stabilize.
  for (const d of depths) {
    const ids = byDepth.get(d)!
    if (d === 0) {
      for (const id of ids) lane.set(id, id === ROOT_ID ? 0 : lane.get(id) ?? 0)
      continue
    }

    const scored = ids.map((id) => {
      const ps = parentsOf(id)
        .map((p) => lane.get(p))
        .filter((v): v is number => typeof v === 'number')
      const bary =
        ps.length === 0 ? 0 : ps.reduce((a, b) => a + b, 0) / ps.length
      return { id, bary, minParent: ps.length ? Math.min(...ps) : 0 }
    })
    scored.sort((a, b) => a.bary - b.bary || a.minParent - b.minParent || a.id.localeCompare(b.id))

    // Pack with unit gaps, then recenter so the layer median stays near 0 /
    // parent cluster — keeps the forward spine visually centered.
    const packed: { id: string; lane: number }[] = []
    let cursor = 0
    for (const row of scored) {
      packed.push({ id: row.id, lane: cursor })
      cursor += 1
    }
    const mid = packed.length <= 1 ? 0 : (packed[0]!.lane + packed[packed.length - 1]!.lane) / 2
    const parentMid =
      scored.reduce((s, r) => s + r.bary, 0) / Math.max(1, scored.length)
    const shift = parentMid - mid
    for (const row of packed) {
      lane.set(row.id, row.lane + shift)
    }

    // Within each parent's child group, re-center on the parent lane so a
    // single-parent fan-out is symmetric above/below the spine.
    const parents = new Set(scored.flatMap((s) => parentsOf(s.id)))
    for (const p of parents) {
      const kids = childrenOf(p).filter((k) => (depth.get(k) ?? -1) === d)
      if (kids.length === 0) continue
      kids.sort((a, b) => (lane.get(a) ?? 0) - (lane.get(b) ?? 0))
      const pLane = lane.get(p) ?? 0
      const start = pLane - (kids.length - 1) / 2
      kids.forEach((k, i) => {
        // Only re-center exclusive children; shared fan-in nodes keep barycenter.
        if (parentsOf(k).length === 1) {
          lane.set(k, start + i)
        }
      })
    }
  }

  // Reply-only persons: park on a side lane next to their replier, outside
  // the forward corridor (no depth pull into the previous column).
  for (const id of persons.keys()) {
    if (id === ROOT_ID) continue
    const hasForwardIn = forward.some((e) => e.targetId === id)
    if (hasForwardIn) continue
    const repliers = edges.filter((e) => e.reply && e.targetId === id).map((e) => e.sourceId)
    if (repliers.length === 0) continue
    const parentLane =
      repliers.reduce((s, r) => s + (lane.get(r) ?? 0), 0) / repliers.length
    const preferAbove = (lane.get(id) ?? 0) <= parentLane
    lane.set(
      id,
      parentLane + (preferAbove ? -REPLY_ONLY_LANE_GAP : REPLY_ONLY_LANE_GAP),
    )
  }

  // Case-by-case geometry: separate replier from immediate sender on the lane
  // axis so top/bottom docks win over a confusing left-locked back-edge.
  const replyEdges = edges.filter((e) => e.reply)
  replyEdges.forEach((e, index) => {
    const srcLane = lane.get(e.sourceId)
    const tgtLane = lane.get(e.targetId)
    if (srcLane == null || tgtLane == null) return
    if (Math.abs(srcLane - tgtLane) >= 0.65) return
    const dir = index % 2 === 0 ? -1 : 1
    // Prefer moving the replier; keep the forward spine (target) stable.
    lane.set(e.sourceId, tgtLane + dir * REPLY_ONLY_LANE_GAP)
  })

  // Final pass: no two nodes in the same depth share a lane (prevents stacking).
  for (const d of depths) {
    const ids = [...(byDepth.get(d) || [])].sort(
      (a, b) => (lane.get(a) ?? 0) - (lane.get(b) ?? 0) || a.localeCompare(b),
    )
    if (ids.length <= 1) continue
    const spaced: number[] = []
    for (let i = 0; i < ids.length; i++) {
      const desired = lane.get(ids[i]!) ?? i
      if (i === 0) {
        spaced.push(desired)
        continue
      }
      spaced.push(Math.max(desired, spaced[i - 1]! + 1))
    }
    const midOld = ((lane.get(ids[0]!) ?? 0) + (lane.get(ids[ids.length - 1]!) ?? 0)) / 2
    const midNew = (spaced[0]! + spaced[spaced.length - 1]!) / 2
    const fix = midOld - midNew
    ids.forEach((id, i) => lane.set(id, spaced[i]! + fix))
  }

  return lane
}

function pushEdge(
  edge: GraphEdge,
  fanOut: boolean,
  fanIn: boolean,
  edges: Edge[],
  positions: Map<string, { x: number; y: number }>,
): void {
  const primary = pickPrimaryMarking(edge.markings) || edge.markings[0]!
  const stroke = edge.reply ? REPLY_STROKE : FORWARD_STROKE
  // Forward spine: straight on 1↔1; smoothstep for fan-out / fan-in (orthogonal,
  // no diagonal crossings). Replies use the U-turn edge outside the spine.
  let type: string
  if (edge.reply) type = 'replyUTurn'
  else if (fanOut || fanIn) type = 'smoothstep'
  else type = 'straight'

  let sourceHandle = 'out'
  let targetHandle = 'in'
  let replySourceSide: ReplyHandleSide | undefined
  let replyTargetSide: ReplyHandleSide | undefined
  if (edge.reply) {
    const sp = positions.get(edge.sourceId) || { x: 0, y: 0 }
    const tp = positions.get(edge.targetId) || { x: 0, y: 0 }
    const handles = pickReplyHandles(
      sp.x + NODE_W / 2,
      sp.y + NODE_H / 2,
      tp.x + NODE_W / 2,
      tp.y + NODE_H / 2,
    )
    sourceHandle = handles.sourceHandle
    targetHandle = handles.targetHandle
    replySourceSide = handles.sourceSide
    replyTargetSide = handles.targetSide
  }

  edges.push({
    id: edge.id,
    source: edge.sourceId,
    target: edge.targetId,
    sourceHandle,
    targetHandle,
    type,
    animated: edge.markings.some((m) => m.status === 'active'),
    className: edge.reply ? 'ailms-edge-reply' : 'ailms-edge-forward',
    data: {
      kind: edge.reply ? 'reply' : 'forward',
      markingIds: edge.markings.map((m) => m.id),
      ...(edge.reply
        ? { replySourceSide, replyTargetSide }
        : {}),
    },
    style: {
      stroke,
      strokeWidth: edge.reply ? 2.6 : fanIn || fanOut ? 1.85 : 1.75,
      ...(edge.reply ? { strokeDasharray: '7 5' } : {}),
    },
    markerEnd: {
      type: MarkerType.Arrow,
      color: stroke,
      width: 14,
      height: 14,
    },
    selectable: false,
    focusable: false,
    deletable: false,
    // Reply on top so the orange path reads clearly over the forward spine.
    zIndex: edge.reply ? 2 : 1,
  })

  void primary
}

/** Build React Flow nodes/edges from marking tree + initiator root (revoked omitted). */
export function buildMarkingFlowGraph(
  tree: MarkingNode[],
  initiatorName: string,
  orientation: MarkingFlowOrientation = 'horizontal',
  viewerName?: string | null,
  /** Distinct people currently holding / working the letter (toUser names). */
  activeHolderNames?: string[] | null,
): LayoutResult {
  const nodes: MarkingFlowNode[] = []
  const edges: Edge[] = []
  const name = (initiatorName || '').trim() || 'Initiator'
  const viewer = (viewerName || '').trim() || undefined
  const flat = flattenVisible(tree)
  const { persons, edges: graphEdges } = buildPersonGraph(flat, name)

  const workingKeys = new Set<string>()
  for (const n of activeHolderNames || []) {
    const k = userKey(n)
    if (k) workingKeys.add(k)
  }
  // Fallback only when caller did not pass holders: active leaf recipients
  // who have not themselves marked anyone else (no outbound from their holds).
  if (workingKeys.size === 0) {
    const markedBy = new Set(
      flat.filter((m) => m.status !== 'revoked').map((m) => userKey(m.fromUser)).filter(Boolean),
    )
    for (const m of flat) {
      if (m.status !== 'active') continue
      const k = userKey(m.toUser)
      if (!k) continue
      // Skip anyone who has already forwarded or replied to others.
      if (markedBy.has(k)) continue
      workingKeys.add(k)
    }
  }

  const depth = assignDepths(persons, graphEdges)
  const lane = assignLanes(persons, graphEdges, depth)

  const forwardOutCount = new Map<string, number>()
  const forwardInCount = new Map<string, number>()
  const replyOut = new Set<string>()
  const replyIn = new Set<string>()
  /** Anyone who has forwarded or replied onward — not a current worker. */
  const hasSentOnward = new Set<string>()
  for (const e of graphEdges) {
    hasSentOnward.add(e.sourceId)
    if (e.reply) {
      replyOut.add(e.sourceId)
      replyIn.add(e.targetId)
    } else {
      forwardOutCount.set(e.sourceId, (forwardOutCount.get(e.sourceId) || 0) + 1)
      forwardInCount.set(e.targetId, (forwardInCount.get(e.targetId) || 0) + 1)
    }
  }

  // Emit person nodes (root first for stable RF defaults).
  const orderedPersons = [...persons.values()].sort((a, b) => {
    if (a.id === ROOT_ID) return -1
    if (b.id === ROOT_ID) return 1
    const dd = (depth.get(a.id) ?? 0) - (depth.get(b.id) ?? 0)
    if (dd !== 0) return dd
    return (lane.get(a.id) ?? 0) - (lane.get(b.id) ?? 0)
  })

  for (const person of orderedPersons) {
    const d = depth.get(person.id) ?? 0
    const ln = lane.get(person.id) ?? 0
    const primary = pickPrimaryMarking(person.markings)
    const inboundFrom = graphEdges
      .filter((e) => !e.reply && e.targetId === person.id)
      .flatMap((e) => {
        const src = persons.get(e.sourceId)
        return src ? [src.name] : []
      })
    const label = displayName(person.name, viewer)
    const isRoot = person.id === ROOT_ID

    let subtitle: string | undefined
    if (isRoot) {
      subtitle = 'Initiator'
    } else if (inboundFrom.length > 1) {
      subtitle = `← ${uniqueNames(inboundFrom, viewer)}`
    } else if (inboundFrom.length === 1) {
      subtitle = `from ${uniqueNames(inboundFrom, viewer)}`
    } else if (primary) {
      subtitle = `from ${displayName(primary.fromUser, viewer)}`
    }

    nodes.push({
      id: person.id,
      type: 'markingPerson',
      position: positionAt(d, ln, orientation),
      data: {
        kind: isRoot ? 'root' : 'marking',
        label,
        isYou: label === 'You',
        isInitiator: isRoot,
        subtitle,
        action: primary?.action,
        actionLabel: primary
          ? isReplyMarking(primary)
            ? 'Reply'
            : markingActionLabel(primary.action)
          : undefined,
        status: isRoot ? 'root' : primary?.status,
        dueAt: primary?.dueAt || undefined,
        fromUser: primary?.fromUser || (inboundFrom[0] ?? name),
        toUser: person.name,
        instructions: primary?.instructions || undefined,
        clientIp: primary?.clientIp || undefined,
        createdAt: primary?.createdAt || undefined,
        markingId: primary?.id,
        markingIds: person.markings.map((m) => m.id),
        batchId: primary?.batchId,
        direction: primary?.direction || (person.markings.length ? 'forward' : undefined),
        hasReplyHandles: replyOut.has(person.id),
        hasInboundReplies: replyIn.has(person.id),
        inboundFanIn: (forwardInCount.get(person.id) || 0) > 1,
        // Blink only for current holders who have not forwarded/replied onward.
        // Root may still hold after earlier sends (initiatorHold / reply-back).
        isWorking:
          workingKeys.has(person.key) &&
          (person.id === ROOT_ID || !hasSentOnward.has(person.id)),
        isReplyNode: false,
        orientation,
      },
      draggable: true,
      connectable: false,
      deletable: false,
    })
  }

  const workingNodeIds = new Set(nodes.filter((n) => n.data.isWorking).map((n) => n.id))
  const positions = new Map(nodes.map((n) => [n.id, n.position]))
  for (const ge of graphEdges) {
    const fanOut = !ge.reply && (forwardOutCount.get(ge.sourceId) || 0) > 1
    const fanIn = !ge.reply && (forwardInCount.get(ge.targetId) || 0) > 1
    pushEdge(ge, fanOut, fanIn, edges, positions)
    const last = edges[edges.length - 1]
    if (last && workingNodeIds.has(ge.targetId)) {
      last.className = `${last.className || ''} ailms-edge-working`.trim()
      last.data = { ...(last.data as object), workingTarget: true }
    }
  }

  return { nodes, edges }
}
