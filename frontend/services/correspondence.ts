import { api } from '@/lib/api'

export type CorrespondenceRelation = {
  id: number
  fromLetterId: string
  toLetterId: string
  relationshipType: string
  createdBy: string
  remarks: string
  createdAt: string
}

export type ThreadNode = {
  id: string
  number: string
  letterDate: string
  type: string
  from: string
  to: string
  subject: string
  status: string
  assignedTo: string
  actionStatus: string
}

export type CorrespondenceThread = {
  rootLetterId: string
  nodes: ThreadNode[]
  edges: { id: number; fromLetterId: string; toLetterId: string; relationshipType: string; direction: string; remarks: string }[]
  relations: CorrespondenceRelation[]
}

export async function listRelationTypes() {
  return api.get<{ types: string[] }>('/api/correspondence-relations/types')
}

export async function listLetterRelations(letterId: string) {
  return api.get<CorrespondenceRelation[]>(`/api/correspondence-relations?letterId=${encodeURIComponent(letterId)}`)
}

export async function createRelation(input: {
  fromLetterId: number
  toLetterId: number
  relationshipType: string
  remarks?: string
}) {
  return api.post<CorrespondenceRelation>('/api/correspondence-relations', input)
}

export async function fetchCorrespondenceThread(letterId: string) {
  return api.get<CorrespondenceThread>(`/api/correspondence-relations/letters/${letterId}/thread`)
}
