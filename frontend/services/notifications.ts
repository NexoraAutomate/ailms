import { api } from '@/lib/api'
import type { AppNotification } from '@/services/management'

export type NotificationSummary = {
  total: number
  unread: number
  byType: Record<string, number>
}

export async function fetchNotificationTypes() {
  return api.get<{ types: string[] }>('/api/notifications/types')
}

export async function fetchNotificationSummary() {
  return api.get<NotificationSummary>('/api/notifications/summary')
}

export async function fetchNotifications(params?: { unread?: boolean; notificationType?: string }) {
  const search = new URLSearchParams()
  if (params?.unread) search.set('unread', 'true')
  if (params?.notificationType) search.set('notificationType', params.notificationType)
  const q = search.toString()
  return api.get<AppNotification[]>(`/api/notifications${q ? `?${q}` : ''}`)
}

export async function markNotificationRead(id: number) {
  return api.patch<AppNotification>(`/api/notifications/${id}/read`)
}

export async function markAllNotificationsRead() {
  return api.post<AppNotification[]>('/api/notifications/mark-all-read')
}

export function openNotificationTarget(go: (page: string) => void, notification: AppNotification) {
  const target = notification.navigateTo || notification.letter
  if (target) go(target)
}
