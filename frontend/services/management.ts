import { api } from '@/lib/api'
import type { Letter } from './letters'

export type Department = { code: string; name: string; head: string; users: number; pending: number; status: string }
export type Organization = { name: string; short: string; type: string; contact: string; email: string; phone: string; status: string }
export type AppUser = { id?: number; name: string; username: string; department: string; role: string; email: string; status: string; activity: string; created?: string }
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
export type CurrentUser = { name: string; role: string; department: string; initials: string }

export type BootstrapData = {
  letters: Letter[]
  departments: Department[]
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

export async function createDepartment(input: { code: string; name: string; head?: string; status?: string }) {
  return api.post<Department>('/api/departments', input)
}

export async function createOrganization(input: Partial<Organization> & { name: string }) {
  return api.post<Organization>('/api/organizations', input)
}

export async function createUser(input: { name: string; username: string; department?: string; role?: string; email?: string; status?: string }) {
  return api.post<AppUser>('/api/users', input)
}

export async function createMasterValue(category: string, value: string) {
  return api.post('/api/master-data', { category, value })
}

export { fetchNotifications, fetchNotificationSummary, fetchNotificationTypes, markAllNotificationsRead, markNotificationRead, openNotificationTarget } from '@/services/notifications'

export async function saveSettings(input: Partial<AppSettings>) {
  return api.put<AppSettings>('/api/settings', input)
}

export async function fetchReport(kind: string) {
  return api.get<{ report: string; rows: Letter[] }>(`/api/reports?kind=${encodeURIComponent(kind)}`)
}
