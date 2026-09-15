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
  actionLabel?: string
  reviewerName?: string
  escalatedTo?: string
  escalationLevel?: string
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

export async function executeWorkflow(letterId: string, input: WorkflowExecuteInput) {
  return api.post<{ letter: Letter; transition: WorkflowTransition }>(
    `/api/workflow/letters/${letterId}/execute-with-letter`,
    input,
  )
}
