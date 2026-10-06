import { api } from '@/lib/api'
import type { Letter } from '@/services/letters'

export type WorkflowTransition = {
  id: number
  letterId: string
  action: string
  fromStatus: string
  toStatus: string
  performedBy: string
  remarks: string
  assignedTo: string
  department: string
  createdAt: string
}

export type WorkflowActions = {
  letterId: string
  currentStatus: string
  actions: string[]
}

export type WorkflowExecuteInput = {
  action: string
  remarks?: string
  assignedTo?: string
  department?: string
  departmentId?: number
  actionLabel?: string
  reviewerName?: string
  escalatedTo?: string
  escalationLevel?: string
  category?: string
  actionItemId?: number
  responseBody?: string
  responseVersionId?: number
  approvalStepId?: number
  infoRecipients?: { user?: string; department?: string; departmentId?: number }[]
  dispatchChannel?: string
  dispatchRecipients?: string
  priority?: string
  dueDate?: string
  instructions?: string
  blockedReason?: string
  documentId?: number
}

export type RouteStep = {
  id: number
  letterId: string
  stepType: string
  fromDepartmentId: number | null
  toDepartmentId: number | null
  fromUser: string
  toUser: string
  instructions: string
  dueDate: string
  priority: string
  active: boolean
  acknowledgedAt: string
  createdBy: string
  createdAt: string
}

export type ActionItem = {
  id: number
  letterId: string
  parentActionId: number | null
  departmentId: number | null
  assignee: string
  status: string
  instructions: string
  dueDate: string
  blockedReason: string
  createdBy: string
  createdAt: string
  updatedAt: string
  completedAt: string
}

export type ResponseVersion = {
  id: number
  letterId: string
  version: number
  bodyText: string
  status: string
  preparedBy: string
  documentId: number | null
  createdAt: string
  updatedAt: string
}

export type ApprovalStep = {
  id: number
  responseVersionId: number
  tierOrder: number
  departmentId: number | null
  reviewer: string
  status: string
  remarks: string
  reviewedAt: string
  createdAt: string
}

export type DispatchRecord = {
  id: number
  letterId: string
  responseVersionId: number | null
  channel: string
  dispatchedBy: string
  recipients: string
  notes: string
  dispatchedAt: string
}

const actionLabels: Record<string, string> = {
  assign: 'Assign',
  forward: 'Forward',
  reassign: 'Reassign',
  add_action: 'Add action',
  request_response: 'Request response',
  request_clarification: 'Request clarification',
  mark_complete: 'Mark complete',
  submit_for_approval: 'Submit for approval',
  approve: 'Approve',
  reject: 'Reject',
  return_for_revision: 'Return for revision',
  escalate: 'Escalate',
  reopen: 'Reopen',
  close: 'Close',
  archive: 'Archive',
  validate: 'Validate',
  classify: 'Classify',
  approve_routing: 'Approve routing',
  route_info: 'Route for information',
  acknowledge_info: 'Acknowledge',
  close_information: 'Close as information delivered',
  delegate: 'Delegate',
  handle_here: 'Handle at this tier',
  accept_action: 'Accept action',
  start_action: 'Start action',
  block_action: 'Block action',
  complete_action: 'Complete action',
  draft_response: 'Draft response',
  approve_step: 'Approve step',
  dispatch: 'Dispatch',
}

export function workflowActionLabel(action: string) {
  return actionLabels[action] ?? action.replace(/_/g, ' ')
}

export async function fetchWorkflowActions(letterId: string) {
  return api.get<WorkflowActions>(`/api/workflow/letters/${letterId}/actions`)
}

export async function fetchWorkflowHistory(letterId: string) {
  return api.get<WorkflowTransition[]>(`/api/workflow/letters/${letterId}/history`)
}

export async function fetchRouteSteps(letterId: string) {
  return api.get<RouteStep[]>(`/api/workflow/letters/${letterId}/route-steps`)
}

export async function fetchActionItems(letterId: string) {
  return api.get<ActionItem[]>(`/api/workflow/letters/${letterId}/action-items`)
}

export async function fetchResponseVersions(letterId: string) {
  return api.get<ResponseVersion[]>(`/api/workflow/letters/${letterId}/response-versions`)
}

export async function fetchApprovalSteps(letterId: string) {
  return api.get<ApprovalStep[]>(`/api/workflow/letters/${letterId}/approval-steps`)
}

export async function fetchDispatches(letterId: string) {
  return api.get<DispatchRecord[]>(`/api/workflow/letters/${letterId}/dispatches`)
}

export async function executeWorkflow(letterId: string, input: WorkflowExecuteInput) {
  return api.post<{ letter: Letter; transition: WorkflowTransition }>(
    `/api/workflow/letters/${letterId}/execute-with-letter`,
    input,
  )
}
