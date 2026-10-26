'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  CornerUpLeft,
  ExternalLink,
  Eye,
  Lock,
  MessageSquare,
  Paperclip,
  Pencil,
  Replace,
  Reply,
  Send,
  Trash2,
  X,
  XCircle,
} from 'lucide-react'
import { AppSelect } from '@/components/ui/app-select'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { CollapsibleCard } from '@/components/ui/collapsible-card'
import { MarkingActiveHolds } from '@/components/cms/marking-active-holds'
import { MarkingHistoryFlow } from '@/components/cms/marking-history-flow'
import type { MarkingFlowNodeData } from '@/lib/marking-flow-layout'
import { useAppData } from '@/components/app-provider'
import { Badge } from '@/components/cms/ui'
import { formatDateTime } from '@/lib/datetime'
import { isAdministrator } from '@/services/letter-actions'
import type { Letter } from '@/services/letters'
import {
  documentDownloadUrl,
  documentPreviewUrl,
  uploadDocumentVersion,
  uploadLetterDocument,
} from '@/services/documents'
import {
  ACTION_LABELS,
  ATTACHMENT_KINDS,
  MARKING_ACTIONS,
  RESPONSE_TYPES,
  RESPONSE_TYPE_LABELS,
  type AttachmentKind,
  type MarkingAction,
  type ResponseType,
} from '@/services/marking-types'
import {
  addDraftAttachments,
  addDraftNote,
  closeMarkedLetter,
  deleteDraftAttachment,
  deleteDraftNote,
  deleteMarkingAttachment,
  deleteMarkingNote,
  updateDraftNote,
  fetchBatchTracker,
  fetchAttachmentEvents,
  fetchMarkingActions,
  fetchMarkingAttachments,
  fetchMarkingDrafts,
  fetchMarkingNotes,
  fetchMarkingTree,
  flattenMarkings,
  markAttachmentReplaced,
  markLetter,
  markingActionLabel,
  respondToMarking,
  revokeMarking,
  shortPathId,
  updateMarkingAttachment,
  updateMarkingNote,
  type AttachmentEvent,
  type CorrespondenceAttachment,
  type CorrespondenceNote,
  type DraftAttachment,
  type DraftIntent,
  type DraftNote,
  type MarkRecipientInput,
  type MarkingDirection,
  type MarkingDrafts,
  type MarkingNode,
} from '@/services/markings'

type PendingAttachment = {
  id: string
  file: File
  kind: AttachmentKind
}

type WorkflowUser = { name: string; avatarUrl?: string; department?: string }

type BatchTrackerSummary = {
  batchId: number
  pendingCount: number
  respondedCount: number
  allResponsesReceived: boolean
  markings: MarkingNode[]
}

function hasActiveChild(m: MarkingNode) {
  return m.children.some((c) => c.status === 'active')
}

/** When the holder remade this incident onward to the next user (active remake). */
function onwardMarkedAt(
  incidentKey: MarkingIncidentKey,
  author: string,
  markings: MarkingNode[],
): string | undefined {
  const authorNorm = (author || '').trim().toLowerCase()
  if (!authorNorm) return undefined

  const pickLatest = (rows: MarkingNode[]) => {
    if (!rows.length) return undefined
    let best = rows[0]!
    for (const row of rows) {
      if (activityTime(row.createdAt, row.id) > activityTime(best.createdAt, best.id)) {
        best = row
      }
    }
    return best.createdAt || undefined
  }

  if (incidentKey === 'root') {
    const outbound = markings.filter(
      (m) =>
        m.parentMarkingId == null &&
        m.status === 'active' &&
        (m.fromUser || '').trim().toLowerCase() === authorNorm,
    )
    return pickLatest(outbound)
  }

  const hold = markings.find((m) => m.id === incidentKey)
  if (!hold) return undefined
  const remakes = hold.children.filter((c) => c.status === 'active')
  return pickLatest(remakes)
}

/**
 * Subtitle under an author on a content card.
 * Outbound published notes: "For {recipient} · Marked onward {date}".
 * Notes still on an inbound hold that was remade: "Marked onward {date}".
 */
function contentAuthorSubtitle(
  incidentKey: MarkingIncidentKey,
  author: string,
  markings: MarkingNode[],
): string | undefined {
  const authorNorm = (author || '').trim().toLowerCase()
  if (!authorNorm) return undefined

  if (incidentKey !== 'root') {
    const marking = markings.find((m) => m.id === incidentKey)
    if (
      marking &&
      (marking.fromUser || '').trim().toLowerCase() === authorNorm &&
      (marking.toUser || '').trim()
    ) {
      const forPart = `For ${(marking.toUser || '').trim()}`
      const markedAt = marking.createdAt ? formatDateTime(marking.createdAt) : ''
      return markedAt ? `${forPart} · Marked onward ${markedAt}` : forPart
    }
  }

  const remadeAt = onwardMarkedAt(incidentKey, author, markings)
  if (remadeAt) return `Marked onward ${formatDateTime(remadeAt)}`
  return undefined
}

/** Batch / single-mark cluster time for keeping content next to its mark chip. */
function timelineClusterKey(item: TimelineItem, markingsById: Map<number, MarkingNode>): string {
  if (item.kind === 'markBatch') return `batch:${item.batchId}`
  if (item.kind === 'mark') return `batch:${item.marking.batchId}`
  if (item.kind === 'content' && item.incident.key !== 'root') {
    const marking = markingsById.get(item.incident.key)
    if (marking) return `batch:${marking.batchId}`
  }
  return `content:${item.kind === 'content' ? item.incident.key : 'x'}`
}

function emptyRecipient(toUser = ''): MarkRecipientInput {
  return { toUser, action: 'forward', track: true, remindersEnabled: true }
}

function recipientFromExistingMarking(marking: MarkingNode): MarkRecipientInput {
  const due = (marking.dueAt || '').slice(0, 10)
  return {
    toUser: marking.toUser,
    action: marking.action,
    track: marking.track !== false,
    remindersEnabled: marking.remindersEnabled !== false,
    responseType: (marking.responseType as ResponseType) || 'draft_letter',
    responseTypeOther: marking.responseTypeOther || undefined,
    dueAt: due || undefined,
  }
}

/** Who Reply / Draft Reply targets for a given hold (usually the sender). */
function replyTargetForHold(hold: MarkingNode, meName: string): string {
  if (hold.status === 'responded' && hold.fromUser === meName) return hold.toUser
  return hold.fromUser
}

/** Consecutive notes from the same author share one card. */
function groupNotesByAuthor(notes: CorrespondenceNote[]): CorrespondenceNote[][] {
  const groups: CorrespondenceNote[][] = []
  for (const note of notes) {
    const last = groups[groups.length - 1]
    if (last && last[0]?.authorUser === note.authorUser) {
      last.push(note)
    } else {
      groups.push([note])
    }
  }
  return groups
}

type MarkingIncidentKey = number | 'root'

function markingKey(id: number | null | undefined): MarkingIncidentKey {
  return id == null ? 'root' : id
}

function sameWorkflowUser(a?: string | null, b?: string | null) {
  return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase()
}

/**
 * Marking ids whose notes/files belong on this pathway node for the current user.
 * Hold contributions use the node marking id; comments/files published when
 * forwarding onward are stored on child markings (author = fromUser).
 */
function relatedMarkingIdsForNode(
  data: MarkingFlowNodeData,
  meName: string,
  allMarkings: MarkingNode[],
): Set<number | null> {
  const ids = new Set<number | null>()
  const mid = data.markingId == null ? null : Number(data.markingId)
  ids.add(Number.isFinite(mid as number) ? (mid as number) : null)
  if (mid == null || data.kind === 'root') {
    for (const m of allMarkings) {
      if (m.parentMarkingId == null && sameWorkflowUser(m.fromUser, meName)) {
        ids.add(m.id)
      }
    }
  } else {
    for (const m of allMarkings) {
      if (m.parentMarkingId === mid && sameWorkflowUser(m.fromUser, meName)) {
        ids.add(m.id)
      }
    }
  }
  return ids
}

function activityTime(createdAt: string | undefined, id: number): number {
  const parsed = createdAt ? Date.parse(createdAt) : NaN
  return Number.isFinite(parsed) ? parsed : id
}

/** 0 → A, 25 → Z, 26 → AA, 27 → AB, … (Excel-style). */
function attachmentLetterLabel(index: number): string {
  let n = index + 1
  let label = ''
  while (n > 0) {
    n -= 1
    label = String.fromCharCode(65 + (n % 26)) + label
    n = Math.floor(n / 26)
  }
  return label
}

const WORKFLOW_VISIBILITY_KEY = 'ailms.markingWorkflow.visibility'

type WorkflowVisibility = {
  /** Emerald highlight + YOU badge on the logged-in user's comment cards. */
  highlightOwnComments: boolean
  /** Show date/time and IP on each comment. */
  showCommentMeta: boolean
  /** Show active holders strip (parallel leaves). */
  showActiveHolds: boolean
  /** Show React Flow marking pathway graph. */
  showFlowGraph: boolean
  /** Show centered mark chips (e.g. A. Rahman → N. Ahmed). */
  showMarkingCards: boolean
}

const DEFAULT_WORKFLOW_VISIBILITY: WorkflowVisibility = {
  highlightOwnComments: true,
  showCommentMeta: true,
  showActiveHolds: true,
  showFlowGraph: true,
  showMarkingCards: true,
}

function readWorkflowVisibility(): WorkflowVisibility {
  if (typeof window === 'undefined') return DEFAULT_WORKFLOW_VISIBILITY
  try {
    const raw = localStorage.getItem(WORKFLOW_VISIBILITY_KEY)
    if (!raw) return DEFAULT_WORKFLOW_VISIBILITY
    const parsed = JSON.parse(raw) as Partial<WorkflowVisibility> & { showStepper?: boolean }
    const { showStepper, ...rest } = parsed
    return {
      ...DEFAULT_WORKFLOW_VISIBILITY,
      ...rest,
      // Migrate legacy showStepper → showActiveHolds
      showActiveHolds:
        typeof rest.showActiveHolds === 'boolean'
          ? rest.showActiveHolds
          : typeof showStepper === 'boolean'
            ? showStepper
            : DEFAULT_WORKFLOW_VISIBILITY.showActiveHolds,
    }
  } catch {
    return DEFAULT_WORKFLOW_VISIBILITY
  }
}

function writeWorkflowVisibility(next: WorkflowVisibility) {
  try {
    localStorage.setItem(WORKFLOW_VISIBILITY_KEY, JSON.stringify(next))
  } catch {
    /* ignore quota / private mode */
  }
}

type ContentIncident = {
  key: MarkingIncidentKey
  notes: CorrespondenceNote[]
  attachments: CorrespondenceAttachment[]
}

type TimelineItem =
  | { kind: 'mark'; marking: MarkingNode; sortAt: number }
  | { kind: 'markBatch'; batchId: number; markings: MarkingNode[]; sortAt: number }
  | { kind: 'content'; incident: ContentIncident; sortAt: number }

