'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  CheckCircle2,
  CornerUpLeft,
  ExternalLink,
  Eye,
  Lock,
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
import { isRichTextEmpty, richTextDedupeKey } from '@/lib/rich-text'
import { CollapsibleCard } from '@/components/ui/collapsible-card'
import {
  DraftCommentsComposer,
  DraftCommentsPreviewCard,
  type DraftCommentPreviewData,
  type DraftCommentsComposerHandle,
} from '@/components/cms/draft-comments-composer'
import { RichTextEditor } from '@/components/cms/rich-text-editor'
import { RichTextHtml } from '@/components/cms/rich-text-html'
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
} from '@/services/documents'
import {
  ACTION_LABELS,
  ATTACHMENT_KINDS,
  RESPONSE_TYPE_LABELS,
  type ResponseType,
} from '@/services/marking-types'
import {
  acceptInboxLetter,
  closeMarkedLetter,
  deleteDraftAttachment,
  deleteDraftNote,
  deleteMarkingAttachment,
  deleteMarkingNote,
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
  putDraftRoster,
  rejectInboxLetter,
  markingActionLabel,
  revokeMarking,
  shortPathId,
  updateMarkingAttachment,
  updateMarkingNote,
  type AttachmentEvent,
  type CorrespondenceAttachment,
  type CorrespondenceNote,
  type MarkRecipientInput,
  type MarkingDrafts,
  type MarkingNode,
} from '@/services/markings'

type WorkflowUser = { name: string; avatarUrl?: string; department?: string }

type MarkingIncidentKey = number | 'root'
type ContentIncidentKey = MarkingIncidentKey | `batch:${number}`

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
 * Batch cards use internal "For {name}" sections — only show remade timing here.
 */
function contentAuthorSubtitle(
  incidentKey: ContentIncidentKey,
  author: string,
  markings: MarkingNode[],
): string | undefined {
  const authorNorm = (author || '').trim().toLowerCase()
  if (!authorNorm) return undefined

  if (typeof incidentKey === 'string' && incidentKey.startsWith('batch:')) {
    const batchId = Number(incidentKey.slice('batch:'.length))
    const mine = markings.find(
      (m) =>
        m.batchId === batchId && (m.fromUser || '').trim().toLowerCase() === authorNorm,
    )
    if (mine?.createdAt) return `Marked onward ${formatDateTime(mine.createdAt)}`
    return undefined
  }

  if (incidentKey !== 'root' && typeof incidentKey === 'number') {
    const marking = markings.find((m) => m.id === incidentKey)
    if (marking && (marking.fromUser || '').trim().toLowerCase() === authorNorm) {
      const markedAt = marking.createdAt ? formatDateTime(marking.createdAt) : ''
      return markedAt ? `Marked onward ${markedAt}` : undefined
    }
  }

  const remadeAt = onwardMarkedAt(
    typeof incidentKey === 'number' || incidentKey === 'root' ? incidentKey : 'root',
    author,
    markings,
  )
  if (remadeAt) return `Marked onward ${formatDateTime(remadeAt)}`
  return undefined
}

/** Batch / single-mark cluster time for keeping content next to its mark chip. */
function timelineClusterKey(item: TimelineItem, markingsById: Map<number, MarkingNode>): string {
  if (item.kind === 'markBatch') return `batch:${item.batchId}`
  if (item.kind === 'mark') return `batch:${item.marking.batchId}`
  if (item.kind === 'content') {
    const key = item.incident.key
    if (typeof key === 'string' && key.startsWith('batch:')) return key
    if (key !== 'root' && typeof key === 'number') {
      const marking = markingsById.get(key)
      if (marking) return `batch:${marking.batchId}`
    }
  }
  return `content:${item.kind === 'content' ? item.incident.key : 'x'}`
}

function emptyRecipient(toUser = ''): MarkRecipientInput {
  return { toUser, action: 'forward', track: true, remindersEnabled: true }
}

