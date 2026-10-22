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
import { useAppData } from '@/components/app-provider'
import { Badge } from '@/components/cms/ui'
import { formatDateTime } from '@/lib/datetime'
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
  addAttachmentsToMarking,
  addMarkingNote,
  closeMarkedLetter,
  deleteMarkingAttachment,
  deleteMarkingNote,
  fetchBatchTracker,
  fetchMarkingActions,
  fetchMarkingAttachments,
  fetchMarkingNotes,
  fetchMarkingTree,
  flattenMarkings,
  markAttachmentReplaced,
  markLetter,
  markingActionLabel,
  respondToMarking,
  revokeMarking,
  updateMarkingAttachment,
  updateMarkingNote,
  type CorrespondenceAttachment,
  type CorrespondenceNote,
  type MarkRecipientInput,
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

function emptyRecipient(): MarkRecipientInput {
  return { toUser: '', action: 'forward', track: true, remindersEnabled: true }
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

  const byBatch = new Map<number, MarkingNode[]>()
  const batchOrder: number[] = []
  for (const marking of markings) {
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

  return items.sort((a, b) => b.sortAt - a.sortAt)
}

export function MarkingWorkflowPanel({
  letter,
  users,
  onDone,
}: {
  letter: Letter
  users: WorkflowUser[]
  onDone: () => Promise<void>
}) {
  const { me } = useAppData()
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
  const [dialog, setDialog] = useState<'mark' | 'note' | 'respond' | 'attach' | 'close' | null>(null)
  const [remarks, setRemarks] = useState('')
  const [pathwayNotify, setPathwayNotify] = useState(false)
  const [recipients, setRecipients] = useState<MarkRecipientInput[]>([emptyRecipient()])
  /** Which recipient row the single User/Action card is editing. */
  const [activeRecipientIndex, setActiveRecipientIndex] = useState(0)
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
  const [previewVersionId, setPreviewVersionId] = useState<number | null>(null)
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null)
  const [editingNoteBody, setEditingNoteBody] = useState('')
  const loadInFlightRef = useRef(false)
  const busyRef = useRef(false)

  const resetComposer = () => {
    setRemarks('')
    setNoteBody('')
    setPendingFiles([])
    setForceClose(false)
    setRecipients([emptyRecipient()])
    setActiveRecipientIndex(0)
    setPathwayNotify(false)
    setParentMarkingId(null)
    setContextMarkingId(null)
  }

  const activeRecipient = recipients[activeRecipientIndex] ?? recipients[0] ?? emptyRecipient()

  const updateActiveRecipient = (patch: Partial<MarkRecipientInput>) => {
    setRecipients((prev) => {
      const idx = Math.min(activeRecipientIndex, Math.max(0, prev.length - 1))
      return prev.map((row, i) => (i === idx ? { ...row, ...patch } : row))
    })
  }

  const addRecipientSlot = () => {
    const current = recipients[activeRecipientIndex]
    if (current && !current.toUser.trim()) return
    setRecipients((prev) => [...prev, emptyRecipient()])
    setActiveRecipientIndex(recipients.length)
  }

  const removeRecipientAt = (idx: number) => {
    if (recipients.length <= 1) {
      setRecipients([emptyRecipient()])
      setActiveRecipientIndex(0)
      return
    }
    const next = recipients.filter((_, i) => i !== idx)
    setRecipients(next)
    setActiveRecipientIndex((cur) => {
      if (cur === idx) return Math.min(idx, next.length - 1)
      if (cur > idx) return cur - 1
      return Math.min(cur, next.length - 1)
    })
  }

  const canAddAttachment = actions.includes('add_note')

  const flatMarkings = useMemo(() => flattenMarkings(tree), [tree])

  const timelineItems = useMemo(
    () => buildCommentsTimeline(flatMarkings, notes, attachments),
    [attachments, flatMarkings, notes],
  )

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
      const doc = await uploadLetterDocument(letter.id, item.file, item.kind, `Workflow attachment (${item.kind})`)
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
      const [available, markingTree, noteRows, attachmentRows] = await Promise.all([
        fetchMarkingActions(letter.id),
        fetchMarkingTree(letter.id),
        fetchMarkingNotes(letter.id),
        fetchMarkingAttachments(letter.id),
      ])
      setActions(available.actions ?? [])
      setActiveHolds(available.activeHolds ?? [])
      setActiveLeaves(available.activeLeaves ?? [])
      setInitiatorHold(Boolean(available.initiatorHold))
      setTree(markingTree)
      setNotes(noteRows)
      setAttachments(attachmentRows)
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
      const hasAttachment = attachments.some(
        (a) => a.markingId === m.id && (a.createdBy || '').trim() === recipient,
      )
      return !hasNote && !hasAttachment
    })
  }, [actions, allMarkings, attachments, me.name, notes])

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
          <MarkingHistoryFlow tree={tree} initiatorName={letter.createdBy || ''} />
        </div>
      )}

      {!loading && (
        <div className="mb-4 flex flex-wrap gap-2">
          {actions.includes('mark') && (
            <Button
              size="sm"
              onClick={() => {
                setRecipients([emptyRecipient()])
                setActiveRecipientIndex(0)
                if (activeHolds.length === 1) setParentMarkingId(activeHolds[0]!.id)
                else if (activeHolds.length === 0) setParentMarkingId(null)
                setDialog('mark')
              }}
            >
              <Send className="mr-1 h-3.5 w-3.5" /> Mark
            </Button>
          )}
          {actions.includes('add_note') && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (activeHolds.length === 1) setContextMarkingId(activeHolds[0]!.id)
                setDialog('note')
              }}
            >
              <MessageSquare className="mr-1 h-3.5 w-3.5" /> Add Comment
            </Button>
          )}
          {revokableMarkings.map((m) => (
            <Button
              key={m.id}
              type="button"
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await revokeMarking(m.id)
                })
              }
            >
              <CornerUpLeft className="mr-1 h-3.5 w-3.5" />
              Revoke mark to {m.toUser}
            </Button>
          ))}
          {canAddAttachment && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setPendingFiles([])
                if (activeHolds.length === 1) setContextMarkingId(activeHolds[0]!.id)
                setDialog('attach')
              }}
            >
              <Paperclip className="mr-1 h-3.5 w-3.5" /> Add Attachment
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
          {actions.includes('close') && (
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

      <div>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Comments & Attachments</h3>
        {timelineItems.filter(
          (item) => item.kind === 'content' || visibility.showMarkingCards,
        ).length === 0 && (
          <p className="text-xs text-slate-500">No notes, attachments, or markings yet.</p>
        )}
        <ul className="space-y-3">
          {timelineItems.map((item) => {
            if (item.kind === 'mark' || item.kind === 'markBatch') {
              if (!visibility.showMarkingCards) return null
              if (item.kind === 'mark') {
                const { marking } = item
                const revoked = marking.status === 'revoked'
                return (
                  <li key={`mark-${marking.id}`} className="flex justify-center py-0.5">
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
                          {marking.fromUser} → {marking.toUser}
                        </span>
                        {revoked ? (
                          <Badge tone="slate">Revoked</Badge>
                        ) : (
                          <Badge tone={marking.action === 'forward' ? 'amber' : 'slate'}>
                            {markingActionLabel(marking.action)}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </li>
                )
              }
              const { batchId, markings: batchMarks } = item
              return (
                <li key={`batch-${batchId}`} className="flex justify-center py-0.5">
                  <div className="inline-flex max-w-full flex-col items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-sm">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      Marked to {batchMarks.length} users · Batch #{batchId}
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
                key={`incident-${incident.key}`}
                className={cn(
                  'overflow-hidden rounded-xl border shadow-sm',
                  isOwnComments
                    ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800/60 dark:bg-emerald-950/40'
                    : 'border-slate-200 bg-white',
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
                        const markedOnwardAt = onwardMarkedAt(incident.key, author, allMarkings)
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
                            {markedOnwardAt ? (
                              <p
                                className={cn(
                                  'mt-0.5 text-[11px]',
                                  isOwnAuthor
                                    ? 'text-emerald-800/75 dark:text-emerald-300/75'
                                    : 'text-slate-500',
                                )}
                              >
                                Marked onward {formatDateTime(markedOnwardAt)}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
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

      {dialog === 'mark' && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-4 shadow-xl">
            <h2 className="text-sm font-bold text-slate-800">Mark correspondence</h2>
            <p className="mt-1 text-xs text-slate-500">
              Assign each recipient an action. Added recipients appear as badges above — edit one at a time.
            </p>

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
                      label: `From ${h.fromUser} · ${markingActionLabel(h.action)}`,
                    })),
                  ]}
                  className="mt-1 w-full text-sm"
                />
              </div>
            )}

            {recipients.some((r) => r.toUser.trim()) && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {recipients.map((row, idx) => {
                  if (!row.toUser.trim()) return null
                  const isActive = idx === activeRecipientIndex
                  return (
                    <span
                      key={`recipient-badge-${idx}-${row.toUser}`}
                      className={cn(
                        'inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold',
                        isActive
                          ? 'border-[#1769aa]/40 bg-sky-50 text-slate-800'
                          : 'border-slate-200 bg-slate-100 text-slate-700',
                      )}
                    >
                      <span className="truncate">{row.toUser}</span>
                      <span
                        className={cn(
                          'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold',
                          row.action === 'response_required'
                            ? 'bg-amber-100 text-amber-800'
                            : row.action === 'for_info'
                              ? 'bg-slate-200 text-slate-600'
                              : 'bg-emerald-100 text-emerald-800',
                        )}
                      >
                        {ACTION_LABELS[row.action] ?? markingActionLabel(row.action)}
                      </span>
                      <button
                        type="button"
                        className="inline-flex shrink-0 rounded p-0.5 text-slate-500 hover:bg-white/80 hover:text-[#1769aa]"
                        aria-label={`Edit ${row.toUser}`}
                        onClick={() => setActiveRecipientIndex(idx)}
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        className="inline-flex shrink-0 rounded p-0.5 text-slate-400 hover:bg-white/80 hover:text-rose-600"
                        aria-label={`Remove ${row.toUser}`}
                        onClick={() => removeRecipientAt(idx)}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  )
                })}
              </div>
            )}

            <div className="mt-3 rounded-lg border border-slate-200 p-3">
              <label className="block text-xs font-medium text-slate-600">User</label>
              <AppSelect
                value={activeRecipient.toUser}
                onValueChange={(v) => updateActiveRecipient({ toUser: v })}
                options={[
                  { value: '', label: 'Select user…' },
                  ...users.map((u) => ({ value: u.name, label: u.name })),
                ]}
                className="mt-1 w-full text-sm"
              />
              <label className="mt-2 block text-xs font-medium text-slate-600">Action</label>
              <AppSelect
                value={activeRecipient.action}
                onValueChange={(v) => updateActiveRecipient({ action: v as MarkingAction })}
                options={MARKING_ACTIONS.map((a) => ({ value: a, label: ACTION_LABELS[a] }))}
                className="mt-1 w-full text-sm"
              />
              {activeRecipient.action === 'response_required' && (
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
              <label className="mt-2 block text-xs font-medium text-slate-600">Instructions</label>
              <textarea
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
                rows={2}
                value={activeRecipient.instructions || ''}
                onChange={(e) => updateActiveRecipient({ instructions: e.target.value })}
                placeholder="Optional guidance for this recipient"
              />
              <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={activeRecipient.track !== false}
                  onChange={(e) => updateActiveRecipient({ track: e.target.checked })}
                />
                Track this marking
              </label>
            </div>

            <Button type="button" size="xs" variant="outline" className="mt-2" onClick={addRecipientSlot}>
              + Add recipient
            </Button>
            <label className="mt-3 block text-xs font-medium text-slate-600">Remarks</label>
            <textarea
              className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
              rows={2}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
            <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={pathwayNotify} onChange={(e) => setPathwayNotify(e.target.checked)} />
              Notify me of the pathway (further marks / responses)
            </label>
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
                    if (!cleaned.length) throw new Error('Select at least one recipient')
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
                        responseType: r.action === 'response_required' ? r.responseType || 'draft_letter' : undefined,
                        remindersEnabled: r.action === 'response_required' ? r.track !== false : false,
                      })),
                      remarks,
                      pathwayNotify,
                      parentMarkingId: resolvedParent ?? undefined,
                    })
                  })
                }
              >
                Mark
              </Button>
            </div>
          </div>
        </div>
      )}

      {(dialog === 'note' || dialog === 'respond') && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl">
            <h2 className="text-sm font-bold">{dialog === 'note' ? 'Add Comment' : 'Submit response'}</h2>
            {dialog === 'note' && activeHolds.length > 1 && (
              <div className="mt-2">
                <label className="block text-xs font-medium text-slate-600">On which hold?</label>
                <AppSelect
                  value={contextMarkingId != null ? String(contextMarkingId) : ''}
                  onValueChange={(v) => setContextMarkingId(v ? Number(v) : null)}
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
              Use <span className="font-medium">Add Attachment</span> to attach files separately.
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
                      if (activeHolds.length > 1 && contextMarkingId == null) {
                        throw new Error('Select which hold this note belongs to')
                      }
                      const markingId =
                        activeHolds.length === 1
                          ? activeHolds[0]!.id
                          : activeHolds.length > 1
                            ? contextMarkingId ?? undefined
                            : undefined
                      await addMarkingNote(letter.id, {
                        bodyText: noteBody,
                        markingId,
                      })
                    })
                  }
                >
                  Save note
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
            <h2 className="text-sm font-bold">Add Attachment</h2>
            <p className="mt-1 text-xs text-slate-500">
              Files are linked to your current marking hold, not to individual notes.
            </p>
            {activeHolds.length > 1 && (
              <div className="mt-2">
                <label className="block text-xs font-medium text-slate-600">On which hold?</label>
                <AppSelect
                  value={contextMarkingId != null ? String(contextMarkingId) : ''}
                  onValueChange={(v) => setContextMarkingId(v ? Number(v) : null)}
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
                    if (activeHolds.length > 1 && contextMarkingId == null) {
                      throw new Error('Select which hold these attachments belong to')
                    }
                    const markingId =
                      activeHolds.length === 1
                        ? activeHolds[0]!.id
                        : activeHolds.length > 1
                          ? contextMarkingId
                          : undefined
                    const uploaded = await uploadPendingAttachments()
                    await addAttachmentsToMarking(letter.id, uploaded, markingId)
                  })
                }
              >
                Upload
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
