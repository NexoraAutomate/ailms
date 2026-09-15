import { api } from '@/lib/api'

export type MeetingAction = {
  id: number
  meetingId: string
  actionDescription: string
  responsiblePerson: string
  department: string
  priority: string
  dueDate: string
  status: string
  remarks: string
  completionDate: string
}

export type Meeting = {
  id: string
  title: string
  date: string
  startTime: string
  endTime: string
  location: string
  chairperson: string
  agenda: string
  minutes: string
  status: string
  createdBy: string
  participants: { id: number; name: string; department: string }[]
  actions: MeetingAction[]
  letterIds: string[]
  createdAt: string
  updatedAt: string
}

export async function listMeetings(params?: { status?: string; letterId?: string }) {
  const search = new URLSearchParams()
  if (params?.status) search.set('status', params.status)
  if (params?.letterId) search.set('letterId', params.letterId)
  const q = search.toString()
  return api.get<Meeting[]>(`/api/meetings${q ? `?${q}` : ''}`)
}

export async function getMeeting(id: string) {
  return api.get<Meeting>(`/api/meetings/${id}`)
}

export async function createMeeting(input: {
  title: string
  date: string
  startTime?: string
  endTime?: string
  location?: string
  chairperson?: string
  agenda?: string
  status?: string
  participants?: { name: string; department?: string }[]
}) {
  return api.post<Meeting>('/api/meetings', input)
}

export async function linkMeetingLetter(meetingId: string, letterId: string) {
  return api.post(`/api/meetings/${meetingId}/letters/${letterId}/link`)
}

export async function addMeetingAction(meetingId: string, input: Partial<MeetingAction> & { actionDescription: string }) {
  return api.post<MeetingAction>(`/api/meetings/${meetingId}/actions`, input)
}

export async function updateMeetingAction(actionId: number, input: Partial<MeetingAction>) {
  return api.patch<MeetingAction>(`/api/meetings/meeting-actions/${actionId}`, input)
}
