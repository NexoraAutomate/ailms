import { api } from '@/lib/api'
import type { AppUser } from './management'

export type RoleRow = { id: number; name: string; description: string; permissionCount: number }
export type StatusBadge = { id: number; category: string; name: string; description: string; color: string }
export type AdminResource = { key: string; label: string; other: string[] }
export type UserStats = { totalUsers: number; activeUsers: number; inactiveUsers: number; loggedIn: number; failedLoginsToday: number }
export type SessionRow = {
  id: number
  username: string
  userDisplay: string
  device: string
  browser: string
  os: string
  ipAddress: string
  loginTime: string
  lastActivity: string
  status: string
}

export async function fetchUserStats() {
  return api.get<UserStats>('/api/admin/user-stats')
}

export async function updateUser(id: number, body: Partial<AppUser> & { password?: string; status?: string }) {
  return api.patch<AppUser>(`/api/users/${id}`, body)
}

export async function deleteUser(id: number) {
  return api.delete<{ deleted: number }>(`/api/users/${id}`)
}

export async function fetchRoles() {
  return api.get<RoleRow[]>('/api/admin/roles')
}

export async function createRole(name: string, description: string) {
  return api.post<RoleRow>('/api/admin/roles', { name, description })
}

export async function deleteRole(id: number) {
  return api.delete(`/api/admin/roles/${id}`)
}

export async function fetchRolePermissions(roleId: number) {
  return api.get<{ id: number; name: string; description: string; permissions: Record<string, PermissionRow>; permissionCount: number; totalSlots: number }>(
    `/api/admin/roles/${roleId}/permissions`,
  )
}

export type PermissionRow = { view: boolean; create: boolean; edit: boolean; delete: boolean; other: Record<string, boolean> }

export async function saveRolePermissions(roleId: number, description: string, permissions: Record<string, PermissionRow>) {
  return api.put(`/api/admin/roles/${roleId}/permissions`, { description, permissions })
}

export async function fetchAdminResources() {
  return api.get<{ resources: AdminResource[] }>('/api/admin/resources')
}

export async function fetchStatusDefinitions() {
  return api.get<StatusBadge[]>('/api/admin/status-definitions')
}

export async function saveStatusDefinition(input: Omit<StatusBadge, 'id'> & { id?: number }) {
  if (input.id) return api.patch<StatusBadge>(`/api/admin/status-definitions/${input.id}`, input)
  return api.post<StatusBadge>('/api/admin/status-definitions', input)
}

export async function deleteStatusDefinition(id: number) {
  return api.delete(`/api/admin/status-definitions/${id}`)
}

export async function fetchSecuritySettings() {
  return api.get<Record<string, unknown>>('/api/admin/security')
}

export async function saveSecuritySettings(body: Record<string, unknown>) {
  return api.put<Record<string, unknown>>('/api/admin/security', body)
}

export async function fetchAlertSettings() {
  return api.get<{ email: Record<string, boolean>; inApp: Record<string, boolean> }>('/api/admin/alerts')
}

export async function saveAlertSettings(body: Record<string, unknown>) {
  return api.put('/api/admin/alerts', body)
}

export async function fetchSessions() {
  return api.get<SessionRow[]>('/api/admin/sessions')
}

export async function terminateSession(id: number) {
  return api.delete(`/api/admin/sessions/${id}`)
}

export async function terminateAllSessions() {
  return api.post<{ terminated: number }>('/api/admin/sessions/terminate-all')
}
