import { api } from '@/lib/api'
import type { Letter } from '@/services/letters'
import {
  ACTION_LABELS,
  type AttachmentKind,
  type MarkingAction,
  type ResponseType,
} from '@/services/marking-types'

export type { MarkingAction, ResponseType, AttachmentKind }
export { ACTION_LABELS }

export type MarkingDirection = 'forward' | 'reply'

export type MarkingNode = {
  id: number
  batchId: number
  letterId: string
  parentMarkingId: number | null
  /** Stable workflow branch id — unique per fan-out recipient; inherited on single continue/reply. */
  pathId: string
  direction: MarkingDirection | string
  fromUser: string
  toUser: string
  action: string
  responseType: string
  responseTypeOther: string
  instructions: string
  dueAt: string
  priority: string
  track: boolean
  remindersEnabled: boolean
  status: string
  clientIp: string
  createdAt: string
  revokedAt: string
  revokedBy: string
  respondedAt: string
  responseNoteId: number | null
  children: MarkingNode[]
}

export type MarkingActions = {
  letterId: string
  currentStatus: string
  actions: string[]
  activeHolds: MarkingNode[]
  activeLeaves: MarkingNode[]
  initiatorHold: boolean
}

export function flattenMarkings(nodes: MarkingNode[]): MarkingNode[] {
  const out: MarkingNode[] = []
  const walk = (node: MarkingNode) => {
    out.push(node)
    ;(node.children ?? []).forEach(walk)
  }
  nodes.forEach(walk)
  return out.sort((a, b) => a.id - b.id)
}

/** Group flat markings by batchId (insertion order of first seen batch). */
export function groupMarkingsByBatch(flat: MarkingNode[]): { batchId: number; markings: MarkingNode[] }[] {
  const order: number[] = []
  const map = new Map<number, MarkingNode[]>()
  for (const m of flat) {
    if (!map.has(m.batchId)) {
      order.push(m.batchId)
      map.set(m.batchId, [])
    }
    map.get(m.batchId)!.push(m)
  }
  return order.map((batchId) => ({ batchId, markings: map.get(batchId)! }))
}

export type StagedNoteInput = {
  bodyText: string
}

export type StagedAttachmentInput = {
  attachmentKind: string
  documentId?: number | null
  storageKey?: string
  originalFilename?: string
}

export type MarkRecipientInput = {
  toUser: string
  action: MarkingAction
  responseType?: ResponseType
  responseTypeOther?: string
  instructions?: string
  dueAt?: string
  priority?: string
  track?: boolean
  remindersEnabled?: boolean
  /** Draft comments published onto this recipient's marking when Forward/Reply is submitted. */
  notes?: StagedNoteInput[]
  attachments?: StagedAttachmentInput[]
}

export type MarkBatchInput = {
  recipients: MarkRecipientInput[]
  remarks?: string
  pathwayNotify?: boolean
  parentMarkingId?: number | null
  direction?: MarkingDirection
  /** Shared drafts copied onto every recipient marking in the batch. */
  commonNotes?: StagedNoteInput[]
  commonAttachments?: StagedAttachmentInput[]
  /** Publish Add Comment / Add Attachment drafts for each recipient (default true). */
  consumeDrafts?: boolean
}

/** Short display form of a path UUID (first 8 hex chars). */
export function shortPathId(pathId: string | null | undefined) {
  const raw = (pathId || '').replace(/-/g, '')
  return raw ? raw.slice(0, 8).toUpperCase() : ''
}

/** all = shared on pathway remakes; recipient = hop-private. */
export type NoteAudience = 'all' | 'recipient'

export type CorrespondenceAttachment = {
  id: number
  letterId: string
  markingId: number | null
  createdBy: string
  documentId: number | null
  versionId: number | null
  previewable: boolean
  mimeType: string
  attachmentKind: string
  audience: NoteAudience
  storageKey: string
  originalFilename: string
  clientIp: string
  createdAt: string
  editable: boolean
  deleted?: boolean
  deletedAt?: string
  deletedBy?: string
}