/** Group notes + attachments by marking incident; newest items first within each group. */
function groupByMarkingIncident(
  notes: CorrespondenceNote[],
  attachments: CorrespondenceAttachment[],
): ContentIncident[] {
  const map = new Map<MarkingIncidentKey, ContentIncident>()
  const ensure = (key: MarkingIncidentKey) => {
    if (!map.has(key)) {
      map.set(key, { key, notes: [], attachments: [] })
    }
    return map.get(key)!
  }
  const notesDesc = [...notes].sort(
    (a, b) => activityTime(b.createdAt, b.id) - activityTime(a.createdAt, a.id),
  )
  const attachmentsDesc = [...attachments].sort(
    (a, b) => activityTime(b.createdAt, b.id) - activityTime(a.createdAt, a.id),
  )
  for (const note of notesDesc) ensure(markingKey(note.markingId)).notes.push(note)
  for (const att of attachmentsDesc) ensure(markingKey(att.markingId)).attachments.push(att)
  return [...map.values()]
}

function latestIncidentActivity(incident: ContentIncident): number {
  let max = 0
  for (const n of incident.notes) max = Math.max(max, activityTime(n.createdAt, n.id))
  for (const a of incident.attachments) max = Math.max(max, activityTime(a.createdAt, a.id))
  return max
}

/** Timeline: content cards + mark chips grouped by batch when siblings share batchId. */
function buildCommentsTimeline(
  markings: MarkingNode[],
  notes: CorrespondenceNote[],
  attachments: CorrespondenceAttachment[],
): TimelineItem[] {
  const items: TimelineItem[] = []
  const markingsById = new Map(markings.map((m) => [m.id, m]))

  const byBatch = new Map<number, MarkingNode[]>()
  const batchOrder: number[] = []
  // Revoked markings are not logged in the Workflow timeline (same as pathway).
  for (const marking of markings) {
    if (marking.status === 'revoked') continue
    if (!byBatch.has(marking.batchId)) {
      batchOrder.push(marking.batchId)
      byBatch.set(marking.batchId, [])
    }
    byBatch.get(marking.batchId)!.push(marking)
  }
  for (const batchId of batchOrder) {
    const group = byBatch.get(batchId) ?? []
    if (group.length === 0) continue
    const sortAt = Math.max(...group.map((m) => activityTime(m.createdAt, m.id)))
    if (group.length === 1) {
      items.push({ kind: 'mark', marking: group[0]!, sortAt })
    } else {
      items.push({ kind: 'markBatch', batchId, markings: group, sortAt })
    }
  }

  for (const incident of groupByMarkingIncident(notes, attachments)) {
    if (incident.notes.length === 0 && incident.attachments.length === 0) continue
    items.push({
      kind: 'content',
      incident,
      sortAt: latestIncidentActivity(incident),
    })
  }

  const clusterTime = new Map<string, number>()
  for (const item of items) {
    const key = timelineClusterKey(item, markingsById)
    clusterTime.set(key, Math.max(clusterTime.get(key) ?? 0, item.sortAt))
  }

  // Newest clusters first; within a forward/reply batch, mark card first, then its comments.
  const kindRank = (item: TimelineItem) => {
    if (item.kind === 'mark' || item.kind === 'markBatch') return 0
    if (item.kind === 'content') return 1
    return 2
  }

  return items.sort((a, b) => {
    const keyA = timelineClusterKey(a, markingsById)
    const keyB = timelineClusterKey(b, markingsById)
    const clusterDiff = (clusterTime.get(keyB) ?? 0) - (clusterTime.get(keyA) ?? 0)
    if (clusterDiff !== 0) return clusterDiff
    if (keyA === keyB) {
      const rankDiff = kindRank(a) - kindRank(b)
      if (rankDiff !== 0) return rankDiff
    }
    return b.sortAt - a.sortAt
  })
}

