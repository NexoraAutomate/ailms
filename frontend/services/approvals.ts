import { api } from '@/lib/api'

export type Approval = {
  id: number
  letterId: string
  documentId?: number | null
  preparedBy: string
  reviewer: string
  submittedAt: string
  reviewedAt: string
  approvalStatus: string
  reviewerRemarks: string
  revisionNumber: number
  createdAt: string
  updatedAt: string
}

export async function listApprovals(letterId?: string, status?: string) {
  const params = new URLSearchParams()
  if (letterId) params.set('letterId', letterId)
  if (status) params.set('status', status)
  const q = params.toString()
  return api.get<Approval[]>(`/api/approvals${q ? `?${q}` : ''}`)
}

export async function getCurrentApproval(letterId: string) {
  return api.get<Approval | null>(`/api/approvals/letters/${letterId}/current`)
}

export async function submitApproval(letterId: string, input: { reviewer?: string; remarks?: string }) {
  return api.post<Approval>(`/api/approvals/letters/${letterId}/submit`, input)
}

export async function reviewApproval(approvalId: number, decision: string, remarks: string) {
  return api.post<Approval>(`/api/approvals/${approvalId}/review`, { decision, remarks })
}
