'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { addLetterAction, createLetter, updateLetter, type Letter, type LetterInput } from '@/services/letters'
import type { AiAuditEntry, AiDecision } from '@/services/ai'
import {
  createDepartment,
  createMasterValue,
  createOrganization,
  createUser,
  fetchBootstrap,
  markAllNotificationsRead,
  markNotificationRead,
  saveSettings,
  type AppNotification,
  type AppSettings,
  type AppUser,
  type AuditRecord,
  type BootstrapData,
  type CurrentUser,
  type Department,
  type DepartmentStat,
  type Organization,
} from '@/services/management'

type AppData = BootstrapData & {
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  registerLetter: (input: LetterInput) => Promise<Letter>
  addAction: (letterId: string, action: string) => Promise<void>
  readNotification: (id: number) => Promise<void>
  readAllNotifications: () => Promise<void>
  addDepartment: (input: { code: string; name: string; head?: string }) => Promise<void>
  addOrganization: (input: Partial<Organization> & { name: string }) => Promise<void>
  addUser: (input: { name: string; username: string; department?: string; role?: string; email?: string }) => Promise<void>
  addMasterValue: (category: string, value: string) => Promise<void>
  updateSettings: (input: Partial<AppSettings>) => Promise<void>
  applyLetterField: (letterId: string, field: string, value: string, decision: AiDecision) => Promise<void>
  acceptAiAction: (letterId: string, action: string, decision: AiDecision) => Promise<void>
  aiAudit: AiAuditEntry[]
}

const emptyMe: CurrentUser = { name: 'A. Rahman', role: 'Administrator', department: 'Coordination', initials: 'AR' }

const AppDataContext = createContext<AppData | null>(null)

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<BootstrapData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aiAudit, setAiAudit] = useState<AiAuditEntry[]>([])

  const refresh = useCallback(async () => {
    const next = await fetchBootstrap()
    setData(next)
    setError(null)
  }, [])

  useEffect(() => {
    refresh()
      .catch((err: Error) => setError(err.message || 'Unable to reach the AILMS API'))
      .finally(() => setLoading(false))
  }, [refresh])

  const value = useMemo<AppData>(() => {
    const base: BootstrapData = data ?? {
      letters: [],
      departments: [],
      organizations: [],
      users: [],
      notifications: [],
      auditRecords: [],
      masterData: {},
      trend: [],
      metrics: {},
      dashboardMetrics: [],
      alerts: [],
      departmentPerformance: [],
      statusDistribution: [],
      priorityPerformance: [],
      settings: { organizationName: '', systemName: '', defaultDueDays: '7', currentUser: emptyMe.name },
      me: emptyMe,
      unreadCount: 0,
    }

    const withRefresh = async (work: () => Promise<unknown>) => {
      await work()
      await refresh()
    }

    const recordAi = (letterId: string, field: string, value: string, decision: AiDecision) => {
      const letter = base.letters.find((item) => item.id === letterId)
      const user = base.me.name
      setAiAudit((current) => [
        {
          id: `${Date.now()}-${field}`,
          date: new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
          user,
          module: 'AI Intelligence',
          action: decision === 'rejected' ? 'AI Suggestion Rejected' : 'AI Suggestion Applied',
          record: letter?.number || letterId,
          description: `${field} suggested by AI and ${decision} by ${user}${decision === 'rejected' ? '' : `: ${value}`}.`,
          source: 'AI · mock',
          decision,
        },
        ...current,
      ])
    }

    const officialField = (field: string): keyof Letter | null => {
      const map: Record<string, keyof Letter> = {
        number: 'number',
        letterDate: 'letterDate',
        receivedDate: 'receivedDate',
        from: 'from',
        to: 'to',
        department: 'department',
        subject: 'subject',
        priority: 'priority',
        dueDate: 'dueDate',
        actionRequired: 'actionRequired',
        confidentiality: 'confidentiality',
        assignedTo: 'assignedTo',
        persons: 'assignedTo',
      }
      return map[field] ?? null
    }

    return {
      ...base,
      loading,
      error,
      refresh,
      registerLetter: async (input) => {
        const payload = { ...input }
        if (!payload.dueDate) delete payload.dueDate
        if (!payload.receivedDate) delete payload.receivedDate
        const letter = await createLetter(payload)
        await refresh()
        return letter
      },
      addAction: (letterId, action) => withRefresh(() => addLetterAction(letterId, action)),
      readNotification: (id) => withRefresh(() => markNotificationRead(id)),
      readAllNotifications: () => withRefresh(() => markAllNotificationsRead()),
      addDepartment: (input) => withRefresh(() => createDepartment(input)),
      addOrganization: (input) => withRefresh(() => createOrganization(input)),
      addUser: (input) => withRefresh(() => createUser(input)),
      addMasterValue: (category, value) => withRefresh(() => createMasterValue(category, value)),
      updateSettings: (input) => withRefresh(() => saveSettings(input)),
      applyLetterField: async (letterId, field, value, decision) => {
        recordAi(letterId, field, value, decision)
        const key = officialField(field)
        if (decision === 'rejected' || !key) return
        const mapped = field === 'priority' && value === 'High' ? 'Urgent' : value
        await withRefresh(() => updateLetter(letterId, { [key]: mapped } as Partial<Letter>))
      },
      acceptAiAction: async (letterId, action, decision) => {
        recordAi(letterId, 'action', action, decision)
        if (decision === 'rejected') return
        await withRefresh(() => addLetterAction(letterId, action))
      },
      aiAudit,
    }
  }, [aiAudit, data, error, loading, refresh])

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}

export function useAppData() {
  const context = useContext(AppDataContext)
  if (!context) throw new Error('useAppData must be used within AppDataProvider')
  return context
}

export function metricValue(metrics: Record<string, string>, label: string) {
  return metrics[label] ?? metrics['Total Correspondence'] ?? '0'
}

export type { AppNotification, AppUser, AuditRecord, Department, DepartmentStat, Letter, Organization }
