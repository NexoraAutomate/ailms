import type { Letter } from '@/services/letters'

export type LetterRowActionId =
  | 'edit'
  | 'delete'
  | 'assign'
  | 'forward'
  | 'reassign'
  | 'reply'
  | 'request_clarification'
  | 'mark_complete'
  | 'submit_for_approval'
  | 'approve'
  | 'reject'
  | 'return_for_revision'
  | 'escalate'
  | 'reopen'
  | 'close'
  | 'archive'

const ROLE_PERMISSIONS: Record<string, string[]> = {
  Administrator: [
    'assign', 'forward', 'reassign', 'add_action', 'request_response', 'request_clarification',
    'mark_complete', 'submit_for_approval', 'approve', 'reject', 'return_for_revision',
    'escalate', 'reopen', 'close', 'archive',
  ],
  Management: [
    'assign', 'forward', 'reassign', 'add_action', 'request_response', 'request_clarification',
    'mark_complete', 'submit_for_approval', 'approve', 'reject', 'return_for_revision',
    'escalate', 'reopen', 'close', 'archive',
  ],
  'Correspondence Officer': [
    'assign', 'forward', 'reassign', 'add_action', 'request_response', 'request_clarification',
    'mark_complete', 'submit_for_approval', 'return_for_revision', 'escalate', 'reopen', 'close', 'archive',
  ],
  'Department/User': ['add_action', 'request_clarification', 'mark_complete', 'submit_for_approval'],
}

const FROM_STATUSES: Record<string, string[]> = {
  assign: ['Draft', 'Registered', 'Under Review', 'Reopened'],
  forward: ['Registered', 'Assigned', 'Action in Progress'],
  reassign: ['Assigned', 'Action in Progress', 'Awaiting Response'],
  add_action: ['Registered', 'Assigned', 'Under Review', 'Awaiting Response', 'Returned for Revision', 'Reopened'],
  request_response: ['Action in Progress', 'Assigned', 'Response Prepared'],
  request_clarification: ['Action in Progress', 'Awaiting Response', 'Assigned'],
  mark_complete: ['Action in Progress', 'Awaiting Response', 'Response Sent', 'Response Approved'],
  submit_for_approval: ['Response Prepared', 'Action in Progress', 'Awaiting Response'],
  approve: ['Approval Pending'],
  reject: ['Approval Pending'],
  return_for_revision: ['Approval Pending', 'Response Prepared'],
  escalate: ['Action in Progress', 'Awaiting Response', 'Assigned', 'Approval Pending'],
  reopen: ['Closed', 'Completed', 'Archived'],
  close: ['Completed', 'Response Sent', 'Rejected'],
  archive: ['Closed', 'Completed', 'Rejected'],
}

const BUTTONS_BY_STATUS: Record<string, LetterRowActionId[]> = {
  Draft: ['edit', 'assign'],
  Registered: ['edit', 'assign', 'forward', 'reply'],
  'Under Review': ['edit', 'assign', 'reply'],
  Assigned: ['edit', 'forward', 'reply', 'reassign', 'request_clarification', 'escalate'],
  'Action in Progress': ['edit', 'forward', 'reply', 'request_clarification', 'mark_complete', 'submit_for_approval', 'escalate'],
  'Awaiting Response': ['edit', 'reply', 'reassign', 'request_clarification', 'escalate', 'mark_complete'],
  'Response Prepared': ['edit', 'reply', 'submit_for_approval', 'return_for_revision'],
  'Approval Pending': ['approve', 'reject', 'return_for_revision', 'escalate'],
  'Response Approved': ['edit', 'mark_complete'],
  'Response Sent': ['edit', 'mark_complete', 'close'],
  Completed: ['close', 'archive', 'reopen'],
  Closed: ['reopen', 'archive'],
  Rejected: ['close', 'archive'],
  'Returned for Revision': ['edit', 'reply'],
  Escalated: ['edit', 'reassign', 'reply'],
  Reopened: ['edit', 'assign', 'reply'],
}

export const letterActionLabel: Record<LetterRowActionId, string> = {
  edit: 'Edit',
  delete: 'Delete',
  assign: 'Assign',
  forward: 'Forward',
  reassign: 'Reassign',
  reply: 'Reply',
  request_clarification: 'Clarify',
  mark_complete: 'Complete',
  submit_for_approval: 'Submit',
  approve: 'Approve',
  reject: 'Reject',
  return_for_revision: 'Return',
  escalate: 'Escalate',
  reopen: 'Reopen',
  close: 'Close',
  archive: 'Archive',
}

export function isAdministrator(role: string) {
  const normalized = role.trim().toLowerCase()
  return normalized === 'administrator' || normalized === 'admin'
}

export function workflowStatus(letter: Letter) {
  if (letter.baseStatus) return letter.baseStatus
  if (letter.status === 'Overdue') return 'Action in Progress'
  return letter.status
}

function permissionsFor(role: string) {
  return new Set(ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS['Department/User'])
}

function transitionAllowed(action: string, status: string, role: string) {
  const from = FROM_STATUSES[action]
  if (!from || !from.includes(status)) return false
  return permissionsFor(role).has(action)
}

export function replyWorkflowAction(status: string, role: string): 'request_response' | 'add_action' | null {
  if (transitionAllowed('request_response', status, role)) return 'request_response'
  if (transitionAllowed('add_action', status, role)) return 'add_action'
  return null
}

export function letterRowActions(letter: Letter, role: string): LetterRowActionId[] {
  if (letter.isArchived || workflowStatus(letter) === 'Archived') {
    return isAdministrator(role) ? ['delete'] : []
  }
  const status = workflowStatus(letter)
  const catalog = BUTTONS_BY_STATUS[status] ?? ['edit']
  const actions = catalog.filter((action) => {
    if (action === 'edit') return true
    if (action === 'reply') return replyWorkflowAction(status, role) !== null
    return transitionAllowed(action, status, role)
  })
  if (isAdministrator(role)) actions.push('delete')
  return actions
}

export function actionNeedsInput(action: LetterRowActionId) {
  return [
    'assign',
    'forward',
    'reassign',
    'reply',
    'request_clarification',
    'submit_for_approval',
    'approve',
    'reject',
    'return_for_revision',
    'escalate',
  ].includes(action)
}