export type CorrespondenceNote = {
  id: number
  letterId: string
  markingId: number | null
  authorUser: string
  bodyText: string
  /** all = shared on pathway remakes; recipient = hop-private. */
  audience: NoteAudience
  isResponse: boolean
  clientIp: string
  createdAt: string
  editable: boolean
}

export function markingActionLabel(action: string) {
  return ACTION_LABELS[action as MarkingAction] ?? action.replace(/_/g, ' ')
}

export async function fetchMarkingActions(letterId: string) {
  return api.get<MarkingActions>(`/api/markings/letters/${letterId}/actions`)
}

export async function fetchMarkingTree(letterId: string) {
  return api.get<MarkingNode[]>(`/api/markings/letters/${letterId}/tree`)
}

export async function fetchMarkingNotes(letterId: string) {
  return api.get<CorrespondenceNote[]>(`/api/markings/letters/${letterId}/notes`)
}

export async function fetchMarkingAttachments(letterId: string) {
  return api.get<CorrespondenceAttachment[]>(`/api/markings/letters/${letterId}/attachments`)
}

export async function markLetter(letterId: string, input: MarkBatchInput) {
  return api.post<{ batch: { id: number }; markings: MarkingNode[]; letter: Letter }>(
    `/api/markings/letters/${letterId}/mark`,
    {
      ...input,
      direction: input.direction ?? 'forward',
      consumeDrafts: input.consumeDrafts !== false,
    },
  )
}

export type DraftIntent = 'forward' | 'reply'

export type DraftNote = {
  id: number
  letterId: string
  authorUser: string
  targetUser: string
  intent: DraftIntent | string
  bodyText: string
  clientIp: string
  createdAt: string
}

export type DraftAttachment = {
  id: number
  letterId: string
  createdBy: string
  targetUser: string
  intent: DraftIntent | string
  documentId: number | null
  attachmentKind: string
  storageKey: string
  originalFilename: string
  clientIp: string
  createdAt: string
}

export type MarkingDrafts = {
  notes: DraftNote[]
  attachments: DraftAttachment[]
  targetUsers: string[]
  forwardTargetUsers: string[]
  replyTargetUsers: string[]
  hasForwardDrafts: boolean
  hasReplyDrafts: boolean
  commonNoteCount: number
  commonAttachmentCount: number
}

export async function fetchMarkingDrafts(letterId: string) {
  return api.get<MarkingDrafts>(`/api/markings/letters/${letterId}/drafts`)
}

export async function addDraftNote(
  letterId: string,
  input: { bodyText: string; targetUser?: string; intent?: DraftIntent },
) {
  return api.post<{ note: DraftNote; drafts: MarkingDrafts }>(
    `/api/markings/letters/${letterId}/drafts/notes`,
    {
      bodyText: input.bodyText,
      targetUser: input.targetUser ?? '',
      intent: input.intent ?? 'forward',
    },
  )
}

export async function addDraftAttachments(
  letterId: string,
  attachments: StagedAttachmentInput[],
  targetUser = '',
  intent: DraftIntent = 'forward',
) {
  return api.post<{ attachments: DraftAttachment[]; drafts: MarkingDrafts }>(
    `/api/markings/letters/${letterId}/drafts/attachments`,
    { targetUser, intent, attachments },
  )
}

export async function updateDraftNote(noteId: number, bodyText: string) {
  return api.patch<{ note: DraftNote; drafts: MarkingDrafts }>(
    `/api/markings/drafts/notes/${noteId}`,
    { bodyText },
  )
}

export async function deleteDraftNote(noteId: number) {
  return api.delete<{ ok: boolean; drafts: MarkingDrafts }>(`/api/markings/drafts/notes/${noteId}`)
}

export async function deleteDraftAttachment(attachmentId: number) {
  return api.delete<{ ok: boolean; drafts: MarkingDrafts }>(
    `/api/markings/drafts/attachments/${attachmentId}`,
  )
}

