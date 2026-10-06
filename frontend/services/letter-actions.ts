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
  | 'validate'
  | 'classify'
  | 'approve_routing'
  | 'route_info'
  | 'close_information'
  | 'delegate'
  | 'handle_here'
  | 'draft_response'
  | 'approve_step'
  | 'dispatch'

const ENTERPRISE_PERMS = [
  'validate', 'classify', 'approve_routing', 'route_info', 'acknowledge_info', 'close_information',
  'delegate', 'handle_here', 'accept_action', 'start_action', 'block_action', 'complete_action',
  'draft_response', 'submit_for_approval', 'approve_step', 'return_for_revision', 'dispatch',
]

const ROLE_PERMISSIONS: Record<string, string[]> = {
  Admin: [
    'assign', 'forward', 'reassign', 'add_action', 'request_response', 'request_clarification',
    'mark_complete', 'submit_for_approval', 'approve', 'reject', 'return_for_revision',
    'escalate', 'reopen', 'close', 'archive', ...ENTERPRISE_PERMS,
  ],
  Administrator: [
    'assign', 'forward', 'reassign', 'add_action', 'request_response', 'request_clarification',
    'mark_complete', 'submit_for_approval', 'approve', 'reject', 'return_for_revision',
    'escalate', 'reopen', 'close', 'archive', ...ENTERPRISE_PERMS,
  ],
  Management: [
    'assign', 'forward', 'reassign', 'add_action', 'request_response', 'request_clarification',
    'mark_complete', 'submit_for_approval', 'approve', 'reject', 'return_for_revision',
    'escalate', 'reopen', 'close', 'archive', ...ENTERPRISE_PERMS,
  ],
  Manager: [
    'assign', 'forward', 'reassign', 'add_action', 'request_response', 'request_clarification',
    'mark_complete', 'submit_for_approval', 'approve', 'reject', 'return_for_revision',
    'escalate', 'reopen', 'close',
    'classify', 'route_info', 'close_information', 'delegate', 'handle_here',
    'accept_action', 'start_action', 'block_action', 'complete_action',
    'draft_response', 'approve_step', 'return_for_revision',
  ],
  Coordinator: [
    'assign', 'forward', 'reassign', 'add_action', 'request_response', 'request_clarification',
    'mark_complete', 'submit_for_approval', 'return_for_revision', 'escalate', 'reopen', 'close', 'archive',
    'validate', 'classify', 'route_info', 'close_information', 'delegate', 'handle_here',
  ],
  'Correspondence Officer': [
    'assign', 'forward', 'reassign', 'add_action', 'request_response', 'request_clarification',
    'mark_complete', 'submit_for_approval', 'return_for_revision', 'escalate', 'reopen', 'close', 'archive',
    'validate', 'classify', 'route_info', 'close_information', 'delegate', 'handle_here',
  ],
  Actionist: [
    'add_action', 'request_clarification', 'mark_complete', 'submit_for_approval',
    'acknowledge_info', 'accept_action', 'start_action', 'block_action', 'complete_action',
    'draft_response',
  ],
  'Department/User': [
    'add_action', 'request_clarification', 'mark_complete', 'submit_for_approval',
    'acknowledge_info', 'accept_action', 'start_action', 'block_action', 'complete_action',
    'draft_response',
  ],
  Viewer: [],
}

