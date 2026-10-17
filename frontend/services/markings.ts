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

export type MarkingNode = {
  id: number
  batchId: number
  letterId: string
  parentMarkingId: number | null
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
}

export type MarkBatchInput = {
  recipients: MarkRecipientInput[]
  remarks?: string
  pathwayNotify?: boolean
  parentMarkingId?: number | null
}

export type CorrespondenceNote = {
  id: number
  letterId: string
  markingId: number | null
  authorUser: string
  bodyText: string
  isResponse: boolean
  clientIp: string
  createdAt: string
  attachments: {
    id: number
    documentId: number | null
    attachmentKind: string
    storageKey: string
    originalFilename: string
    clientIp: string
    createdAt: string
  }[]
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

export async function markLetter(letterId: string, input: MarkBatchInput) {
  return api.post<{ batch: { id: number }; markings: MarkingNode[]; letter: Letter }>(
    `/api/markings/letters/${letterId}/mark`,
    input,
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
    attachments?: { attachmentKind: string; documentId?: number; originalFilename?: string }[]
  },
) {
  return api.post<{ note: CorrespondenceNote; letter: Letter }>(
    `/api/markings/letters/${letterId}/notes`,
    input,
  )
}

export async function respondToMarking(
  markingId: number,
  input: { bodyText: string; attachments?: { attachmentKind: string; documentId?: number }[] },
) {
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

export async function fetchBatchTracker(batchId: number) {
  return api.get<{
    pendingCount: number
    respondedCount: number
    allResponsesReceived: boolean
    markings: MarkingNode[]
  }>(`/api/markings/batches/${batchId}/tracker`)
}
