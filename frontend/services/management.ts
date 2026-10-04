import { api } from '@/lib/api'
import type { Letter } from './letters'

export type Department = {
  id: number
  code: string
  name: string
  head: string
  users: number
  pending: number
  status: string
  parentId?: number | null
  posX?: number
  posY?: number
}

export type DepartmentLink = {
  id: number
  sourceId: number
  targetId: number
  kind: string
}

export type Organization = {
  id?: number
  name: string
  short: string
  type: string
  contact: string
  email: string
  phone: string
  status: string
}

export type MasterValueItem = {
  id: number
  category: string
  value: string
  status: string
}
export type AppUser = {
  id?: number
  name: string
  username: string
  department: string
  role: string
  email: string
  status: string
  activity: string
  created?: string
  avatarUrl?: string
}
export type AuditRecord = { date: string; user: string; module: string; action: string; record: string; description: string; source: string }
export type AppNotification = {
  id: number
  title: string
  description: string
  time: string
  priority: string
  read: boolean
  letter: string
  notificationType?: string
  recipientName?: string
  relatedEntityType?: string
  relatedEntityId?: string
  readAt?: string
  navigateTo?: string
  navigateLabel?: string
  createdAt?: string
}
export type AlertItem = { title: string; count: number; tone: string }
export type DepartmentStat = { name: string; assigned: number; pending: number; completed: number; overdue: number }
export type StatusSlice = { name: string; value: number; tone: string }
export type PrioritySlice = { label: string; value: string; tone: string }
export type AppSettings = { organizationName: string; systemName: string; defaultDueDays: string; currentUser: string }
export type CurrentUser = {
  name: string
  role: string
  department: string
  initials: string
  username?: string
  email?: string
  id?: number
  avatarUrl?: string
}

export type BootstrapData = {
  letters: Letter[]
  departments: Department[]
  departmentLinks: DepartmentLink[]
  organizations: Organization[]
  users: AppUser[]
  notifications: AppNotification[]
  auditRecords: AuditRecord[]
  masterData: Record<string, string[]>
  trend: { month: string; incoming: number; outgoing: number }[]
  metrics: Record<string, string>
  dashboardMetrics: { label: string; value: string; icon: string; filter: string }[]
  alerts: AlertItem[]
  departmentPerformance: DepartmentStat[]
  statusDistribution: StatusSlice[]
  priorityPerformance: PrioritySlice[]
  settings: AppSettings
  me: CurrentUser
  unreadCount: number
}

export async function fetchBootstrap() {
  return api.get<BootstrapData>('/api/bootstrap')
}

export type DepartmentInput = {
  code: string
  name: string
  head?: string
  status?: string
  parentId?: number | null
  posX?: number
  posY?: number
}

export type DepartmentUpdate = Partial<DepartmentInput>

export async function createDepartment(input: DepartmentInput) {
  return api.post<Department>('/api/departments', input)
}

export async function updateDepartment(id: number, input: DepartmentUpdate) {
  return api.patch<Department>(`/api/departments/${id}`, input)
}

export async function deleteDepartment(id: number) {
  return api.delete<void>(`/api/departments/${id}`)
}

export async function createDepartmentLink(input: { sourceId: number; targetId: number; kind?: string }) {
  return api.post<DepartmentLink>('/api/department-links', input)
}

export async function deleteDepartmentLink(id: number) {
  return api.delete<void>(`/api/department-links/${id}`)
}

export async function createOrganization(input: Partial<Organization> & { name: string }) {
  return api.post<Organization>('/api/organizations', input)
}

export async function updateOrganization(id: number, input: Partial<Omit<Organization, 'id'>>) {
  return api.patch<Organization>(`/api/organizations/${id}`, input)
}

export async function deleteOrganization(id: number) {
  return api.delete<void>(`/api/organizations/${id}`)
}

export async function createUser(input: {
  name: string
  username: string
  password: string
  department?: string
  role?: string
  email?: string
  status?: string
}) {
  return api.post<AppUser>('/api/users', input)
}

export async function uploadUserAvatar(userId: number, file: File) {
  const form = new FormData()
  form.append('file', file)
  return api.postForm<AppUser>(`/api/users/${userId}/avatar`, form)
}

/** Match a display name / username to a seeded AppUser avatar URL. */
export function resolveUserAvatarUrl(users: AppUser[], name: string): string {
  const needle = name.trim().toLowerCase()
  if (!needle) return ''
  const match = users.find((u) => {
    return u.name.trim().toLowerCase() === needle || u.username.toLowerCase() === needle
  })
  return match?.avatarUrl || ''
}

export async function fetchMasterItems() {
  return api.get<MasterValueItem[]>('/api/master-data/items')
}

export async function createMasterValue(category: string, value: string, status = 'Active') {
  return api.post<MasterValueItem>('/api/master-data', { category, value, status })
}

export async function updateMasterValue(id: number, input: { value?: string; status?: string }) {
  return api.patch<MasterValueItem>(`/api/master-data/${id}`, input)
}

export async function deleteMasterValue(id: number) {
  return api.delete<void>(`/api/master-data/${id}`)
}

export { fetchNotifications, fetchNotificationSummary, fetchNotificationTypes, markAllNotificationsRead, markNotificationRead, openNotificationTarget } from '@/services/notifications'

export async function saveSettings(input: Partial<AppSettings>) {
  return api.put<AppSettings>('/api/settings', input)
}

export async function fetchReport(kind: string) {
  return api.get<{ report: string; rows: Letter[] }>(`/api/reports?kind=${encodeURIComponent(kind)}`)
}