const FROM_STATUSES: Record<string, string[]> = {
  assign: ['Draft', 'Registered', 'Under Review', 'Reopened', 'Validated', 'Classified'],
  forward: ['Registered', 'Assigned', 'Action in Progress', 'Action Assigned', 'In Progress', 'Routed'],
  reassign: ['Assigned', 'Action in Progress', 'Awaiting Response', 'Action Assigned', 'In Progress'],
  add_action: ['Registered', 'Assigned', 'Under Review', 'Awaiting Response', 'Returned for Revision', 'Reopened', 'Action Assigned', 'In Progress'],
  request_response: ['Action in Progress', 'Assigned', 'Response Prepared', 'In Progress', 'Action Assigned', 'Response Drafted'],
  request_clarification: ['Action in Progress', 'Awaiting Response', 'Assigned', 'In Progress', 'Action Assigned'],
  mark_complete: ['Action in Progress', 'Awaiting Response', 'Response Sent', 'Response Approved', 'In Progress', 'Dispatched', 'Approved for Dispatch'],
  submit_for_approval: ['Response Prepared', 'Action in Progress', 'Awaiting Response', 'Response Drafted', 'In Progress', 'Returned for Revision'],
  approve: ['Approval Pending', 'Under Approval'],
  reject: ['Approval Pending', 'Under Approval'],
  return_for_revision: ['Approval Pending', 'Response Prepared', 'Under Approval', 'Response Drafted'],
  escalate: ['Action in Progress', 'Awaiting Response', 'Assigned', 'Approval Pending', 'In Progress', 'Action Assigned', 'Under Approval'],
  reopen: ['Closed', 'Completed', 'Archived', 'Information Delivered', 'Dispatched'],
  close: ['Completed', 'Response Sent', 'Rejected', 'Dispatched', 'Information Delivered', 'Approved for Dispatch'],
  archive: ['Closed', 'Completed', 'Rejected', 'Information Delivered'],
  validate: ['Registered', 'OCR Processed', 'LLM Analyzed'],
  classify: ['Validated', 'LLM Analyzed', 'OCR Processed', 'Registered'],
  approve_routing: ['Classified', 'Pending Routing Approval'],
  route_info: ['Classified', 'Routed'],
  close_information: ['Routed', 'Classified', 'Information Delivered'],
  delegate: ['Routed', 'Action Assigned', 'In Progress', 'Pending Routing Approval'],
  handle_here: ['Routed', 'Action Assigned', 'Pending Routing Approval'],
  draft_response: ['In Progress', 'Action Assigned', 'Returned for Revision', 'Response Drafted'],
  approve_step: ['Under Approval'],
  dispatch: ['Approved for Dispatch', 'Response Approved'],
}

const BUTTONS_BY_STATUS: Record<string, LetterRowActionId[]> = {
  Draft: ['edit', 'assign'],
  Registered: ['edit', 'validate', 'classify', 'assign', 'forward', 'reply'],
  'OCR Processed': ['edit', 'validate', 'classify'],
  'LLM Analyzed': ['edit', 'validate', 'classify'],
  Validated: ['edit', 'classify'],
  Classified: ['edit', 'approve_routing', 'route_info', 'close_information'],
  'Pending Routing Approval': ['edit', 'approve_routing', 'delegate', 'handle_here'],
  Routed: ['edit', 'delegate', 'handle_here', 'route_info', 'close_information', 'reply'],
  'Action Assigned': ['edit', 'delegate', 'draft_response', 'reply', 'reassign', 'request_clarification', 'escalate'],
  'In Progress': ['edit', 'draft_response', 'submit_for_approval', 'reply', 'mark_complete', 'escalate'],
  'Response Drafted': ['edit', 'draft_response', 'submit_for_approval', 'return_for_revision'],
  'Under Approval': ['approve_step', 'approve', 'reject', 'return_for_revision', 'escalate'],
  'Approved for Dispatch': ['edit', 'dispatch', 'mark_complete'],
  Dispatched: ['edit', 'close', 'mark_complete'],
  'Information Delivered': ['close', 'archive', 'reopen'],
  'Under Review': ['edit', 'assign', 'classify', 'reply'],
  Assigned: ['edit', 'forward', 'reply', 'reassign', 'request_clarification', 'escalate'],
  'Action in Progress': ['edit', 'forward', 'reply', 'request_clarification', 'mark_complete', 'submit_for_approval', 'escalate', 'draft_response'],
  'Awaiting Response': ['edit', 'reply', 'reassign', 'request_clarification', 'escalate', 'mark_complete'],
  'Response Prepared': ['edit', 'reply', 'submit_for_approval', 'return_for_revision'],
  'Approval Pending': ['approve', 'reject', 'return_for_revision', 'escalate', 'approve_step'],
  'Response Approved': ['edit', 'dispatch', 'mark_complete'],
  'Response Sent': ['edit', 'mark_complete', 'close'],
  Completed: ['close', 'archive', 'reopen'],
  Closed: ['reopen', 'archive'],
  Rejected: ['close', 'archive'],
  'Returned for Revision': ['edit', 'reply', 'draft_response', 'submit_for_approval'],
  Escalated: ['edit', 'reassign', 'reply'],
  Reopened: ['edit', 'assign', 'reply', 'validate', 'classify'],
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
  validate: 'Validate',
  classify: 'Classify',
  approve_routing: 'Approve routing',
  route_info: 'Route FYI',
  close_information: 'Close info',
  delegate: 'Delegate',
  handle_here: 'Handle here',
  draft_response: 'Draft reply',
  approve_step: 'Approve step',
  dispatch: 'Dispatch',
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
  return new Set(ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.Actionist ?? ROLE_PERMISSIONS['Department/User'])
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
    'classify',
    'approve_routing',
    'route_info',
    'delegate',
    'draft_response',
    'dispatch',
  ].includes(action)
}
