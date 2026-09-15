import { api } from '@/lib/api'

export type Escalation = {
  id: number
  letterId: string
  actionId?: number | null
  escalationLevel: string
  escalatedBy: string
  escalatedTo: string
  reason: string
  escalationDate: string
  targetResolutionDate: string
  resolutionDate: string
  remarks: string
  status: string
  createdAt: string
  updatedAt: string
}

export async function listEscalations(letterId?: string, status?: string) {
  const params = new URLSearchParams()
  if (letterId) params.set('letterId', letterId)
  if (status) params.set('status', status)
  const q = params.toString()
  return api.get<Escalation[]>(`/api/escalations${q ? `?${q}` : ''}`)
}

export async function resolveEscalation(id: number, remarks = '') {
  return api.post<Escalation>(`/api/escalations/${id}/resolve`, { remarks })
}
