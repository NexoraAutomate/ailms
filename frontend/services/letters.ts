import { api } from '@/lib/api'

export type LetterType = 'Incoming' | 'Outgoing'
export type LetterStatus =
  | 'Draft'
  | 'Registered'
  | 'Under Review'
  | 'Assigned'
  | 'Action in Progress'
  | 'Awaiting Response'
  | 'Response Prepared'
  | 'Approval Pending'
  | 'Response Approved'
  | 'Response Sent'
  | 'Completed'
  | 'Closed'
  | 'Rejected'
  | 'Returned for Revision'
  | 'Escalated'
  | 'Reopened'
  | 'Archived'
  | 'Overdue'
export type Priority = 'Routine' | 'Important' | 'Urgent'

export type Letter = {
  id: string
  number: string
  letterDate: string
  receivedDate: string
  type: LetterType
  subject: string
  from: string
  to: string
  department: string
  priority: Priority
  status: LetterStatus
  dueDate: string
  assignedTo: string
  lastAction: string
  daysPending: number
  confidentiality?: string
  actionRequired?: string
  remarks?: string
  /** Full OCR / letter body text used by AI Q&A. */
  bodyText?: string
  completionDate?: string
  isArchived?: boolean
  /** Stored workflow status. `status` may be the derived value Overdue. */
  baseStatus?: string
}

export type DashboardMetric = { label: string; value: string; icon: string; filter: string }
export type TrendPoint = { month: string; incoming: number; outgoing: number }
export type LetterInput = Partial<Letter> & { number: string; subject: string }

export const statusTone = (status: LetterStatus) =>
  ({
    Draft: 'slate',
    Registered: 'slate',
    'Under Review': 'amber',
    Assigned: 'blue',
    'Action in Progress': 'indigo',
    'Awaiting Response': 'violet',
    'Response Prepared': 'indigo',
    'Approval Pending': 'amber',
    'Response Approved': 'green',
    'Response Sent': 'violet',
    Completed: 'green',
    Closed: 'slate',
    Rejected: 'red',
    'Returned for Revision': 'amber',
    Escalated: 'red',
    Reopened: 'blue',
    Archived: 'slate',
    Overdue: 'red',
  }[status] ?? 'slate')

export const priorityTone = (priority: Priority) => ({ Routine: 'slate', Important: 'amber', Urgent: 'red' }[priority])

export async function listLetters(params?: { q?: string; view?: string; includeArchived?: boolean }) {
  const search = new URLSearchParams()
  if (params?.q) search.set('q', params.q)
  if (params?.view) search.set('view', params.view)
  if (params?.includeArchived) search.set('include_archived', 'true')
  const suffix = search.toString() ? `?${search.toString()}` : ''
  return api.get<Letter[]>(`/api/letters${suffix}`)
}

export async function getLetter(id: string) {
  return api.get<Letter>(`/api/letters/${id}`)
}

export async function createLetter(input: LetterInput) {
  return api.post<Letter>('/api/letters', input)
}

export async function addLetterAction(letterId: string, action: string) {
  return api.post(`/api/letters/${letterId}/actions`, { action })
}

export async function updateLetterStatus(id: string, status: LetterStatus) {
  return api.patch<Letter>(`/api/letters/${id}/status`, { status })
}

export async function updateLetter(id: string, input: Partial<Letter>) {
  const payload = { ...input }
  if (!payload.dueDate) delete payload.dueDate
  return api.patch<Letter>(`/api/letters/${id}`, payload)
}

export type LetterDeleteChallenge = {
  confirmationCode: string
  letterIds: number[]
  expiresInSeconds: number
}

export async function requestLetterDeleteChallenge(letterIds: number[]) {
  return api.post<LetterDeleteChallenge>('/api/letters/delete-challenge', { letterIds })
}

export async function deleteLetters(letterIds: number[], confirmationCode: string) {
  return api.post<{ deleted: number; letterIds: number[] }>('/api/letters/delete', { letterIds, confirmationCode })
}