export function MarkingWorkflowPanel({
  letter,
  users,
  onDone,
  initialAction = null,
}: {
  letter: Letter
  users: WorkflowUser[]
  onDone: () => Promise<void>
  /** Deep-link from Inbox row: forward | respond */
  initialAction?: string | null
}) {
  const { me } = useAppData()
  const initialActionHandled = useRef(false)
  const [actions, setActions] = useState<string[]>([])
  const [tree, setTree] = useState<MarkingNode[]>([])
  const [activeHolds, setActiveHolds] = useState<MarkingNode[]>([])
  const [activeLeaves, setActiveLeaves] = useState<MarkingNode[]>([])
  const [initiatorHold, setInitiatorHold] = useState(false)
  const [notes, setNotes] = useState<CorrespondenceNote[]>([])
  const [attachments, setAttachments] = useState<CorrespondenceAttachment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [visibility, setVisibility] = useState<WorkflowVisibility>(DEFAULT_WORKFLOW_VISIBILITY)
  const [dialog, setDialog] = useState<
    'forward' | 'reply' | 'note' | 'respond' | 'attach' | 'close' | 'revoke' | null
  >(null)
  const [remarks, setRemarks] = useState('')
  const [recipients, setRecipients] = useState<MarkRecipientInput[]>([emptyRecipient()])
  /** Which recipient row the single User/Action card is editing. */
  const [activeRecipientIndex, setActiveRecipientIndex] = useState(0)
  const [drafts, setDrafts] = useState<MarkingDrafts | null>(null)
  /** '' = common draft (forward only); else target user name. */
  const [draftTargetUser, setDraftTargetUser] = useState<string>('')
  /** Which draft flow the open note/attach dialog is using. */
  const [draftIntent, setDraftIntent] = useState<DraftIntent>('forward')
  const [parentMarkingId, setParentMarkingId] = useState<number | null>(null)
  const [contextMarkingId, setContextMarkingId] = useState<number | null>(null)
  const [noteBody, setNoteBody] = useState('')
  const [pendingFiles, setPendingFiles] = useState<PendingAttachment[]>([])
  const [defaultKind, setDefaultKind] = useState<AttachmentKind>('Supporting Doc')
  const [forceClose, setForceClose] = useState(false)
  const [respondMarkingId, setRespondMarkingId] = useState<number | null>(null)
  const [expandedTrackerBatchId, setExpandedTrackerBatchId] = useState<number | null>(null)
  const [trackerCache, setTrackerCache] = useState<Record<number, BatchTrackerSummary>>({})
  const [busy, setBusy] = useState(false)
  const [nodeDialog, setNodeDialog] = useState<MarkingFlowNodeData | null>(null)
  const [nodeEvents, setNodeEvents] = useState<AttachmentEvent[]>([])
  const [nodeEventsLoading, setNodeEventsLoading] = useState(false)
  const [previewVersionId, setPreviewVersionId] = useState<number | null>(null)
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null)
  const [editingNoteBody, setEditingNoteBody] = useState('')
  const [editingDraftNoteId, setEditingDraftNoteId] = useState<number | null>(null)
  const [editingDraftNoteBody, setEditingDraftNoteBody] = useState('')
  /** DOM id of timeline row highlighted after a pathway node click. */
  const [highlightedTimelineId, setHighlightedTimelineId] = useState<string | null>(null)
  const highlightClearRef = useRef<number | null>(null)
  const loadInFlightRef = useRef(false)
  const busyRef = useRef(false)

  const scrollToTimelineAnchor = useCallback((elementId: string) => {
    const el = document.getElementById(elementId)
    if (!el) return false
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (highlightClearRef.current != null) window.clearTimeout(highlightClearRef.current)
    setHighlightedTimelineId(elementId)
    highlightClearRef.current = window.setTimeout(() => {
      setHighlightedTimelineId(null)
      highlightClearRef.current = null
    }, 2200)
    return true
  }, [])

  const jumpToMarkingInTimeline = useCallback(
    (markingId: number, batchId?: number) => {
      // Prefer the comments published with that mark; fall back to the mark/batch chip.
      if (scrollToTimelineAnchor(`workflow-incident-${markingId}`)) return
      if (batchId != null && scrollToTimelineAnchor(`workflow-batch-${batchId}`)) return
      scrollToTimelineAnchor(`workflow-mark-${markingId}`)
    },
    [scrollToTimelineAnchor],
  )

  useEffect(() => {
    return () => {
      if (highlightClearRef.current != null) window.clearTimeout(highlightClearRef.current)
    }
  }, [])

  const resetComposer = () => {
    setRemarks('')
    setNoteBody('')
    setPendingFiles([])
    setForceClose(false)
    setRecipients([emptyRecipient()])
    setActiveRecipientIndex(0)
    setParentMarkingId(null)
    setContextMarkingId(null)
    setDraftTargetUser('')
    setDraftIntent('forward')
    setEditingDraftNoteId(null)
    setEditingDraftNoteBody('')
  }

  const activeRecipient = recipients[activeRecipientIndex] ?? recipients[0] ?? emptyRecipient()

  const updateActiveRecipient = (patch: Partial<MarkRecipientInput>) => {
    setRecipients((prev) => {
      const idx = Math.min(activeRecipientIndex, Math.max(0, prev.length - 1))
      return prev.map((row, i) => (i === idx ? { ...row, ...patch } : row))
    })
  }

  const canAddAttachment = actions.includes('add_note')

  const flatMarkings = useMemo(() => flattenMarkings(tree), [tree])

  const timelineItems = useMemo(
    () => buildCommentsTimeline(flatMarkings, notes, attachments),
    [attachments, flatMarkings, notes],
  )

  /** Pending drafts shown like content cards under Comments & Attachments. */
  const draftGroups = useMemo(() => {
    if (!drafts) {
      return [] as {
        key: string
        intent: DraftIntent
        targetLabel: string
        notes: DraftNote[]
        attachments: DraftAttachment[]
      }[]
    }
    const groups: {
      key: string
      intent: DraftIntent
      targetLabel: string
      notes: DraftNote[]
      attachments: DraftAttachment[]
    }[] = []
    const intentOf = (raw: string | undefined): DraftIntent =>
      (raw || 'forward').toLowerCase() === 'reply' ? 'reply' : 'forward'

    const commonNotes = drafts.notes.filter((n) => !n.targetUser && intentOf(n.intent) === 'forward')
    const commonAtts = drafts.attachments.filter(
      (a) => !a.targetUser && intentOf(a.intent) === 'forward',
    )
    if (commonNotes.length > 0 || commonAtts.length > 0) {
      groups.push({
        key: 'forward:common',
        intent: 'forward',
        targetLabel: 'Common to all recipients',
        notes: commonNotes,
        attachments: commonAtts,
      })
    }
    for (const user of drafts.forwardTargetUsers ?? drafts.targetUsers) {
      const notes = drafts.notes.filter(
        (n) => n.targetUser === user && intentOf(n.intent) === 'forward',
      )
      const attachments = drafts.attachments.filter(
        (a) => a.targetUser === user && intentOf(a.intent) === 'forward',
      )
      if (!notes.length && !attachments.length) continue
      groups.push({
        key: `forward:${user}`,
        intent: 'forward',
        targetLabel: `For ${user}`,
        notes,
        attachments,
      })
    }
    for (const user of drafts.replyTargetUsers ?? []) {
      const notes = drafts.notes.filter(
        (n) => n.targetUser === user && intentOf(n.intent) === 'reply',
      )
      const attachments = drafts.attachments.filter(
        (a) => a.targetUser === user && intentOf(a.intent) === 'reply',
      )
      if (!notes.length && !attachments.length) continue
      groups.push({
        key: `reply:${user}`,
        intent: 'reply',
        targetLabel: `For ${user}`,
        notes,
        attachments,
      })
    }
    return groups
  }, [drafts])

  /** Stable serials: oldest comment = 1, newest = N. */
  const noteSerialById = useMemo(() => {
    const ordered = [...notes].sort((a, b) => {
      const byTime = activityTime(a.createdAt, a.id) - activityTime(b.createdAt, b.id)
      return byTime !== 0 ? byTime : a.id - b.id
    })
    const map = new Map<number, number>()
    ordered.forEach((note, index) => map.set(note.id, index + 1))
    return map
  }, [notes])

  /** Stable letters: oldest attachment = A, then B…Z, AA, AB… */
  const attachmentLetterById = useMemo(() => {
    const ordered = [...attachments].sort((a, b) => {
      const byTime = activityTime(a.createdAt, a.id) - activityTime(b.createdAt, b.id)
      return byTime !== 0 ? byTime : a.id - b.id
    })
    const map = new Map<number, string>()
    ordered.forEach((att, index) => map.set(att.id, attachmentLetterLabel(index)))
    return map
  }, [attachments])

  const uploadPendingAttachments = async () => {
    const uploaded: { attachmentKind: string; documentId: number; originalFilename: string }[] = []
    for (const item of pendingFiles) {
      const doc = await uploadLetterDocument(
        letter.id,
        item.file,
        item.kind,
        `Workflow attachment (${item.kind})`,
        'workflow',
      )
      uploaded.push({
        attachmentKind: item.kind,
        documentId: Number(doc.id),
        originalFilename: item.file.name,
      })
    }
    return uploaded
  }

  const load = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    // Background polls skip when a refresh is already running; explicit reloads always run.
    if (silent && loadInFlightRef.current) return
    loadInFlightRef.current = true
    if (!silent) {
      setLoading(true)
      setError('')
    }
    try {
      const [available, markingTree, noteRows, attachmentRows, draftBundle] = await Promise.all([
        fetchMarkingActions(letter.id),
        fetchMarkingTree(letter.id),
        fetchMarkingNotes(letter.id),
        fetchMarkingAttachments(letter.id),
        fetchMarkingDrafts(letter.id),
      ])
      setActions(available.actions ?? [])
      setActiveHolds(available.activeHolds ?? [])
      setActiveLeaves(available.activeLeaves ?? [])
      setInitiatorHold(Boolean(available.initiatorHold))
      setTree(markingTree)
      setNotes(noteRows)
      setAttachments(attachmentRows)
      setDrafts(draftBundle)
      const holds = available.activeHolds ?? []
      if (holds.length === 1) {
        setParentMarkingId(holds[0]!.id)
        setContextMarkingId(holds[0]!.id)
      } else if (holds.length === 0) {
        setParentMarkingId(null)
        setContextMarkingId(null)
      }
      const rrHolds = holds.filter((n) => n.action === 'response_required' && n.status === 'active')
      setRespondMarkingId(rrHolds.length === 1 ? rrHolds[0]!.id : rrHolds[0]?.id ?? null)
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Unable to load marking workflow')
      }
    } finally {
      loadInFlightRef.current = false
      if (!silent) setLoading(false)
    }
  }, [letter.id])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    initialActionHandled.current = false
  }, [letter.id, initialAction])

  useEffect(() => {
    setVisibility(readWorkflowVisibility())
  }, [])

  const updateVisibility = <K extends keyof WorkflowVisibility>(key: K, value: WorkflowVisibility[K]) => {
    setVisibility((prev) => {
      const next = { ...prev, [key]: value }
      writeWorkflowVisibility(next)
      return next
    })
  }

  // While this user can still revoke, poll so Revoke disappears as soon as the
  // recipient adds a note/attachment — without requiring a page reload.
  const watchRevoke = actions.includes('revoke')
  useEffect(() => {
    if (!watchRevoke) return

    const refresh = () => {
      if (document.visibilityState === 'hidden') return
      if (busyRef.current) return
      void load({ silent: true })
    }

    const intervalId = window.setInterval(refresh, 2000)
    const onFocus = () => refresh()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [load, watchRevoke])

  const run = async (fn: () => Promise<void>) => {
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      await fn()
      setDialog(null)
      resetComposer()
      await onDone()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const allMarkings = useMemo(() => flattenMarkings(tree), [tree])

  const myRrBatches = useMemo(() => {
    const meName = (me.name || '').trim()
    if (!meName) return [] as { batchId: number; markings: MarkingNode[] }[]
    const mine = allMarkings.filter((m) => m.fromUser === meName)
    const byBatch = new Map<number, MarkingNode[]>()
    for (const m of mine) {
      if (!byBatch.has(m.batchId)) byBatch.set(m.batchId, [])
      byBatch.get(m.batchId)!.push(m)
    }
    return [...byBatch.entries()]
      .filter(([, rows]) => rows.some((r) => r.action === 'response_required'))
      .map(([batchId, markings]) => ({ batchId, markings }))
      .sort((a, b) => b.batchId - a.batchId)
  }, [allMarkings, me.name])

  const pendingRrLeaves = useMemo(
    () => activeLeaves.filter((m) => m.action === 'response_required' && m.status === 'active'),
    [activeLeaves],
  )

  const rrHoldsForMe = useMemo(
    () => activeHolds.filter((m) => m.action === 'response_required' && m.status === 'active'),
    [activeHolds],
  )

  const loadBatchTracker = async (batchId: number) => {
    try {
      const data = await fetchBatchTracker(batchId)
      setTrackerCache((prev) => ({
        ...prev,
        [batchId]: {
          batchId,
          pendingCount: data.pendingCount,
          respondedCount: data.respondedCount,
          allResponsesReceived: data.allResponsesReceived,
          markings: data.markings,
        },
      }))
    } catch {
      /* tracker is marker-only; ignore if unauthorized */
    }
  }

  // Last marker may revoke only if recipient has not remade or added comments/attachments.
  // Backend is authoritative (actions.includes('revoke')); this filters which leaves to list.
  const revokableMarkings = useMemo(() => {
    if (!actions.includes('revoke')) return []
    const meName = (me.name || '').trim()
    if (!meName) return []
    return allMarkings.filter((m) => {
      if (m.status !== 'active' || m.fromUser !== meName || hasActiveChild(m)) {
        return false
      }
      const recipient = (m.toUser || '').trim()
      const hasNote = notes.some(
        (n) => n.markingId === m.id && (n.authorUser || '').trim() === recipient,
      )
      // Live list hides soft-deleted rows; backend still blocks via archive events.
      const hasAttachment = attachments.some(
        (a) => a.markingId === m.id && (a.createdBy || '').trim() === recipient,
      )
      return !hasNote && !hasAttachment
    })
  }, [actions, allMarkings, attachments, me.name, notes])

  useEffect(() => {
    if (dialog === 'revoke' && revokableMarkings.length === 0 && !busy) {
      setDialog(null)
    }
  }, [busy, dialog, revokableMarkings.length])

  const forwardTargetUsers = drafts?.forwardTargetUsers ?? []
  const hasReplyDrafts = Boolean(drafts?.hasReplyDrafts)
  const hasForwardDrafts = Boolean(drafts?.hasForwardDrafts)
  const isAdminActor = isAdministrator(me.role || '')
  /** Active leaf outbound markings from me — used to detect re-forward / admin edit. */
  const myOutboundLeafByUser = useMemo(() => {
    const meName = (me.name || '').trim()
    const map = new Map<string, MarkingNode>()
    if (!meName) return map
    for (const m of allMarkings) {
      if (
        m.status === 'active' &&
        m.fromUser === meName &&
        !hasActiveChild(m) &&
        (m.toUser || '').trim()
      ) {
        map.set(m.toUser.trim(), m)
      }
    }
    return map
  }, [allMarkings, me.name])
  const canForwardWithDrafts =
    (forwardTargetUsers.length > 0 || (isAdminActor && myOutboundLeafByUser.size > 0)) &&
    !hasReplyDrafts

  useEffect(() => {
    if (loading || initialActionHandled.current) return
    const action = (initialAction || '').trim().toLowerCase()
    if (!action) return
    if (action === 'respond' && actions.includes('respond')) {
      initialActionHandled.current = true
      const rr = activeHolds.filter((n) => n.action === 'response_required' && n.status === 'active')
      if (rr.length === 1) setRespondMarkingId(rr[0]!.id)
      setDialog('respond')
      return
    }
    if ((action === 'forward' || action === 'assign') && actions.includes('forward')) {
      initialActionHandled.current = true
      setError('')
      // Open Forward when drafts already exist; otherwise land on Workflow to stage them.
      if (!canForwardWithDrafts) return
      const rawNames =
        forwardTargetUsers.length > 0
          ? forwardTargetUsers
          : isAdminActor
            ? [...myOutboundLeafByUser.keys()]
            : []
      const names = isAdminActor
        ? rawNames
        : rawNames.filter((name) => !myOutboundLeafByUser.has(name))
      if (!names.length) return
      setRecipients(
        names.map((name) => {
          const existing = myOutboundLeafByUser.get(name)
          return existing && isAdminActor
            ? recipientFromExistingMarking(existing)
            : emptyRecipient(name)
        }),
      )
      setActiveRecipientIndex(0)
      if (activeHolds.length === 1) setParentMarkingId(activeHolds[0]!.id)
      else if (activeHolds.length === 0) setParentMarkingId(null)
      setDialog('forward')
    }
  }, [
    loading,
    initialAction,
    actions,
    activeHolds,
    canForwardWithDrafts,
    forwardTargetUsers,
    isAdminActor,
    myOutboundLeafByUser,
  ])

  const replyHoldForActions =
    activeHolds.length === 1
      ? activeHolds[0]!
      : activeHolds.find((h) => h.id === parentMarkingId) ?? activeHolds[0]
  const replyTargetName = replyHoldForActions
    ? replyTargetForHold(replyHoldForActions, me.name)
    : ''
  const canReplyWithDraft =
    Boolean(replyTargetName) &&
    !hasForwardDrafts &&
    (drafts?.replyTargetUsers ?? []).includes(replyTargetName)

  const openDraftNote = (intent: DraftIntent) => {
    if (activeHolds.length === 1) setContextMarkingId(activeHolds[0]!.id)
    setDraftIntent(intent)
    if (intent === 'reply') {
      const hold =
        activeHolds.length === 1
          ? activeHolds[0]!
          : activeHolds.find((h) => h.id === contextMarkingId) ?? activeHolds[0]
      if (hold) {
        setContextMarkingId(hold.id)
        setDraftTargetUser(replyTargetForHold(hold, me.name))
      } else {
        setDraftTargetUser('')
      }
    } else {
      setDraftTargetUser('')
    }
    setDialog('note')
  }

  const openDraftAttach = (intent: DraftIntent) => {
    setPendingFiles([])
    if (activeHolds.length === 1) setContextMarkingId(activeHolds[0]!.id)
    setDraftIntent(intent)
    if (intent === 'reply') {
      const hold =
        activeHolds.length === 1
          ? activeHolds[0]!
          : activeHolds.find((h) => h.id === contextMarkingId) ?? activeHolds[0]
      if (hold) {
        setContextMarkingId(hold.id)
        setDraftTargetUser(replyTargetForHold(hold, me.name))
      } else {
        setDraftTargetUser('')
      }
    } else {
      setDraftTargetUser('')
    }
    setDialog('attach')
  }

  return (
    <CollapsibleCard collapsible={false} contentClassName="relative">
      <div className="absolute top-3 right-3 z-20 sm:top-4 sm:right-4">
        <DropdownMenu>
          <DropdownMenuTrigger
            type="button"
            aria-label="Workflow display options"
            className={cn(
              buttonVariants({ size: 'icon-xs', variant: 'ghost' }),
              'text-slate-500 hover:text-slate-800',
            )}
          >
            <Eye className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Show on workflow</DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuCheckboxItem
                checked={visibility.showActiveHolds}
                onCheckedChange={(checked) => updateVisibility('showActiveHolds', checked === true)}
              >
                Active holders
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={visibility.showFlowGraph}
                onCheckedChange={(checked) => updateVisibility('showFlowGraph', checked === true)}
              >
                Pathway graph
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={visibility.showMarkingCards}
                onCheckedChange={(checked) => updateVisibility('showMarkingCards', checked === true)}
              >
                Marking cards
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={visibility.highlightOwnComments}
                onCheckedChange={(checked) => updateVisibility('highlightOwnComments', checked === true)}
              >
                Highlight my comments
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={visibility.showCommentMeta}
                onCheckedChange={(checked) => updateVisibility('showCommentMeta', checked === true)}
              >
                Comment date & IP
              </DropdownMenuCheckboxItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {loading && <p className="text-xs text-slate-500">Loading workflow…</p>}
      {error && <p className="mb-2 text-xs text-rose-600">{error}</p>}

      {!loading && visibility.showActiveHolds && (
        <div className="mb-5">
          <MarkingActiveHolds
            activeLeaves={activeLeaves}
            initiatorHold={initiatorHold}
            initiatorName={letter.createdBy || ''}
            users={users}
          />
        </div>
      )}

      {!loading && visibility.showFlowGraph && (
        <div className="mb-5">
          <MarkingHistoryFlow
            tree={tree}
            initiatorName={letter.createdBy || ''}
            viewerName={me.name || ''}
            onMarkingClick={(data) => {
              const meName = (me.name || '').trim()
              // Only the person represented by the node may open their own comments/files.
              if (!meName || !sameWorkflowUser(data.toUser, meName)) {
                if (data.markingId != null) {
                  jumpToMarkingInTimeline(data.markingId, data.batchId)
                }
                return
              }
              setNodeDialog(data)
              setNodeEvents([])
              setNodeEventsLoading(true)
              // Fetch all of my archive events; dialog filters to this node + outbound children.
              void fetchAttachmentEvents(letter.id, { mineOnly: true })
                .then(setNodeEvents)
                .catch(() => setNodeEvents([]))
                .finally(() => setNodeEventsLoading(false))
            }}
          />
        </div>
      )}

      {!loading && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {actions.includes('add_note') && actions.includes('reply') && (
              <Button
                size="sm"
                variant="outline"
                disabled={hasForwardDrafts}
                title={
                  hasForwardDrafts
                    ? 'Delete forwarding drafts before adding a reply comment'
                    : undefined
                }
                onClick={() => openDraftNote('reply')}
              >
                <Reply className="mr-1 h-3.5 w-3.5" /> Add Reply Comment
              </Button>
            )}
            {actions.includes('add_note') && actions.includes('forward') && (
              <Button
                size="sm"
                disabled={hasReplyDrafts}
                title={
                  hasReplyDrafts
                    ? 'Delete reply drafts before adding a forwarding comment'
                    : undefined
                }
                onClick={() => openDraftNote('forward')}
              >
                <MessageSquare className="mr-1 h-3.5 w-3.5" /> Add Forwarding Comment
              </Button>
            )}
            {canAddAttachment && actions.includes('reply') && (
              <Button
                size="sm"
                variant="outline"
                disabled={hasForwardDrafts}
                title={
                  hasForwardDrafts
                    ? 'Delete forwarding drafts before adding a reply attachment'
                    : undefined
                }
                onClick={() => openDraftAttach('reply')}
              >
                <Paperclip className="mr-1 h-3.5 w-3.5" /> Add Reply Attachment
              </Button>
            )}
            {canAddAttachment && actions.includes('forward') && (
              <Button
                size="sm"
                disabled={hasReplyDrafts}
                title={
                  hasReplyDrafts
                    ? 'Delete reply drafts before adding a forwarding attachment'
                    : undefined
                }
                onClick={() => openDraftAttach('forward')}
              >
                <Paperclip className="mr-1 h-3.5 w-3.5" /> Add Forwarding Attachment
              </Button>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {actions.includes('forward') && (
              <Button
                size="sm"
                disabled={!canForwardWithDrafts}
                title={
                  hasReplyDrafts
                    ? 'Delete all reply drafts before Forward'
                    : canForwardWithDrafts
                      ? undefined
                      : 'Add a forwarding comment or attachment for a recipient first'
                }
                onClick={() => {
                  if (!canForwardWithDrafts) return
                  setError('')
                  const rawNames =
                    forwardTargetUsers.length > 0
                      ? forwardTargetUsers
                      : isAdminActor
                        ? [...myOutboundLeafByUser.keys()]
                        : []
                  // Non-admin must revoke before re-forwarding / editing action for the same user.
                  const names = isAdminActor
                    ? rawNames
                    : rawNames.filter((name) => !myOutboundLeafByUser.has(name))
                  if (!names.length) {
                    setError(
                      'Revoke the existing marking before forwarding again or changing action / response type.',
                    )
                    return
                  }
                  setRecipients(
                    names.map((name) => {
                      const existing = myOutboundLeafByUser.get(name)
                      return existing && isAdminActor
                        ? recipientFromExistingMarking(existing)
                        : emptyRecipient(name)
                    }),
                  )
                  setActiveRecipientIndex(0)
                  if (activeHolds.length === 1) setParentMarkingId(activeHolds[0]!.id)
                  else if (activeHolds.length === 0) setParentMarkingId(null)
                  setDialog('forward')
                }}
              >
                <Send className="mr-1 h-3.5 w-3.5" /> Forward
              </Button>
            )}
            {actions.includes('reply') && (
              <Button
                size="sm"
                variant="outline"
                disabled={!canReplyWithDraft}
                title={
                  hasForwardDrafts
                    ? 'Delete all forwarding drafts before Reply'
                    : canReplyWithDraft
                      ? undefined
                      : replyTargetName
                        ? `Add a reply comment or attachment for ${replyTargetName} first`
                        : 'Add a reply comment or attachment first'
                }
                onClick={() => {
                  if (!replyHoldForActions || !canReplyWithDraft) return
                  setError('')
                  setParentMarkingId(replyHoldForActions.id)
                  setRecipients([emptyRecipient(replyTargetName)])
                  setActiveRecipientIndex(0)
                  setDialog('reply')
                }}
              >
                <Reply className="mr-1 h-3.5 w-3.5" /> Reply
              </Button>
            )}
            {actions.includes('respond') && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (rrHoldsForMe.length === 1) setRespondMarkingId(rrHoldsForMe[0]!.id)
                  setDialog('respond')
                }}
              >
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Respond
              </Button>
            )}
            {revokableMarkings.length > 0 && (
              <Button size="sm" variant="destructive" onClick={() => setDialog('revoke')}>
                <CornerUpLeft className="mr-1 h-3.5 w-3.5" /> Revoke
              </Button>
            )}
            {actions.includes('close') && (
              <Button size="sm" variant="outline" onClick={() => setDialog('close')}>
                <XCircle className="mr-1 h-3.5 w-3.5" /> Close
              </Button>
            )}
          </div>
        </div>
      )}

      {!loading && myRrBatches.length > 0 && (
        <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            My batch trackers
          </p>
          <ul className="mt-2 space-y-2">
            {myRrBatches.map(({ batchId, markings }) => {
              const rrRows = markings.filter((m) => m.action === 'response_required')
              const pending = rrRows.filter((m) => m.status === 'active')
              const responded = rrRows.filter((m) => m.status === 'responded')
              const cached = trackerCache[batchId]
              const expanded = expandedTrackerBatchId === batchId
              return (
                <li key={batchId} className="rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-semibold text-slate-800">Batch #{batchId}</span>
                      <span className="ml-2 text-slate-500">
                        {cached
                          ? `${cached.respondedCount}/${cached.respondedCount + cached.pendingCount} responses`
                          : `${responded.length} responded · ${pending.length} pending`}
                      </span>
                      {(cached?.allResponsesReceived || (pending.length === 0 && responded.length > 0)) && (
                        <Badge tone="green">All received</Badge>
                      )}
                    </div>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        const next = expanded ? null : batchId
                        setExpandedTrackerBatchId(next)
                        if (next != null) void loadBatchTracker(next)
                      }}
                    >
                      {expanded ? 'Hide' : 'Details'}
                    </Button>
                  </div>
                  {expanded && (
                    <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2">
                      {(cached?.markings ?? rrRows).map((m) => (
                        <li key={m.id} className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                          <span className="font-medium text-slate-800">{m.toUser}</span>
                          <Badge tone={m.status === 'responded' ? 'green' : m.status === 'active' ? 'amber' : 'slate'}>
                            {m.status}
                          </Badge>
                          {m.dueAt ? <span>Due {m.dueAt}</span> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Comments & Attachments</h3>
        {timelineItems.filter(
          (item) => item.kind === 'content' || visibility.showMarkingCards,
        ).length === 0 &&
          draftGroups.length === 0 && (
          <p className="text-xs text-slate-500">No notes, attachments, or markings yet.</p>
        )}
        <ul className="space-y-3">
          {draftGroups.map((group) => {
            const author = me.name || group.notes[0]?.authorUser || 'You'
            return (
              <li
                key={`draft-${group.key}`}
                className="overflow-hidden rounded-xl border border-amber-200 bg-amber-50 shadow-sm dark:border-amber-800/60 dark:bg-amber-950/40"
              >
                <div className="grid grid-cols-1 md:grid-cols-3">
                  <div className="divide-y divide-amber-200/70 px-4 py-1 md:col-span-2 md:border-r md:border-amber-200/70 dark:divide-amber-800/50 dark:md:border-amber-800/50">
                    <div className="pt-3 pb-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-base font-bold tracking-wide text-amber-950 dark:text-amber-200">
                          {author}
                        </p>
                        <span className="rounded-full bg-amber-200/80 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-amber-950">
                          YOU
                        </span>
                        <Badge tone="amber">Draft</Badge>
                        <Badge tone={group.intent === 'reply' ? 'violet' : 'blue'}>
                          {group.intent === 'reply' ? 'Reply' : 'Forward'}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-[11px] text-amber-900/75 dark:text-amber-300/75">
                        {group.targetLabel} · confirm with{' '}
                        {group.intent === 'reply' ? 'Reply' : 'Forward'}
                      </p>
                    </div>
                    {group.notes.length === 0 ? (
                      <p className="pb-3 text-xs text-amber-800/60 dark:text-amber-400/60">No draft comments</p>
                    ) : (
                      <div className="py-1">
                        {group.notes.map((note) => (
                          <div
                            key={`draft-note-${note.id}`}
                            className="border-t border-amber-100 py-2.5 first:border-t-0 dark:border-amber-900/40"
                          >
                            <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-amber-900/80 dark:text-amber-300/80">
                              {visibility.showCommentMeta ? (
                                <>
                                  <span>{note.createdAt ? formatDateTime(note.createdAt) : ''}</span>
                                  {note.clientIp ? <span>IP {note.clientIp}</span> : null}
                                </>
                              ) : null}
                              <span className="ml-auto flex flex-wrap gap-1.5">
                                <Button
                                  type="button"
                                  size="xs"
                                  variant="outline"
                                  onClick={() => {
                                    setEditingDraftNoteId(note.id)
                                    setEditingDraftNoteBody(note.bodyText)
                                  }}
                                >
                                  <Pencil data-icon="inline-start" /> Edit
                                </Button>
                                <Button
                                  type="button"
                                  size="xs"
                                  variant="destructive"
                                  disabled={busy}
                                  onClick={() =>
                                    void run(async () => {
                                      const result = await deleteDraftNote(note.id)
                                      setDrafts(result.drafts)
                                      if (editingDraftNoteId === note.id) {
                                        setEditingDraftNoteId(null)
                                      }
                                    })
                                  }
                                >
                                  <Trash2 data-icon="inline-start" /> Delete
                                </Button>
                              </span>
                            </div>
                            {editingDraftNoteId === note.id ? (
                              <div className="space-y-2">
                                <textarea
                                  className="w-full rounded border border-amber-200 bg-white px-2 py-1.5 text-sm dark:border-amber-800 dark:bg-amber-950/40"
                                  rows={3}
                                  value={editingDraftNoteBody}
                                  onChange={(e) => setEditingDraftNoteBody(e.target.value)}
                                />
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    disabled={busy}
                                    onClick={() =>
                                      void run(async () => {
                                        if (!editingDraftNoteBody.trim()) {
                                          throw new Error('Note text is required')
                                        }
                                        const result = await updateDraftNote(
                                          note.id,
                                          editingDraftNoteBody,
                                        )
                                        setDrafts(result.drafts)
                                        setEditingDraftNoteId(null)
                                      })
                                    }
                                  >
                                    Save
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setEditingDraftNoteId(null)}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <p className="whitespace-pre-wrap text-sm leading-relaxed text-amber-950 dark:text-amber-100">
                                {note.bodyText}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="border-t border-amber-200/70 bg-amber-100/50 px-3 py-3 md:col-span-1 md:border-t-0 dark:border-amber-800/50 dark:bg-amber-950/60">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-amber-800/80 dark:text-amber-400/80">
                      Attachments
                    </p>
                    {group.attachments.length === 0 ? (
                      <p className="text-xs text-amber-800/50 dark:text-amber-400/50">None</p>
                    ) : (
                      <ul className="space-y-2">
                        {group.attachments.map((a) => (
                          <li
                            key={`draft-att-${a.id}`}
                            className="rounded-lg border border-amber-200/80 bg-white px-2.5 py-2 shadow-sm dark:border-amber-800/50 dark:bg-amber-950/40"
                          >
                            <div className="flex items-start gap-2">
                              <Paperclip className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-semibold text-slate-800 dark:text-amber-100">
                                  {a.originalFilename || a.attachmentKind}
                                </p>
                                <p className="mt-0.5 text-[10px] font-medium text-slate-500">
                                  {a.attachmentKind}
                                </p>
                                <div className="mt-1.5">
                                  <Button
                                    type="button"
                                    size="xs"
                                    variant="destructive"
                                    disabled={busy}
                                    onClick={() =>
                                      void run(async () => {
                                        const result = await deleteDraftAttachment(a.id)
                                        setDrafts(result.drafts)
                                      })
                                    }
                                  >
                                    <Trash2 data-icon="inline-start" /> Delete
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
          {timelineItems.map((item) => {
            if (item.kind === 'mark' || item.kind === 'markBatch') {
              if (!visibility.showMarkingCards) return null
              if (item.kind === 'mark') {
                const { marking } = item
                const revoked = marking.status === 'revoked'
                return (
                  <li
                    id={`workflow-mark-${marking.id}`}
                    key={`mark-${marking.id}`}
                    className={cn(
                      'flex justify-center py-0.5 scroll-mt-24 rounded-lg transition ring-offset-2',
                      highlightedTimelineId === `workflow-mark-${marking.id}` &&
                        'ring-2 ring-[#1769aa]/50',
                    )}
                  >
                    <div
                      className={cn(
                        'inline-flex max-w-full flex-col items-center gap-0.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm',
                        revoked && 'bg-slate-50 text-slate-400',
                      )}
                    >
                      {marking.createdAt ? (
                        <span className="text-[10px] leading-none text-slate-400">
                          {formatDateTime(marking.createdAt)}
                        </span>
                      ) : null}
                      <div className="flex flex-wrap items-center justify-center gap-1.5">
                        <span className={cn('font-medium', revoked && 'line-through')}>
                          {marking.fromUser} {marking.direction === 'reply' ? '↩' : '→'} {marking.toUser}
                        </span>
                        {marking.direction === 'reply' ? <Badge tone="violet">Reply</Badge> : null}
                        {revoked ? (
                          <Badge tone="slate">Revoked</Badge>
                        ) : (
                          <Badge tone={marking.action === 'forward' ? 'amber' : 'slate'}>
                            {markingActionLabel(marking.action)}
                          </Badge>
                        )}
                        {shortPathId(marking.pathId) ? (
                          <Badge tone="slate">Path {shortPathId(marking.pathId)}</Badge>
                        ) : null}
                      </div>
                    </div>
                  </li>
                )
              }
              const { batchId, markings: batchMarks } = item
              const batchMarkedAt = batchMarks.reduce<string | undefined>((best, m) => {
                if (!m.createdAt) return best
                if (!best) return m.createdAt
                return activityTime(m.createdAt, m.id) >= activityTime(best, 0) ? m.createdAt : best
              }, undefined)
              return (
                <li
                  id={`workflow-batch-${batchId}`}
                  key={`batch-${batchId}`}
                  className={cn(
                    'flex justify-center py-0.5 scroll-mt-24 rounded-lg transition ring-offset-2',
                    highlightedTimelineId === `workflow-batch-${batchId}` &&
                      'ring-2 ring-[#1769aa]/50',
                  )}
                >
                  <div className="inline-flex max-w-full flex-col items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-sm">
                    {batchMarkedAt ? (
                      <span className="text-[10px] leading-none text-slate-400">
                        {formatDateTime(batchMarkedAt)}
                      </span>
                    ) : null}
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      {batchMarks[0]?.direction === 'reply' ? 'Replied' : 'Forwarded'} to{' '}
                      {batchMarks.length} user{batchMarks.length === 1 ? '' : 's'} · Batch #{batchId}
                    </span>
                    <div className="flex flex-wrap items-center justify-center gap-1.5">
                      {batchMarks.map((marking) => {
                        const revoked = marking.status === 'revoked'
                        return (
                          <span
                            key={marking.id}
                            className={cn(
                              'inline-flex items-center gap-1 rounded-md border border-slate-100 bg-slate-50 px-2 py-1',
                              revoked && 'text-slate-400',
                            )}
                          >
                            <span className={cn('font-medium', revoked && 'line-through')}>
                              {marking.toUser}
                            </span>
                            {revoked ? (
                              <Badge tone="slate">Revoked</Badge>
                            ) : (
                              <Badge tone={marking.action === 'forward' ? 'amber' : 'slate'}>
                                {markingActionLabel(marking.action)}
                              </Badge>
                            )}
                            {shortPathId(marking.pathId) ? (
                              <span className="font-mono text-[10px] text-slate-400">
                                {shortPathId(marking.pathId)}
                              </span>
                            ) : null}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                </li>
              )
            }

            const { incident } = item
            const meName = (me.name || '').trim().toLowerCase()
            const authoredByMe =
              incident.notes.length > 0 &&
              Boolean(meName) &&
              incident.notes.every((n) => (n.authorUser || '').trim().toLowerCase() === meName)
            const isOwnComments = visibility.highlightOwnComments && authoredByMe
            return (
              <li
                id={`workflow-incident-${incident.key}`}
                key={`incident-${incident.key}`}
                className={cn(
                  'scroll-mt-24 overflow-hidden rounded-xl border shadow-sm transition ring-offset-2',
                  isOwnComments
                    ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800/60 dark:bg-emerald-950/40'
                    : 'border-slate-200 bg-white',
                  highlightedTimelineId === `workflow-incident-${incident.key}` &&
                    'ring-2 ring-[#1769aa]/50',
                )}
              >
                <div className="grid grid-cols-1 md:grid-cols-3">
                  <div
                    className={cn(
                      'divide-y px-4 py-1 md:col-span-2 md:border-r',
                      isOwnComments
                        ? 'divide-emerald-200/70 md:border-emerald-200/70 dark:divide-emerald-800/50 dark:md:border-emerald-800/50'
                        : 'divide-slate-100 md:border-slate-100',
                    )}
                  >
                    {incident.notes.length === 0 ? (
                      <>
                        <p className="pt-3 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                          Comments
                        </p>
                        <p className="pb-3 text-xs text-slate-400">None</p>
                      </>
                    ) : (
                      groupNotesByAuthor(incident.notes).flatMap((group) => {
                        const author = group[0]?.authorUser ?? ''
                        const isOwnAuthor =
                          visibility.highlightOwnComments &&
                          Boolean(meName) &&
                          author.trim().toLowerCase() === meName
                        const hasResponse = group.some((n) => n.isResponse)
                        const groupEditable = group.some((n) => n.editable)
                        const groupKey = `note-group-${group[0]?.id ?? author}`
                        const authorSubtitle = contentAuthorSubtitle(
                          incident.key,
                          author,
                          allMarkings,
                        )
                        return [
                          <div key={`${groupKey}-heading`} className="pt-3 pb-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <p
                                className={cn(
                                  'text-base font-bold tracking-wide',
                                  isOwnAuthor
                                    ? 'text-emerald-900 dark:text-emerald-300'
                                    : 'text-slate-700',
                                )}
                              >
                                {author}
                              </p>
                              {isOwnAuthor ? (
                                <span className="rounded-full bg-emerald-200/80 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-emerald-900">
                                  YOU
                                </span>
                              ) : null}
                              {hasResponse && <Badge>Response</Badge>}
                              {!groupEditable && (
                                <Lock
                                  className={cn(
                                    'size-3.5',
                                    isOwnAuthor
                                      ? 'text-emerald-700/70 dark:text-emerald-400/80'
                                      : 'text-slate-400',
                                  )}
                                  aria-label="Locked"
                                />
                              )}
                            </div>
                            {authorSubtitle ? (
                              <p
                                className={cn(
                                  'mt-0.5 text-[11px]',
                                  isOwnAuthor
                                    ? 'text-emerald-800/75 dark:text-emerald-300/75'
                                    : 'text-slate-500',
                                )}
                              >
                                {authorSubtitle}
                              </p>
                            ) : null}
                          </div>,
                          <div key={groupKey} className="py-1">
                            {group.map((note) => (
                              <div
                                key={note.id}
                                className={cn(
                                  'border-t py-2.5 first:border-t-0',
                                  isOwnComments
                                    ? 'border-emerald-100 dark:border-emerald-900/40'
                                    : 'border-slate-50',
                                )}
                              >
                                <div
                                  className={cn(
                                    'mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]',
                                    isOwnComments
                                      ? 'text-emerald-800/80 dark:text-emerald-300/80'
                                      : 'text-slate-500',
                                  )}
                                >
                                  <span
                                    className={cn(
                                      'inline-flex min-w-7 items-center justify-center rounded-full px-2 py-0.5 text-base font-bold tabular-nums leading-none',
                                      isOwnComments
                                        ? 'bg-emerald-200/90 text-emerald-950 dark:bg-emerald-800/80 dark:text-emerald-100'
                                        : 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100',
                                    )}
                                    aria-label={`Comment ${noteSerialById.get(note.id) ?? ''}`}
                                  >
                                    {noteSerialById.get(note.id) ?? '—'}
                                  </span>
                                  {visibility.showCommentMeta ? (
                                    <>
                                      <span>
                                        {note.createdAt ? formatDateTime(note.createdAt) : ''}
                                      </span>
                                      {note.clientIp ? <span>IP {note.clientIp}</span> : null}
                                    </>
                                  ) : null}
                                  {note.isResponse ? (
                                    <span
                                      className={cn(
                                        'font-medium',
                                        isOwnComments
                                          ? 'text-emerald-900 dark:text-emerald-300'
                                          : 'text-slate-600',
                                      )}
                                    >
                                      Response
                                    </span>
                                  ) : null}
                                  {note.editable && (
                                    <span className="ml-auto flex flex-wrap gap-1.5">
                                      <Button
                                        type="button"
                                        size="xs"
                                        variant="outline"
                                        onClick={() => {
                                          setEditingNoteId(note.id)
                                          setEditingNoteBody(note.bodyText)
                                        }}
                                      >
                                        <Pencil data-icon="inline-start" /> Edit
                                      </Button>
                                      <Button
                                        type="button"
                                        size="xs"
                                        variant="destructive"
                                        disabled={busy}
                                        onClick={() =>
                                          void run(async () => {
                                            await deleteMarkingNote(note.id)
                                          })
                                        }
                                      >
                                        <Trash2 data-icon="inline-start" /> Delete
                                      </Button>
                                    </span>
                                  )}
                                </div>
                                {editingNoteId === note.id ? (
                                  <div className="space-y-2">
                                    <textarea
                                      className="w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
                                      rows={3}
                                      value={editingNoteBody}
                                      onChange={(e) => setEditingNoteBody(e.target.value)}
                                    />
                                    <div className="flex gap-2">
                                      <Button
                                        size="sm"
                                        disabled={busy}
                                        onClick={() =>
                                          void run(async () => {
                                            await updateMarkingNote(note.id, editingNoteBody)
                                            setEditingNoteId(null)
                                          })
                                        }
                                      >
                                        Save
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setEditingNoteId(null)}
                                      >
                                        Cancel
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <p
                                    className={cn(
                                      'whitespace-pre-wrap text-sm leading-relaxed',
                                      isOwnComments
                                        ? 'text-emerald-950 dark:text-emerald-200'
                                        : 'text-slate-700',
                                    )}
                                  >
                                    {note.bodyText}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>,
                        ]
                      })
                    )}
                  </div>
                  <div
                    className={cn(
                      'border-t px-3 py-3 md:col-span-1 md:border-t-0',
                      isOwnComments
                        ? 'border-emerald-200/70 bg-emerald-100/50 dark:border-emerald-800/50 dark:bg-emerald-950/60'
                        : 'border-slate-100 bg-slate-50/80',
                    )}
                  >
                    <p
                      className={cn(
                        'mb-2 text-[10px] font-bold uppercase tracking-wide',
                        isOwnComments
                          ? 'text-emerald-800/80 dark:text-emerald-400/80'
                          : 'text-slate-500',
                      )}
                    >
                      Attachments
                    </p>
                    {incident.attachments.length === 0 ? (
                      <p className="text-xs text-slate-400">None</p>
                    ) : (
                      <ul className="space-y-2">
                        {incident.attachments.map((a) => (
                          <li
                            key={a.id}
                            className="relative rounded-lg border border-slate-200 bg-white px-2.5 py-2 pr-9 shadow-sm"
                          >
                            <span
                              className="absolute top-1.5 right-1.5 inline-flex min-w-6 items-center justify-center rounded-full bg-slate-200 px-1.5 py-0.5 text-sm font-bold tabular-nums leading-none text-slate-800 dark:bg-slate-700 dark:text-slate-100"
                              aria-label={`Attachment ${attachmentLetterById.get(a.id) ?? ''}`}
                            >
                              {attachmentLetterById.get(a.id) ?? '—'}
                            </span>
                            <div className="flex items-start gap-2">
                              <Paperclip className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-semibold text-slate-800">
                                  {a.originalFilename ||
                                    a.storageKey ||
                                    (a.documentId ? `Document #${a.documentId}` : 'File')}
                                </p>
                                {a.createdBy ? (
                                  <p className="mt-0.5 text-[10px] text-slate-500">{a.createdBy}</p>
                                ) : null}
                                {a.editable ? (
                                  <AppSelect
                                    value={a.attachmentKind}
                                    disabled={busy}
                                    onValueChange={(v) =>
                                      void run(async () => {
                                        await updateMarkingAttachment(a.id, {
                                          attachmentKind: v,
                                        })
                                      })
                                    }
                                    options={ATTACHMENT_KINDS.map((kind) => kind)}
                                    size="sm"
                                    className="mt-1 w-full text-[10px]"
                                  />
                                ) : (
                                  <p className="mt-0.5 text-[10px] font-medium text-slate-500">
                                    {a.attachmentKind}
                                  </p>
                                )}
                                {a.clientIp ? (
                                  <p className="mt-0.5 text-[10px] text-slate-400">IP {a.clientIp}</p>
                                ) : null}
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                  {a.versionId && a.previewable ? (
                                    <Button
                                      type="button"
                                      size="xs"
                                      variant="outline"
                                      onClick={() => setPreviewVersionId(a.versionId)}
                                    >
                                      <Eye data-icon="inline-start" /> Preview
                                    </Button>
                                  ) : null}
                                  {a.versionId ? (
                                    <a
                                      href={documentDownloadUrl(a.versionId)}
                                      target="_blank"
                                      rel="noreferrer"
                                      className={cn(buttonVariants({ size: 'xs', variant: 'outline' }))}
                                    >
                                      <ExternalLink data-icon="inline-start" className="size-3" /> Open
                                    </a>
                                  ) : null}
                                  {a.editable && a.documentId ? (
                                    <label
                                      className={cn(
                                        buttonVariants({ size: 'xs', variant: 'outline' }),
                                        'cursor-pointer',
                                      )}
                                    >
                                      <Replace data-icon="inline-start" className="size-3" /> Replace
                                      <input
                                        type="file"
                                        className="hidden"
                                        onChange={(e) => {
                                          const file = e.target.files?.[0]
                                          e.target.value = ''
                                          if (!file || !a.documentId) return
                                          void run(async () => {
                                            await uploadDocumentVersion(
                                              String(a.documentId),
                                              file,
                                              'Replaced from workflow',
                                            )
                                            await markAttachmentReplaced(a.id, file.name)
                                          })
                                        }}
                                      />
                                    </label>
                                  ) : null}
                                  {a.editable ? (
                                    <Button
                                      type="button"
                                      size="xs"
                                      variant="destructive"
                                      disabled={busy}
                                      onClick={() =>
                                        void run(async () => {
                                          await deleteMarkingAttachment(a.id)
                                        })
                                      }
                                    >
                                      <Trash2 data-icon="inline-start" /> Delete
                                    </Button>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      {previewVersionId !== null && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="flex h-[85vh] w-full max-w-4xl flex-col rounded-xl bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-slate-700">Document preview</p>
              <div className="flex gap-2">
                <a
                  href={documentDownloadUrl(previewVersionId)}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(buttonVariants({ size: 'sm', variant: 'outline' }))}
                >
                  <ExternalLink data-icon="inline-start" className="size-3.5" /> Open / download
                </a>
                <Button size="sm" variant="outline" onClick={() => setPreviewVersionId(null)}>
                  Close
                </Button>
              </div>
            </div>
            <iframe
              title="Document preview"
              src={documentPreviewUrl(previewVersionId)}
              className="min-h-0 flex-1 rounded border border-slate-200 bg-white"
            />
          </div>
        </div>
      )}

      {(dialog === 'forward' || dialog === 'reply') && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-4 shadow-xl">
            <h2 className="text-sm font-bold text-slate-800">
              {dialog === 'reply' ? 'Reply correspondence' : 'Forward correspondence'}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {dialog === 'reply'
                ? 'Confirms reply to the previous sender and publishes drafts prepared with Add Comment / Add Attachment.'
                : 'Confirms forwarding only to users who already have draft comments or attachments.'}
            </p>
            {dialog === 'forward' &&
              recipients.some((r) => myOutboundLeafByUser.has(r.toUser.trim())) && (
                <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
                  {isAdminActor
                    ? 'This recipient already has an active marking from you. Saving updates action / response type (admin). Others must revoke first.'
                    : 'This recipient already has an active marking from you. Revoke it before forwarding again or changing action / response type.'}
                </p>
              )}

            {activeHolds.length > 1 && (
              <div className="mt-3">
                <label className="block text-xs font-medium text-slate-600">
                  {dialog === 'reply' ? 'Replying under which hold?' : 'Forwarding under which hold?'}
                </label>
                <AppSelect
                  value={parentMarkingId != null ? String(parentMarkingId) : ''}
                  onValueChange={(v) => {
                    const id = v ? Number(v) : null
                    setParentMarkingId(id)
                    if (dialog === 'reply' && id != null) {
                      const hold = activeHolds.find((h) => h.id === id)
                      if (hold) {
                        const replyTo =
                          hold.status === 'responded' && hold.fromUser === me.name
                            ? hold.toUser
                            : hold.fromUser
                        setRecipients([{ ...emptyRecipient(), toUser: replyTo, action: 'forward' }])
                        setActiveRecipientIndex(0)
                      }
                    }
                  }}
                  options={[
                    { value: '', label: 'Select hold…' },
                    ...activeHolds.map((h) => ({
                      value: String(h.id),
                      label:
                        h.status === 'responded'
                          ? `Response from ${h.toUser} · ${markingActionLabel(h.action)}${
                              shortPathId(h.pathId) ? ` · Path ${shortPathId(h.pathId)}` : ''
                            }`
                          : `From ${h.fromUser} · ${markingActionLabel(h.action)}${
                              shortPathId(h.pathId) ? ` · Path ${shortPathId(h.pathId)}` : ''
                            }`,
                    })),
                  ]}
                  className="mt-1 w-full text-sm"
                />
              </div>
            )}

            {dialog === 'forward' && recipients.some((r) => r.toUser.trim()) && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {recipients.map((row, idx) => {
                  if (!row.toUser.trim()) return null
                  const isActive = idx === activeRecipientIndex
                  return (
                    <button
                      type="button"
                      key={`recipient-badge-${idx}-${row.toUser}`}
                      className={cn(
                        'inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold',
                        isActive
                          ? 'border-[#1769aa]/40 bg-sky-50 text-slate-800 dark:border-sky-500/40 dark:bg-sky-950/60 dark:text-sky-100'
                          : 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200',
                      )}
                      onClick={() => setActiveRecipientIndex(idx)}
                    >
                      <span className="truncate">{row.toUser}</span>
                      <span
                        className={cn(
                          'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold',
                          row.action === 'response_required'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-200'
                            : row.action === 'for_info'
                              ? 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                              : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-200',
                        )}
                      >
                        {ACTION_LABELS[row.action] ?? markingActionLabel(row.action)}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}

            <div className="mt-3 rounded-lg border border-slate-200 p-3">
              <label className="block text-xs font-medium text-slate-600">User</label>
              <p className="mt-1 rounded border border-slate-100 bg-slate-50 px-2 py-1.5 text-sm font-medium text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                {activeRecipient.toUser || '—'}
              </p>
              <label className="mt-2 block text-xs font-medium text-slate-600">Action</label>
              {dialog === 'reply' ? (
                <p className="mt-1 rounded border border-slate-100 bg-slate-50 px-2 py-1.5 text-sm font-medium text-slate-800">
                  Reply
                </p>
              ) : (
                <AppSelect
                  value={activeRecipient.action}
                  onValueChange={(v) => updateActiveRecipient({ action: v as MarkingAction })}
                  options={MARKING_ACTIONS.map((a) => ({ value: a, label: ACTION_LABELS[a] }))}
                  className="mt-1 w-full text-sm"
                />
              )}
              {dialog === 'forward' && activeRecipient.action === 'response_required' && (
                <>
                  <label className="mt-2 block text-xs font-medium text-slate-600">Response type</label>
                  <AppSelect
                    value={activeRecipient.responseType || 'draft_letter'}
                    onValueChange={(v) => updateActiveRecipient({ responseType: v as ResponseType })}
                    options={RESPONSE_TYPES.map((t) => ({ value: t, label: RESPONSE_TYPE_LABELS[t] }))}
                    className="mt-1 w-full text-sm"
                  />
                  <label className="mt-2 block text-xs font-medium text-slate-600">Due date</label>
                  <input
                    type="date"
                    className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
                    value={activeRecipient.dueAt || ''}
                    onChange={(e) => updateActiveRecipient({ dueAt: e.target.value })}
                  />
                </>
              )}
            </div>

            {drafts && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <p className="font-semibold text-slate-700">Drafts to publish</p>
                {(drafts.commonNoteCount > 0 || drafts.commonAttachmentCount > 0) && (
                  <p className="mt-1">
                    Common: {drafts.commonNoteCount} comment
                    {drafts.commonNoteCount === 1 ? '' : 's'}, {drafts.commonAttachmentCount}{' '}
                    attachment{drafts.commonAttachmentCount === 1 ? '' : 's'}
                  </p>
                )}
                <ul className="mt-1 space-y-0.5">
                  {recipients
                    .filter((r) => r.toUser.trim())
                    .map((r) => {
                      const n = drafts.notes.filter((d) => d.targetUser === r.toUser).length
                      const a = drafts.attachments.filter((d) => d.targetUser === r.toUser).length
                      return (
                        <li key={r.toUser}>
                          {r.toUser}: {n} comment{n === 1 ? '' : 's'}, {a} attachment
                          {a === 1 ? '' : 's'}
                        </li>
                      )
                    })}
                </ul>
              </div>
            )}

            {error && <p className="mt-3 text-xs text-rose-600">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" disabled={busy} onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const direction: MarkingDirection = dialog === 'reply' ? 'reply' : 'forward'
                    const cleaned =
                      direction === 'reply'
                        ? recipients.filter((r) => r.toUser.trim()).slice(0, 1)
                        : recipients.filter((r) => r.toUser.trim())
                    if (!cleaned.length) {
                      throw new Error(
                        'No recipients with drafts. Use Add Comment / Add Attachment first.',
                      )
                    }
                    if (direction === 'forward' && !isAdminActor) {
                      const blocked = cleaned.find((r) =>
                        myOutboundLeafByUser.has(r.toUser.trim()),
                      )
                      if (blocked) {
                        throw new Error(
                          `Active marking already exists from you to '${blocked.toUser}'. ` +
                            'Revoke it before forwarding again or changing action / response type.',
                        )
                      }
                    }
                    if (activeHolds.length > 1 && parentMarkingId == null) {
                      throw new Error(
                        direction === 'reply'
                          ? 'Select which hold you are replying under'
                          : 'Select which hold you are forwarding under',
                      )
                    }
                    const resolvedParent =
                      activeHolds.length === 1
                        ? activeHolds[0]!.id
                        : activeHolds.length > 1
                          ? parentMarkingId
                          : undefined

                    await markLetter(letter.id, {
                      recipients: cleaned.map((r) => {
                        const action: MarkingAction =
                          direction === 'reply' ? 'forward' : r.action
                        return {
                          ...r,
                          action,
                          instructions: '',
                          track: true,
                          responseType:
                            action === 'response_required' ? r.responseType || 'draft_letter' : undefined,
                          remindersEnabled: action === 'response_required',
                        }
                      }),
                      remarks: '',
                      pathwayNotify: false,
                      parentMarkingId: resolvedParent ?? undefined,
                      direction,
                      consumeDrafts: true,
                    })
                  })
                }
              >
                {dialog === 'reply' ? 'Reply' : 'Forward'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {(dialog === 'note' || dialog === 'respond') && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl">
            <h2 className="text-sm font-bold">
              {dialog === 'note'
                ? draftIntent === 'reply'
                  ? 'Add Reply Comment'
                  : 'Add Forwarding Comment'
                : 'Submit response'}
            </h2>
            {dialog === 'note' && (
              <div className="mt-2 space-y-2">
                {draftIntent === 'reply' ? (
                  <>
                    {activeHolds.length > 1 && (
                      <div>
                        <label className="block text-xs font-medium text-slate-600">
                          Replying under which hold?
                        </label>
                        <AppSelect
                          value={contextMarkingId != null ? String(contextMarkingId) : ''}
                          onValueChange={(v) => {
                            const id = v ? Number(v) : null
                            setContextMarkingId(id)
                            const hold = activeHolds.find((h) => h.id === id)
                            if (hold) setDraftTargetUser(replyTargetForHold(hold, me.name))
                          }}
                          options={[
                            { value: '', label: 'Select hold…' },
                            ...activeHolds.map((h) => ({
                              value: String(h.id),
                              label: `From ${h.fromUser} · ${markingActionLabel(h.action)}`,
                            })),
                          ]}
                          className="mt-1 w-full text-sm"
                        />
                      </div>
                    )}
                    <div>
                      <label className="block text-xs font-medium text-slate-600">Recipient</label>
                      <p className="mt-1 rounded border border-slate-100 bg-slate-50 px-2 py-1.5 text-sm font-medium text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                        {draftTargetUser || '—'}
                      </p>
                    </div>
                  </>
                ) : (
                  <div>
                    <label className="block text-xs font-medium text-slate-600">Recipient</label>
                    <AppSelect
                      value={draftTargetUser || '__common__'}
                      onValueChange={(v) => setDraftTargetUser(v === '__common__' ? '' : v)}
                      options={[
                        { value: '__common__', label: 'Common to all recipients' },
                        ...users
                          .filter((u) => u.name !== me.name)
                          .map((u) => ({ value: u.name, label: u.name })),
                      ]}
                      className="mt-1 w-full text-sm"
                    />
                  </div>
                )}
              </div>
            )}
            {dialog === 'respond' && rrHoldsForMe.length > 1 && (
              <div className="mt-2">
                <label className="block text-xs font-medium text-slate-600">Respond to</label>
                <AppSelect
                  value={respondMarkingId != null ? String(respondMarkingId) : ''}
                  onValueChange={(v) => setRespondMarkingId(v ? Number(v) : null)}
                  options={[
                    { value: '', label: 'Select Response Required…' },
                    ...rrHoldsForMe.map((h) => ({
                      value: String(h.id),
                      label: `From ${h.fromUser}${h.dueAt ? ` · due ${h.dueAt}` : ''}`,
                    })),
                  ]}
                  className="mt-1 w-full text-sm"
                />
              </div>
            )}
            <textarea
              className="mt-2 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
              rows={4}
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              placeholder={dialog === 'note' ? 'Your input…' : 'Your response…'}
            />
            <p className="mt-2 text-[11px] text-slate-400">
              Use{' '}
              <span className="font-medium">
                {draftIntent === 'reply' ? 'Add Reply Attachment' : 'Add Forwarding Attachment'}
              </span>{' '}
              to attach files separately.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setDialog(null)
                  setNoteBody('')
                }}
              >
                Cancel
              </Button>
              {dialog === 'note' ? (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      if (!noteBody.trim()) throw new Error('Note text is required')
                      if (draftIntent === 'reply' && !draftTargetUser.trim()) {
                        throw new Error('Select which hold you are drafting a reply under')
                      }
                      const result = await addDraftNote(letter.id, {
                        bodyText: noteBody,
                        targetUser: draftTargetUser,
                        intent: draftIntent,
                      })
                      setDrafts(result.drafts)
                    })
                  }
                >
                  Save draft
                </Button>
              ) : (
                <Button
                  disabled={busy || !respondMarkingId}
                  onClick={() =>
                    void run(async () => {
                      if (!respondMarkingId) throw new Error('No open Response Required marking')
                      if (!noteBody.trim()) throw new Error('Response text is required')
                      await respondToMarking(respondMarkingId, { bodyText: noteBody })
                    })
                  }
                >
                  <CornerUpLeft className="mr-1 h-3.5 w-3.5" /> Submit
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {dialog === 'attach' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-4 shadow-xl">
            <h2 className="text-sm font-bold">
              {draftIntent === 'reply' ? 'Add Reply Attachment' : 'Add Forwarding Attachment'}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Draft for a recipient, then confirm with{' '}
              {draftIntent === 'reply' ? 'Reply' : 'Forward'}.
            </p>
            <div className="mt-2 space-y-2">
              {draftIntent === 'reply' ? (
                <>
                  {activeHolds.length > 1 && (
                    <div>
                      <label className="block text-xs font-medium text-slate-600">
                        Replying under which hold?
                      </label>
                      <AppSelect
                        value={contextMarkingId != null ? String(contextMarkingId) : ''}
                        onValueChange={(v) => {
                          const id = v ? Number(v) : null
                          setContextMarkingId(id)
                          const hold = activeHolds.find((h) => h.id === id)
                          if (hold) setDraftTargetUser(replyTargetForHold(hold, me.name))
                        }}
                        options={[
                          { value: '', label: 'Select hold…' },
                          ...activeHolds.map((h) => ({
                            value: String(h.id),
                            label: `From ${h.fromUser} · ${markingActionLabel(h.action)}`,
                          })),
                        ]}
                        className="mt-1 w-full text-sm"
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-medium text-slate-600">Recipient</label>
                    <p className="mt-1 rounded border border-slate-100 bg-slate-50 px-2 py-1.5 text-sm font-medium text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                      {draftTargetUser || '—'}
                    </p>
                  </div>
                </>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-slate-600">Recipient</label>
                  <AppSelect
                    value={draftTargetUser || '__common__'}
                    onValueChange={(v) => setDraftTargetUser(v === '__common__' ? '' : v)}
                    options={[
                      { value: '__common__', label: 'Common to all recipients' },
                      ...users
                        .filter((u) => u.name !== me.name)
                        .map((u) => ({ value: u.name, label: u.name })),
                    ]}
                    className="mt-1 w-full text-sm"
                  />
                </div>
              )}
            </div>
            <div className="mt-3 rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[8rem] flex-1">
                  <label className="block text-[11px] font-medium text-slate-500">Type</label>
                  <AppSelect
                    value={defaultKind}
                    onValueChange={(v) => setDefaultKind(v as AttachmentKind)}
                    options={ATTACHMENT_KINDS.map((kind) => kind)}
                    className="mt-1 w-full text-sm"
                  />
                </div>
                <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                  <Paperclip className="h-3.5 w-3.5" />
                  Choose files
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files || [])
                      if (!files.length) return
                      setPendingFiles((prev) => [
                        ...prev,
                        ...files.map((file) => ({
                          id: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
                          file,
                          kind: defaultKind,
                        })),
                      ])
                      e.target.value = ''
                    }}
                  />
                </label>
              </div>
              {pendingFiles.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {pendingFiles.map((item) => (
                    <li key={item.id} className="flex items-center gap-2 text-xs text-slate-700">
                      <AppSelect
                        value={item.kind}
                        onValueChange={(v) => {
                          const kind = v as AttachmentKind
                          setPendingFiles((prev) =>
                            prev.map((row) => (row.id === item.id ? { ...row, kind } : row)),
                          )
                        }}
                        options={ATTACHMENT_KINDS.map((kind) => kind)}
                        size="sm"
                        className="min-w-24"
                      />
                      <span className="min-w-0 flex-1 truncate">{item.file.name}</span>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        onClick={() =>
                          setPendingFiles((prev) => prev.filter((row) => row.id !== item.id))
                        }
                        aria-label="Remove file"
                      >
                        <X />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setDialog(null)
                  setPendingFiles([])
                }}
              >
                Cancel
              </Button>
              <Button
                disabled={busy || !canAddAttachment || pendingFiles.length === 0}
                onClick={() =>
                  void run(async () => {
                    if (!pendingFiles.length) throw new Error('Choose at least one file')
                    if (draftIntent === 'reply' && !draftTargetUser.trim()) {
                      throw new Error('Select which hold you are drafting a reply under')
                    }
                    const uploaded = await uploadPendingAttachments()
                    const result = await addDraftAttachments(
                      letter.id,
                      uploaded,
                      draftTargetUser,
                      draftIntent,
                    )
                    setDrafts(result.drafts)
                  })
                }
              >
                Save draft
              </Button>
            </div>
          </div>
        </div>
      )}

      {dialog === 'revoke' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-4 shadow-xl">
            <h2 className="text-sm font-bold">Revoke markings</h2>
            <p className="mt-1 text-xs text-slate-500">
              Revoke a mark only if the recipient has not remade it or added comments/attachments.
            </p>
            {revokableMarkings.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500">No markings available to revoke.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {revokableMarkings.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">{m.toUser}</p>
                      <p className="text-[11px] text-slate-500">
                        {markingActionLabel(m.action)}
                        {shortPathId(m.pathId) ? ` · Path ${shortPathId(m.pathId)}` : ''}
                        {m.createdAt ? ` · ${formatDateTime(m.createdAt)}` : ''}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={busy}
                      onClick={() =>
                        void (async () => {
                          busyRef.current = true
                          setBusy(true)
                          setError('')
                          try {
                            await revokeMarking(m.id)
                            await onDone()
                            await load()
                          } catch (err) {
                            setError(err instanceof Error ? err.message : 'Revoke failed')
                          } finally {
                            busyRef.current = false
                            setBusy(false)
                          }
                        })()
                      }
                    >
                      Revoke
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {error && <p className="mt-3 text-xs text-rose-600">{error}</p>}
            <div className="mt-4 flex justify-end">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setDialog(null)
                  setError('')
                }}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {nodeDialog && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-slate-900/40 p-4">
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-slate-800">Your comments &amp; attachments</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {nodeDialog.toUser}
                  {nodeDialog.actionLabel ? ` · ${nodeDialog.actionLabel}` : ''}
                  {nodeDialog.pathLabel ? ` · Path ${nodeDialog.pathLabel}` : ''}
                </p>
              </div>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                onClick={() => {
                  setNodeDialog(null)
                  setNodeEvents([])
                }}
                aria-label="Close"
              >
                <X />
              </Button>
            </div>
            {(() => {
              const meName = (me.name || '').trim()
              const relatedIds = relatedMarkingIdsForNode(nodeDialog, meName, allMarkings)
              const inRelated = (markingId: number | null | undefined) =>
                relatedIds.has(markingId == null ? null : Number(markingId))
              const myNotes = notes.filter(
                (n) => sameWorkflowUser(n.authorUser, meName) && inRelated(n.markingId),
              )
              const myAttachments = attachments.filter(
                (a) => sameWorkflowUser(a.createdBy, meName) && inRelated(a.markingId),
              )
              const myEvents = nodeEvents.filter(
                (ev) =>
                  sameWorkflowUser(ev.actorUser, meName) && inRelated(ev.markingId),
              )
              // Older files may predate the archive table — surface them as "added".
              const archiveRows: {
                key: string
                eventType: string
                filename: string
                createdAt: string
                versionId: number | null
                previewable: boolean
              }[] =
                myEvents.length > 0
                  ? myEvents.map((ev) => {
                      const live = myAttachments.find((a) => a.id === ev.attachmentId)
                      return {
                        key: `ev-${ev.id}`,
                        eventType: ev.eventType,
                        filename: ev.originalFilename || 'file',
                        createdAt: ev.createdAt || '',
                        versionId: ev.versionId ?? live?.versionId ?? null,
                        previewable: Boolean(live?.previewable && (ev.versionId ?? live?.versionId)),
                      }
                    })
                  : myAttachments.map((a) => ({
                      key: `att-${a.id}`,
                      eventType: 'added',
                      filename: a.originalFilename || `File #${a.id}`,
                      createdAt: a.createdAt || '',
                      versionId: a.versionId,
                      previewable: Boolean(a.previewable && a.versionId),
                    }))
              return (
                <div className="space-y-4 text-xs">
                  <div>
                    <p className="mb-1.5 font-semibold uppercase tracking-wide text-slate-500">
                      Comments ({myNotes.length})
                    </p>
                    {myNotes.length === 0 ? (
                      <p className="text-slate-400">No comments from you on this step.</p>
                    ) : (
                      <ul className="space-y-2">
                        {myNotes.map((n) => (
                          <li
                            key={n.id}
                            className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-slate-700"
                          >
                            <p className="whitespace-pre-wrap">{n.bodyText}</p>
                            <p className="mt-1 text-[10px] text-slate-400">
                              {n.createdAt ? formatDateTime(n.createdAt) : ''}
                              {n.isResponse ? ' · Response' : ''}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <p className="mb-1.5 font-semibold uppercase tracking-wide text-slate-500">
                      Attachments ({myAttachments.length})
                    </p>
                    {myAttachments.length === 0 ? (
                      <p className="text-slate-400">No live attachments from you on this step.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {myAttachments.map((a) => (
                          <li
                            key={a.id}
                            className="rounded-md border border-slate-200 px-2.5 py-2"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate font-medium text-slate-700">
                                  {a.originalFilename || `File #${a.id}`}
                                </p>
                                <p className="text-[10px] text-slate-400">{a.attachmentKind}</p>
                              </div>
                            </div>
                            {a.versionId ? (
                              <div className="mt-1.5 flex flex-wrap gap-1.5">
                                {a.previewable ? (
                                  <Button
                                    type="button"
                                    size="xs"
                                    variant="outline"
                                    onClick={() => setPreviewVersionId(a.versionId)}
                                  >
                                    <Eye data-icon="inline-start" /> Preview
                                  </Button>
                                ) : null}
                                <a
                                  href={documentDownloadUrl(a.versionId)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className={cn(buttonVariants({ size: 'xs', variant: 'outline' }))}
                                >
                                  <ExternalLink data-icon="inline-start" className="size-3" /> Open
                                </a>
                              </div>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <p className="mb-1.5 font-semibold uppercase tracking-wide text-slate-500">
                      Archive trail ({archiveRows.length})
                    </p>
                    <p className="mb-1.5 text-[10px] text-slate-400">
                      Add / replace / remove history kept even when a senior replaces your file.
                    </p>
                    {nodeEventsLoading ? (
                      <p className="text-slate-400">Loading archive…</p>
                    ) : archiveRows.length === 0 ? (
                      <p className="text-slate-400">No archive events yet.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {archiveRows.map((row) => (
                          <li
                            key={row.key}
                            className="rounded-md border border-slate-100 bg-slate-50 px-2.5 py-1.5 text-slate-600"
                          >
                            <div>
                              <span className="font-semibold capitalize text-slate-700">{row.eventType}</span>
                              {' · '}
                              {row.filename}
                              <span className="mt-0.5 block text-[10px] text-slate-400">
                                {row.createdAt ? formatDateTime(row.createdAt) : ''}
                              </span>
                            </div>
                            {row.versionId ? (
                              <div className="mt-1.5 flex flex-wrap gap-1.5">
                                {row.previewable ? (
                                  <Button
                                    type="button"
                                    size="xs"
                                    variant="outline"
                                    onClick={() => setPreviewVersionId(row.versionId)}
                                  >
                                    <Eye data-icon="inline-start" /> Preview
                                  </Button>
                                ) : null}
                                <a
                                  href={documentDownloadUrl(row.versionId)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className={cn(buttonVariants({ size: 'xs', variant: 'outline' }))}
                                >
                                  <ExternalLink data-icon="inline-start" className="size-3" /> Open
                                </a>
                              </div>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )
            })()}
            <div className="mt-4 flex justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setNodeDialog(null)
                  setNodeEvents([])
                }}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {dialog === 'close' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl">
            <h2 className="text-sm font-bold">Close correspondence</h2>
            {pendingRrLeaves.length > 0 && (
              <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
                <p className="font-semibold">
                  {pendingRrLeaves.length} open Response Required marking
                  {pendingRrLeaves.length === 1 ? '' : 's'} across branches
                </p>
                <ul className="mt-1 list-inside list-disc space-y-0.5">
                  {pendingRrLeaves.map((m) => (
                    <li key={m.id}>
                      {m.toUser}
                      {m.dueAt ? ` · due ${m.dueAt}` : ''} (from {m.fromUser})
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[11px] text-amber-800/80">
                  Check force close below to close anyway, or wait for responses.
                </p>
              </div>
            )}
            <textarea
              className="mt-2 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
              rows={2}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Close remarks"
            />
            <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={forceClose} onChange={(e) => setForceClose(e.target.checked)} />
              Force close even if Response Required markings are still open
            </label>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button
                disabled={busy || (pendingRrLeaves.length > 0 && !forceClose)}
                onClick={() =>
                  void run(async () => {
                    await closeMarkedLetter(letter.id, { remarks, force: forceClose })
                  })
                }
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </CollapsibleCard>
  )
}