export async function fetchMarkingPath(pathId: string) {
  return api.get<{ pathId: string; letterId: string; markings: MarkingNode[] }>(
    `/api/markings/paths/${encodeURIComponent(pathId)}`,
  )
}

export async function revokeMarking(markingId: number, remarks = '') {
  return api.post<{ marking: MarkingNode; letter: Letter }>(`/api/markings/${markingId}/revoke`, {
    remarks,
  })
}

export async function addMarkingNote(
  letterId: string,
  input: {
    bodyText: string
    markingId?: number
    isResponse?: boolean
  },
) {
  return api.post<{ note: CorrespondenceNote; letter: Letter }>(
    `/api/markings/letters/${letterId}/notes`,
    input,
  )
}

export async function respondToMarking(markingId: number, input: { bodyText: string }) {
  return api.post<{ note: CorrespondenceNote; marking: MarkingNode; letter: Letter }>(
    `/api/markings/${markingId}/respond`,
    input,
  )
}

export async function closeMarkedLetter(letterId: string, input: { remarks?: string; force?: boolean }) {
  return api.post<{ letter: Letter }>(`/api/markings/letters/${letterId}/close`, input)
}

export async function fetchTrackedMarkings() {
  return api.get<MarkingNode[]>('/api/markings/tracked')
}

export type AttachmentEvent = {
  id: number
  letterId: string
  markingId: number | null
  attachmentId: number | null
  eventType: 'added' | 'replaced' | 'removed' | string
  actorUser: string
  documentId: number | null
  versionId: number | null
  originalFilename: string
  storageKey: string
  attachmentKind: string
  clientIp: string
  createdAt: string
}

export async function fetchAttachmentEvents(
  letterId: string,
  opts?: { markingId?: number; mineOnly?: boolean },
) {
  const params = new URLSearchParams()
  if (opts?.markingId != null) params.set('marking_id', String(opts.markingId))
  if (opts?.mineOnly) params.set('mine_only', 'true')
  const q = params.toString()
  return api.get<AttachmentEvent[]>(
    `/api/markings/letters/${letterId}/attachment-events${q ? `?${q}` : ''}`,
  )
}

export async function fetchBatchTracker(batchId: number) {
  return api.get<{
    pendingCount: number
    respondedCount: number
    allResponsesReceived: boolean
    markings: MarkingNode[]
  }>(`/api/markings/batches/${batchId}/tracker`)
}

export async function updateMarkingNote(noteId: number, bodyText: string) {
  return api.patch<{ note: CorrespondenceNote; letter: Letter }>(`/api/markings/notes/${noteId}`, {
    bodyText,
  })
}

export async function deleteMarkingNote(noteId: number) {
  return api.delete<{ ok: boolean; letter: Letter }>(`/api/markings/notes/${noteId}`)
}

export async function addAttachmentsToMarking(
  letterId: string,
  attachments: { attachmentKind: string; documentId?: number; originalFilename?: string }[],
  markingId?: number | null,
) {
  return api.post<{ attachments: CorrespondenceAttachment[]; letter: Letter }>(
    `/api/markings/letters/${letterId}/attachments`,
    { attachments, markingId: markingId ?? undefined },
  )
}

export async function updateMarkingAttachment(
  attachmentId: number,
  input: { attachmentKind?: string; originalFilename?: string },
) {
  return api.patch<{ attachment: CorrespondenceAttachment; letter: Letter }>(
    `/api/markings/attachments/${attachmentId}`,
    input,
  )
}

export async function markAttachmentReplaced(attachmentId: number, originalFilename: string) {
  return api.post<{ attachment: CorrespondenceAttachment; letter: Letter }>(
    `/api/markings/attachments/${attachmentId}/replaced`,
    { originalFilename },
  )
}

export async function deleteMarkingAttachment(attachmentId: number) {
  return api.delete<{ ok: boolean; letter: Letter }>(`/api/markings/attachments/${attachmentId}`)
}