/** Immediate sender for a Reply: previous marker, or RR respondent when hold was returned. */
function resolveImmediateReplyTarget(hold: MarkingNode, meName: string): string {
  const me = (meName || '').trim()
  if (hold.status === 'responded' && (hold.fromUser || '').trim() === me) {
    return (hold.toUser || '').trim()
  }
  return (hold.fromUser || '').trim()
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

function markingKey(id: number | null | undefined): MarkingIncidentKey {
  return id == null ? 'root' : id
}

function contentSectionLabel(forUser: string | null | undefined): string {
  return (forUser || '').trim()
}

/** Common (empty forUser) first, then alphabetical "For {name}" sections. */
function partitionByForUser<T extends { forUser?: string }>(
  items: T[],
): { label: string; items: T[] }[] {
  const common: T[] = []
  const byUser = new Map<string, T[]>()
  for (const item of items) {
    const label = contentSectionLabel(item.forUser)
    if (!label) {
      common.push(item)
      continue
    }
    if (!byUser.has(label)) byUser.set(label, [])
    byUser.get(label)!.push(item)
  }
  const sections: { label: string; items: T[] }[] = []
  if (common.length) sections.push({ label: '', items: common })
  for (const label of [...byUser.keys()].sort((a, b) => a.localeCompare(b))) {
    sections.push({ label, items: byUser.get(label)! })
  }
  return sections
}

/** Dedupe common (forUser empty) notes copied onto every recipient marking in a batch. */
function dedupeCommonNotes(notes: CorrespondenceNote[]): CorrespondenceNote[] {
  const seen = new Set<string>()
  const out: CorrespondenceNote[] = []
  const sorted = [...notes].sort((a, b) => a.id - b.id)
  for (const n of sorted) {
    if (contentSectionLabel(n.forUser)) {
      out.push(n)
      continue
    }
    const key = `${(n.authorUser || '').toLowerCase()}|${richTextDedupeKey(n.bodyText)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(n)
  }
  return out
}

function dedupeCommonAttachments(
  attachments: CorrespondenceAttachment[],
): CorrespondenceAttachment[] {
  const seen = new Set<string>()
  const out: CorrespondenceAttachment[] = []
  const sorted = [...attachments].sort((a, b) => a.id - b.id)
  for (const a of sorted) {
    if (contentSectionLabel(a.forUser)) {
      out.push(a)
      continue
    }
    const key = `${(a.createdBy || '').toLowerCase()}|${a.documentId ?? ''}|${a.originalFilename || a.storageKey}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(a)
  }
  return out
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
  /** Show active holders strip (parallel leaves). */
  showActiveHolds: boolean
  /** Show React Flow marking pathway graph. */
  showFlowGraph: boolean
  /** Show centered mark chips (e.g. A. Rahman → N. Ahmed). */
  showMarkingCards: boolean
}

const DEFAULT_WORKFLOW_VISIBILITY: WorkflowVisibility = {
  highlightOwnComments: true,
  showActiveHolds: true,
  showFlowGraph: true,
  showMarkingCards: true,
}

function readWorkflowVisibility(): WorkflowVisibility {
  if (typeof window === 'undefined') return DEFAULT_WORKFLOW_VISIBILITY
  try {
    const raw = localStorage.getItem(WORKFLOW_VISIBILITY_KEY)
    if (!raw) return DEFAULT_WORKFLOW_VISIBILITY
    const parsed = JSON.parse(raw) as Partial<WorkflowVisibility> & {
      showStepper?: boolean
      showCommentMeta?: boolean
    }
    const { showStepper, showCommentMeta: _removedCommentMeta, ...rest } = parsed
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

type BatchRecipient = {
  toUser: string
  action: string
}

type ContentIncident = {
  key: ContentIncidentKey
  /** Marking ids in this card (for scroll / highlight anchors). */
  markingIds: number[]
  /** All To / For Info recipients on the mark batch (when known). */
  recipients: BatchRecipient[]
  notes: CorrespondenceNote[]
  attachments: CorrespondenceAttachment[]
}

function isInfoAction(action: string | null | undefined) {
  return (action || '').trim().toLowerCase() === 'for_info'
}

/** Prefer actionable To over Info if the same name appears twice. */
function mergeBatchRecipient(
  map: Map<string, BatchRecipient>,
  toUser: string,
  action: string,
) {
  const name = (toUser || '').trim()
  if (!name) return
  const nextAction = (action || 'forward').trim() || 'forward'
  const prev = map.get(name.toLowerCase())
  if (!prev) {
    map.set(name.toLowerCase(), { toUser: name, action: nextAction })
    return
  }
  if (isInfoAction(prev.action) && !isInfoAction(nextAction)) {
    map.set(name.toLowerCase(), { toUser: name, action: nextAction })
  }
}

type TimelineItem =
  | { kind: 'mark'; marking: MarkingNode; sortAt: number }
  | { kind: 'markBatch'; batchId: number; markings: MarkingNode[]; sortAt: number }
  | { kind: 'content'; incident: ContentIncident; sortAt: number }

/**
 * Group notes + attachments into one card per mark batch (multi-recipient marks
 * share a card). Common content is deduped; To-specific rows keep forUser labels.
 */
function groupContentIncidents(
  markings: MarkingNode[],
  notes: CorrespondenceNote[],
  attachments: CorrespondenceAttachment[],
): ContentIncident[] {
  const markingsById = new Map(markings.map((m) => [m.id, m]))
  type Acc = {
    key: ContentIncidentKey
    markingIds: Set<number>
    recipients: Map<string, BatchRecipient>
    notes: CorrespondenceNote[]
    attachments: CorrespondenceAttachment[]
  }
  const map = new Map<string, Acc>()
  const ensure = (key: ContentIncidentKey, markingId: number | null) => {
    const mapKey = String(key)
    if (!map.has(mapKey)) {
      map.set(mapKey, {
        key,
        markingIds: new Set(),
        recipients: new Map(),
        notes: [],
        attachments: [],
      })
    }
    const acc = map.get(mapKey)!
    if (markingId != null) acc.markingIds.add(markingId)
    return acc
  }
  const resolveKey = (
    markingId: number | null | undefined,
    batchId?: number | null,
  ): ContentIncidentKey => {
    // Prefer batchId from the API so recipients still merge sibling copies even when
    // sibling markings are hidden from their pathway tree.
    if (batchId != null && Number.isFinite(Number(batchId))) {
      return `batch:${Number(batchId)}`
    }
    if (markingId == null) return 'root'
    const marking = markingsById.get(markingId)
    if (marking) return `batch:${marking.batchId}`
    return markingKey(markingId)
  }
  const rememberRecipient = (
    acc: Acc,
    markingId: number | null | undefined,
    toUser?: string | null,
    markingAction?: string | null,
  ) => {
    if (toUser) {
      mergeBatchRecipient(acc.recipients, toUser, markingAction || 'forward')
      return
    }
    if (markingId == null) return
    const marking = markingsById.get(markingId)
    if (marking) mergeBatchRecipient(acc.recipients, marking.toUser, marking.action)
  }

  const notesDesc = [...notes].sort(
    (a, b) => activityTime(b.createdAt, b.id) - activityTime(a.createdAt, a.id),
  )
  const attachmentsDesc = [...attachments].sort(
    (a, b) => activityTime(b.createdAt, b.id) - activityTime(a.createdAt, a.id),
  )
  for (const note of notesDesc) {
    const key = resolveKey(note.markingId, note.batchId)
    const acc = ensure(key, note.markingId)
    rememberRecipient(acc, note.markingId, note.toUser, note.markingAction)
    acc.notes.push(note)
  }
  for (const att of attachmentsDesc) {
    const key = resolveKey(att.markingId, att.batchId)
    const acc = ensure(key, att.markingId)
    rememberRecipient(acc, att.markingId, att.toUser, att.markingAction)
    acc.attachments.push(att)
  }

  // Fill any remaining batch siblings from the pathway tree (Info with no notes, etc.).
  for (const acc of map.values()) {
    if (typeof acc.key !== 'string' || !acc.key.startsWith('batch:')) continue
    const batchId = Number(acc.key.slice('batch:'.length))
    for (const m of markings) {
      if (m.batchId !== batchId || m.status === 'revoked') continue
      mergeBatchRecipient(acc.recipients, m.toUser, m.action)
    }
  }

  return [...map.values()].map((acc) => ({
    key: acc.key,
    markingIds: [...acc.markingIds],
    recipients: [...acc.recipients.values()].sort((a, b) =>
      a.toUser.localeCompare(b.toUser, undefined, { sensitivity: 'base' }),
    ),
    // Always dedupe common copies (fan-out publishes the same common note on each hop).
    notes: dedupeCommonNotes(acc.notes),
    attachments: dedupeCommonAttachments(acc.attachments),
  }))
}

function hasCommonContent(incident: ContentIncident) {
  return (
    incident.notes.some((n) => !contentSectionLabel(n.forUser)) ||
    incident.attachments.some((a) => !contentSectionLabel(a.forUser))
  )
}

function ContentRecipientRoster({
  recipients,
  show,
  mutedClassName,
}: {
  recipients: BatchRecipient[]
  show: boolean
  mutedClassName?: string
}) {
  if (!show || recipients.length === 0) return null
  const toRecipients = recipients.filter((r) => !isInfoAction(r.action))
  const infoRecipients = recipients.filter((r) => isInfoAction(r.action))
  if (toRecipients.length === 0 && infoRecipients.length === 0) return null

  const recipientBadgeClass =
    'inline-flex items-center rounded-md border border-slate-300 bg-transparent px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:border-slate-500 dark:text-white'

  return (
    <div className={cn('mt-1.5 space-y-1', mutedClassName)}>
      {toRecipients.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="blue">To</Badge>
          {toRecipients.map((r) => (
            <span key={`to-${r.toUser}`} className={recipientBadgeClass}>
              {r.toUser}
            </span>
          ))}
        </div>
      ) : null}
      {infoRecipients.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="violet">Info</Badge>
          {infoRecipients.map((r) => (
            <span key={`info-${r.toUser}`} className={recipientBadgeClass}>
              {r.toUser}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
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

  for (const incident of groupContentIncidents(markings, notes, attachments)) {
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
  /** Deep-link from Inbox row: forward | reply */
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
  const [dialog, setDialog] = useState<'forward' | 'close' | 'revoke' | 'decline' | null>(null)
  const [composerMode, setComposerMode] = useState<'forward' | 'reply'>('forward')
  const [remarks, setRemarks] = useState('')
  const [recipients, setRecipients] = useState<MarkRecipientInput[]>([emptyRecipient()])
  const [activeRecipientIndex, setActiveRecipientIndex] = useState(0)
  const [drafts, setDrafts] = useState<MarkingDrafts | null>(null)
  /** Remount composer after a successful Mark so local draft state resets. */
  const [composerKey, setComposerKey] = useState(0)
  const composerRef = useRef<DraftCommentsComposerHandle>(null)
  const [composerMarkState, setComposerMarkState] = useState({ canMark: false, busy: false })
  const [draftPreview, setDraftPreview] = useState<DraftCommentPreviewData | null>(null)
  const draftPreviewOpenRef = useRef(false)

  const handleDraftPreviewChange = useCallback((next: DraftCommentPreviewData | null) => {
    const opening = next != null && !draftPreviewOpenRef.current
    draftPreviewOpenRef.current = next != null
    setDraftPreview(next)
    if (opening) {
      window.requestAnimationFrame(() => {
        document.getElementById('workflow-draft-preview')?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        })
      })
    }
  }, [])
  const [parentMarkingId, setParentMarkingId] = useState<number | null>(null)
  const [noteBody, setNoteBody] = useState('')
  const [forceClose, setForceClose] = useState(false)
  const [expandedTrackerBatchId, setExpandedTrackerBatchId] = useState<number | null>(null)
  const [trackerCache, setTrackerCache] = useState<Record<number, BatchTrackerSummary>>({})
  const [busy, setBusy] = useState(false)
  const [nodeDialog, setNodeDialog] = useState<MarkingFlowNodeData | null>(null)
  const [nodeEvents, setNodeEvents] = useState<AttachmentEvent[]>([])
  const [nodeEventsLoading, setNodeEventsLoading] = useState(false)
  const [previewVersionId, setPreviewVersionId] = useState<number | null>(null)
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null)
  const [editingNoteBody, setEditingNoteBody] = useState('')
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
      // Prefer the batch comments card; fall back to legacy per-marking / mark chips.
      if (batchId != null && scrollToTimelineAnchor(`workflow-incident-batch:${batchId}`)) return
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
    setForceClose(false)
    setRecipients([emptyRecipient()])
    setActiveRecipientIndex(0)
    setParentMarkingId(null)
  }

  const flatMarkings = useMemo(() => flattenMarkings(tree), [tree])

  const timelineItems = useMemo(
    () => buildCommentsTimeline(flatMarkings, notes, attachments),
    [attachments, flatMarkings, notes],
  )

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
      setDrafts({ ...draftBundle, roster: draftBundle.roster ?? [] })
      const holds = available.activeHolds ?? []
      if (holds.length === 1) {
        setParentMarkingId(holds[0]!.id)
      } else if (holds.length === 0) {
        setParentMarkingId(null)
      }
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
    const remountComposer = dialog === 'forward' || composerMode === 'reply'
    try {
      await fn()
      setDialog(null)
      resetComposer()
      await onDone()
      await load()
      // Remount after Mark/Reply so the composer re-hydrates from cleared server drafts.
      if (remountComposer) {
        draftPreviewOpenRef.current = false
        setDraftPreview(null)
        setComposerMode('forward')
        setComposerKey((k) => k + 1)
      }
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

  const replyParentHold = useMemo(() => {
    if (parentMarkingId != null) {
      return activeHolds.find((h) => h.id === parentMarkingId) ?? null
    }
    return activeHolds.length === 1 ? activeHolds[0]! : null
  }, [activeHolds, parentMarkingId])

  const replyTargetUser = useMemo(() => {
    if (!replyParentHold) return ''
    return resolveImmediateReplyTarget(replyParentHold, me.name || '')
  }, [replyParentHold, me.name])

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

  const isAdminActor = isAdministrator(me.role || '')
  /** Active leaf outbound markings from me — used to detect re-mark / admin edit. */
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

  useEffect(() => {
    if (loading || initialActionHandled.current) return
    const action = (initialAction || '').trim().toLowerCase()
    if (!action) return
    if (action === 'reply' && actions.includes('reply')) {
      initialActionHandled.current = true
      if (activeHolds.length === 1) setParentMarkingId(activeHolds[0]!.id)
      setComposerMode('reply')
      return
    }
    if ((action === 'forward' || action === 'assign') && actions.includes('forward')) {
      // Mark composer is always visible on the Workflow tab; no dialog to open.
      initialActionHandled.current = true
    }
  }, [loading, initialAction, actions, activeHolds])

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
        <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
            {actions.includes('accept') && (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    setBusy(true)
                    setError('')
                    try {
                      await acceptInboxLetter(letter.id)
                      await onDone()
                      await load({ silent: true })
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Accept failed')
                    } finally {
                      setBusy(false)
                    }
                  })()
                }}
              >
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Accept — I will work on it
              </Button>
            )}
            {actions.includes('decline') && (
              <Button
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={() => {
                  setRemarks('')
                  setError('')
                  setDialog('decline')
                }}
              >
                <XCircle className="mr-1 h-3.5 w-3.5" /> Reject
              </Button>
            )}
            {!actions.includes('accept') && actions.includes('reply') && (
              <Button
                size="sm"
                variant={composerMode === 'reply' ? 'default' : 'outline'}
                disabled={busy || activeHolds.length === 0}
                onClick={() => {
                  if (composerMode === 'reply') {
                    setComposerMode('forward')
                    setError('')
                    return
                  }
                  if (activeHolds.length === 1) setParentMarkingId(activeHolds[0]!.id)
                  setError('')
                  setComposerMode('reply')
                  window.requestAnimationFrame(() => {
                    document.getElementById('workflow-draft-composer')?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'nearest',
                    })
                  })
                }}
              >
                <Reply className="mr-1 h-3.5 w-3.5" />
                {composerMode === 'reply' ? 'Cancel Reply' : 'Reply'}
              </Button>
            )}
            {revokableMarkings.length > 0 && (
              <Button size="sm" variant="destructive" onClick={() => setDialog('revoke')}>
                <CornerUpLeft className="mr-1 h-3.5 w-3.5" /> Revoke
              </Button>
            )}
            {!actions.includes('accept') && actions.includes('forward') && (
              <Button
                size="sm"
                disabled={
                  composerMode === 'reply' ||
                  !composerMarkState.canMark ||
                  composerMarkState.busy ||
                  busy
                }
                onClick={() => composerRef.current?.requestMark()}
              >
                <Send className="mr-1 h-3.5 w-3.5" /> Mark
              </Button>
            )}
            {!actions.includes('accept') && actions.includes('close') && (
              <Button size="sm" variant="outline" onClick={() => setDialog('close')}>
                <XCircle className="mr-1 h-3.5 w-3.5" /> Close
              </Button>
            )}
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

      {!loading &&
        !actions.includes('accept') &&
        (actions.includes('forward') || actions.includes('reply')) && (
        <div id="workflow-draft-composer">
          {composerMode === 'reply' && activeHolds.length > 1 && (
            <div className="mb-3 rounded-lg border border-violet-200 bg-violet-50/70 px-3 py-2.5">
              <label className="block text-xs font-medium text-slate-600">
                Reply under which hold?
              </label>
              <AppSelect
                value={parentMarkingId != null ? String(parentMarkingId) : ''}
                onValueChange={(v) => setParentMarkingId(v ? Number(v) : null)}
                options={[
                  { value: '', label: 'Select hold…' },
                  ...activeHolds.map((h) => ({
                    value: String(h.id),
                    label:
                      h.status === 'responded'
                        ? `Response from ${h.toUser} · ${markingActionLabel(h.action)}`
                        : `From ${h.fromUser} · ${markingActionLabel(h.action)}`,
                  })),
                ]}
                className="mt-1 w-full max-w-md text-sm"
              />
            </div>
          )}
          <DraftCommentsComposer
            key={`composer-${letter.id}-${composerKey}-${composerMode}`}
            ref={composerRef}
            letterId={letter.id}
            users={users}
            meName={me.name}
            drafts={drafts}
            onDraftsChange={(next) => setDrafts({ ...next, roster: next.roster ?? [] })}
            disabled={busy}
            hideMarkButton
            mode={composerMode}
            lockedToUser={composerMode === 'reply' ? replyTargetUser : null}
            onCancelReply={() => {
              setComposerMode('forward')
              setError('')
            }}
            previewActive={draftPreview != null}
            onPreviewChange={handleDraftPreviewChange}
            onMarkAvailabilityChange={setComposerMarkState}
            onRequestMark={(nextRecipients) => {
              setError('')
              draftPreviewOpenRef.current = false
              setDraftPreview(null)
              setRecipients(nextRecipients.length ? nextRecipients : [emptyRecipient()])
              setActiveRecipientIndex(0)
              if (activeHolds.length === 1) setParentMarkingId(activeHolds[0]!.id)
              else if (activeHolds.length === 0) setParentMarkingId(null)
              setDialog('forward')
            }}
            onRequestSend={(nextRecipients) => {
              setError('')
              draftPreviewOpenRef.current = false
              setDraftPreview(null)
              void run(async () => {
                if (!replyParentHold) {
                  throw new Error('Select which hold you are replying under')
                }
                const toUser = resolveImmediateReplyTarget(replyParentHold, me.name || '')
                if (!toUser) throw new Error('Cannot determine reply recipient')
                const cleaned = nextRecipients.filter((r) => r.toUser.trim())
                const recipient =
                  cleaned.find((r) => r.toUser === toUser) ??
                  cleaned[0] ?? {
                    toUser,
                    action: 'forward' as const,
                    track: true,
                    remindersEnabled: false,
                  }
                const commonNotes = (drafts?.notes ?? [])
                  .filter((n) => !(n.targetUser || '').trim() && !isRichTextEmpty(n.bodyText))
                  .map((n) => ({ bodyText: n.bodyText }))
                const commonAttachments = (drafts?.attachments ?? [])
                  .filter((a) => !(a.targetUser || '').trim())
                  .map((a) => ({
                    attachmentKind: a.attachmentKind,
                    documentId: a.documentId,
                    storageKey: a.storageKey,
                    originalFilename: a.originalFilename,
                  }))
                const personalNotes = (drafts?.notes ?? [])
                  .filter(
                    (n) =>
                      (n.targetUser || '').trim() === toUser && !isRichTextEmpty(n.bodyText),
                  )
                  .map((n) => ({ bodyText: n.bodyText }))
                const personalAtts = (drafts?.attachments ?? [])
                  .filter((a) => (a.targetUser || '').trim() === toUser)
                  .map((a) => ({
                    attachmentKind: a.attachmentKind,
                    documentId: a.documentId,
                    storageKey: a.storageKey,
                    originalFilename: a.originalFilename,
                  }))
                await markLetter(letter.id, {
                  recipients: [
                    {
                      ...recipient,
                      toUser,
                      track: true,
                      remindersEnabled: recipient.action === 'response_required',
                      notes: personalNotes.length ? personalNotes : undefined,
                      attachments: personalAtts.length ? personalAtts : undefined,
                    },
                  ],
                  remarks: '',
                  pathwayNotify: false,
                  parentMarkingId: replyParentHold.id,
                  direction: 'reply',
                  // Stage from current drafts; avoid clashing with Mark (forward) draft intent.
                  consumeDrafts: false,
                  commonNotes: commonNotes.length ? commonNotes : undefined,
                  commonAttachments: commonAttachments.length ? commonAttachments : undefined,
                })
                // Clear leftover Mark/Reply drafts so the card resets.
                for (const n of drafts?.notes ?? []) {
                  try {
                    await deleteDraftNote(n.id)
                  } catch {
                    /* ignore */
                  }
                }
                for (const a of drafts?.attachments ?? []) {
                  try {
                    await deleteDraftAttachment(a.id)
                  } catch {
                    /* ignore */
                  }
                }
                try {
                  await putDraftRoster(letter.id, [])
                } catch {
                  /* ignore */
                }
                setComposerMode('forward')
              })
            }}
          />
        </div>
      )}

      <div>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Comments & Attachments</h3>
        {timelineItems.filter(
          (item) => item.kind === 'content' || visibility.showMarkingCards,
        ).length === 0 &&
          !draftPreview && (
          <p className="text-xs text-slate-500">No notes, attachments, or markings yet.</p>
        )}
        <ul className="space-y-3">
          {draftPreview ? <DraftCommentsPreviewCard preview={draftPreview} /> : null}
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
                  'workflow-comment-card scroll-mt-24 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition ring-offset-2',
                  isOwnComments
                    ? 'workflow-comment-card--own border-emerald-200 bg-emerald-50 dark:bg-emerald-950/40'
                    : 'dark:bg-white',
                  highlightedTimelineId === `workflow-incident-${incident.key}` &&
                    'ring-2 ring-[#1769aa]/50',
                )}
              >
                <div className="grid grid-cols-1 md:grid-cols-3">
                  <div
                    className={cn(
                      'workflow-comment-card-main divide-y px-4 py-1 md:col-span-2 md:border-r',
                      isOwnComments
                        ? 'divide-emerald-200/70 md:border-emerald-200/70 dark:divide-emerald-900/40 dark:md:border-transparent'
                        : 'divide-slate-100 md:border-slate-100 dark:divide-slate-700/50 dark:md:border-transparent',
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
                        const showRecipientRoster = hasCommonContent(incident)
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
                            <ContentRecipientRoster
                              recipients={incident.recipients}
                              show={showRecipientRoster}
                            />
                          </div>,
                          <div key={groupKey} className="py-1">
                            {partitionByForUser(group).flatMap((section) => {
                              const sectionNodes: ReactNode[] = []
                              const sectionIsPrivate = section.items.some(
                                (n) => n.audience === 'recipient',
                              )
                              if (section.label) {
                                sectionNodes.push(
                                  <div
                                    key={`${groupKey}-for-${section.label}`}
                                    className="flex flex-wrap items-center gap-2 pt-2.5"
                                  >
                                    <p
                                      className={cn(
                                        'text-sm font-bold underline underline-offset-2',
                                        isOwnComments
                                          ? 'text-emerald-950 dark:text-emerald-100'
                                          : 'text-slate-800',
                                      )}
                                    >
                                      For {section.label}
                                    </p>
                                    {sectionIsPrivate ? (
                                      <span className="rounded bg-amber-100 px-1.5 py-px text-[10px] font-semibold text-amber-900">
                                        Private
                                      </span>
                                    ) : null}
                                  </div>,
                                )
                              }
                              for (let noteIdx = 0; noteIdx < section.items.length; noteIdx++) {
                                const note = section.items[noteIdx]!
                                const showTopBorder = noteIdx > 0
                                sectionNodes.push(
                              <div
                                key={note.id}
                                className={cn(
                                  'py-2.5',
                                  showTopBorder && 'border-t',
                                  showTopBorder &&
                                    (isOwnComments
                                      ? 'border-emerald-100 dark:border-emerald-900/40'
                                      : 'border-slate-50'),
                                )}
                              >
                                {(note.isResponse || note.editable) && (
                                  <div
                                    className={cn(
                                      'mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]',
                                      isOwnComments
                                        ? 'text-emerald-800/80 dark:text-emerald-300/80'
                                        : 'text-slate-500',
                                    )}
                                  >
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
                                )}
                                {editingNoteId === note.id ? (
                                  <div className="space-y-2">
                                    <RichTextEditor
                                      value={editingNoteBody}
                                      onChange={setEditingNoteBody}
                                      disabled={busy}
                                      placeholder="Edit message…"
                                      aria-label="Edit comment"
                                      minHeightClass="min-h-[5.5rem]"
                                    />
                                    <div className="flex gap-2">
                                      <Button
                                        size="sm"
                                        disabled={busy || isRichTextEmpty(editingNoteBody)}
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
                                  <RichTextHtml
                                    html={note.bodyText}
                                    className={
                                      isOwnComments
                                        ? 'text-emerald-950 dark:text-emerald-200'
                                        : undefined
                                    }
                                  />
                                )}
                              </div>,
                                )
                              }
                              return sectionNodes
                            })}
                          </div>,
                        ]
                      })
                    )}
                  </div>
                  <div
                    className={cn(
                      'workflow-comment-card-aside border-t px-3 py-3 md:col-span-1 md:border-t-0',
                      isOwnComments
                        ? 'border-emerald-200/70 bg-emerald-100/50 dark:border-transparent dark:bg-emerald-950/60'
                        : 'border-slate-100 bg-slate-50/80 dark:border-transparent dark:bg-slate-50/80',
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
                        {partitionByForUser(incident.attachments).flatMap((section) => {
                          const rows: ReactNode[] = []
                          const sectionIsPrivate = section.items.some(
                            (a) => a.audience === 'recipient',
                          )
                          if (section.label) {
                            rows.push(
                              <li
                                key={`att-for-${section.label}`}
                                className="flex flex-wrap items-center gap-1.5 pt-1 text-slate-700"
                              >
                                <span className="text-xs font-bold underline underline-offset-2">
                                  For {section.label}
                                </span>
                                {sectionIsPrivate ? (
                                  <span className="rounded bg-amber-100 px-1.5 py-px text-[10px] font-semibold text-amber-900">
                                    Private
                                  </span>
                                ) : null}
                              </li>,
                            )
                          }
                          for (const a of section.items) {
                            rows.push(
                          <li
                            key={a.id}
                            className="relative rounded-lg border border-slate-200 bg-white px-2.5 py-2 pr-9 shadow-sm dark:border-[0.5px] dark:border-slate-400 dark:shadow-none"
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
                          </li>,
                            )
                          }
                          return rows
                        })}
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

      {dialog === 'forward' && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-4 shadow-xl">
            <h2 className="text-sm font-bold text-slate-800">Confirm Mark</h2>
            <p className="mt-1 text-xs text-slate-500">
              Send this marking to the recipients below and publish any draft comments or
              attachments.
            </p>
            {recipients.some((r) => myOutboundLeafByUser.has(r.toUser.trim())) && (
              <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
                {isAdminActor
                  ? 'A recipient already has an active marking from you. Saving updates action / response type (admin). Others must revoke first.'
                  : 'A recipient already has an active marking from you. Revoke it before marking again or changing action / response type.'}
              </p>
            )}

            {activeHolds.length > 1 && (
              <div className="mt-3">
                <label className="block text-xs font-medium text-slate-600">
                  Marking under which hold?
                </label>
                <AppSelect
                  value={parentMarkingId != null ? String(parentMarkingId) : ''}
                  onValueChange={(v) => setParentMarkingId(v ? Number(v) : null)}
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

            <ul className="mt-3 space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              {recipients
                .filter((r) => r.toUser.trim())
                .map((r) => (
                  <li key={r.toUser} className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-800">{r.toUser}</span>
                    <Badge
                      tone={
                        r.action === 'response_required'
                          ? 'amber'
                          : r.action === 'for_info'
                            ? 'slate'
                            : 'green'
                      }
                    >
                      {ACTION_LABELS[r.action] ?? markingActionLabel(r.action)}
                    </Badge>
                    {r.action === 'response_required' && r.responseType ? (
                      <span className="text-slate-500">
                        {RESPONSE_TYPE_LABELS[r.responseType as ResponseType] ?? r.responseType}
                        {r.dueAt ? ` · due ${r.dueAt}` : ''}
                      </span>
                    ) : null}
                  </li>
                ))}
            </ul>

            {drafts && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600">
                <p className="font-semibold text-slate-700">Content to publish</p>
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
                      if (!n && !a) return null
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
                    const cleaned = recipients.filter((r) => r.toUser.trim())
                    if (!cleaned.length) {
                      throw new Error('Add at least one To or Info recipient before Mark.')
                    }
                    if (!isAdminActor) {
                      const blocked = cleaned.find((r) =>
                        myOutboundLeafByUser.has(r.toUser.trim()),
                      )
                      if (blocked) {
                        throw new Error(
                          `Active marking already exists from you to '${blocked.toUser}'. ` +
                            'Revoke it before marking again or changing action / response type.',
                        )
                      }
                    }
                    if (activeHolds.length > 1 && parentMarkingId == null) {
                      throw new Error('Select which hold you are marking under')
                    }
                    const resolvedParent =
                      activeHolds.length === 1
                        ? activeHolds[0]!.id
                        : activeHolds.length > 1
                          ? parentMarkingId
                          : undefined

                    await markLetter(letter.id, {
                      recipients: cleaned.map((r) => ({
                        ...r,
                        instructions: '',
                        track: true,
                        responseType:
                          r.action === 'response_required'
                            ? r.responseType || 'draft_letter'
                            : undefined,
                        remindersEnabled: r.action === 'response_required',
                      })),
                      remarks: '',
                      pathwayNotify: false,
                      parentMarkingId: resolvedParent ?? undefined,
                      direction: 'forward',
                      consumeDrafts: true,
                    })
                  })
                }
              >
                Confirm Mark
              </Button>
            </div>
          </div>
        </div>
      )}

      {dialog === 'decline' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-4 shadow-xl">
            <h2 className="text-sm font-bold">Reject letter</h2>
            <p className="mt-1 text-xs text-slate-500">
              Provide a reason for rejecting this letter. The sender will be notified.
            </p>
            <label className="mt-3 flex flex-col gap-1">
              <span className="text-xs font-semibold text-slate-600">Rejection reason</span>
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                className="min-h-24 rounded-md border border-slate-200 px-3 py-2 text-xs"
                placeholder="Required — why you cannot take this letter…"
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDialog(null)} disabled={busy}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={busy || !remarks.trim()}
                onClick={() =>
                  void (async () => {
                    setBusy(true)
                    setError('')
                    try {
                      await rejectInboxLetter(letter.id, remarks.trim())
                      setDialog(null)
                      setRemarks('')
                      await onDone()
                      await load({ silent: true })
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Reject failed')
                    } finally {
                      setBusy(false)
                    }
                  })()
                }
              >
                Reject
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
                            <RichTextHtml html={n.bodyText} />
                            {n.isResponse ? (
                              <p className="mt-1 text-[10px] text-slate-400">Response</p>
                            ) : null}
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
