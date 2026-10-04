'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Flame,
  Inbox,
  Timer,
} from 'lucide-react'
import { useAppData } from '@/components/app-provider'
import { useCmsSearch } from '@/components/cms/search-context'
import { LetterDeleteDialog } from '@/components/cms/letter-delete-dialog'
import { LetterTable } from '@/components/cms/letter-table'
import { Kpi, MiniDashboard, PageTitle } from '@/components/cms/ui'
import {
  AnimatedProgressStepper,
  personInitials,
  type AnimatedProgressStep,
  type HandlerTaskDetail,
} from '@/components/ui/animated-progress-stepper'
import { useGo } from '@/hooks/use-go'
import { isAdministrator } from '@/services/letter-actions'
import type { Letter } from '@/services/letters'
import { resolveUserAvatarUrl, type AppUser } from '@/services/management'
import {
  fetchWorkflowHistory,
  workflowActionLabel,
  type WorkflowTransition,
} from '@/services/workflow'

const SPARK_DAYS = 7

function isMonitored(letter: Letter) {
  return letter.status === 'Overdue' || letter.daysPending >= 7 || !['Closed', 'Completed', 'Archived'].includes(letter.status)
}

function dueSoon(letter: Letter) {
  if (!letter.dueDate || letter.dueDate === '—') return false
  if (['Closed', 'Completed', 'Archived'].includes(letter.status)) return false
  const due = Date.parse(letter.dueDate)
  if (Number.isNaN(due)) return false
  const diffDays = (due - Date.now()) / (1000 * 60 * 60 * 24)
  return diffDays >= 0 && diffDays <= 2
}

function dayKey(value: string | undefined) {
  if (!value || value === '—') return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) {
    // Accept dd/mm/yyyy style if present
    const m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
    if (!m) return ''
    return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  return d.toISOString().slice(0, 10)
}

function lastDayKeys(n: number, endIso?: string) {
  const keys: string[] = []
  const now = endIso ? new Date(`${endIso}T12:00:00`) : new Date()
  now.setHours(12, 0, 0, 0)
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    keys.push(d.toISOString().slice(0, 10))
  }
  return keys
}

function letterAnchorDay(letter: Letter) {
  return dayKey(letter.receivedDate) || dayKey(letter.letterDate)
}

/** Prefer the latest letter day so historical seed data still yields a readable week. */
function seriesWindow(letters: Letter[]) {
  const dates = letters.map(letterAnchorDay).filter(Boolean).sort()
  if (!dates.length) return lastDayKeys(SPARK_DAYS)
  return lastDayKeys(SPARK_DAYS, dates[dates.length - 1])
}

function dailyCounts(letters: Letter[], window: string[]) {
  return window.map((day) => letters.filter((l) => letterAnchorDay(l) === day).length)
}

function startOfDay(d = new Date()) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function startOfWeek(d = new Date()) {
  const x = startOfDay(d)
  const day = x.getDay() // 0 Sun … 6 Sat
  const diff = day === 0 ? 6 : day - 1 // Monday start
  x.setDate(x.getDate() - diff)
  return x
}

function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function startOfYear(d = new Date()) {
  return new Date(d.getFullYear(), 0, 1)
}

function letterTimeMs(letter: Letter) {
  return parseTimestamp(letter.receivedDate) ?? parseTimestamp(letter.letterDate)
}

function countSince(letters: Letter[], from: Date) {
  const fromMs = from.getTime()
  return letters.filter((l) => {
    const t = letterTimeMs(l)
    return t != null && t >= fromMs
  }).length
}

function periodBreakdown(letters: Letter[]) {
  const now = new Date()
  return [
    { label: 'Today', value: countSince(letters, startOfDay(now)) },
    { label: 'This week', value: countSince(letters, startOfWeek(now)) },
    { label: 'This Month', value: countSince(letters, startOfMonth(now)) },
    { label: 'This Year', value: countSince(letters, startOfYear(now)) },
    { label: 'Overall', value: letters.length },
  ]
}

function resolveDepartment(name: string, users: AppUser[], letter: Letter, transition?: WorkflowTransition) {
  if (transition?.department?.trim()) return transition.department.trim()
  const user = users.find(
    (u) => u.name.trim().toLowerCase() === name.trim().toLowerCase() || u.username.toLowerCase() === name.trim().toLowerCase(),
  )
  if (user?.department?.trim()) return user.department.trim()
  return letter.department || ''
}

function parseTimestamp(value?: string | null): number | null {
  if (!value || value === '—') return null
  const direct = Date.parse(value)
  if (!Number.isNaN(direct)) return direct
  const m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) {
    const t = Date.parse(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T12:00:00`)
    return Number.isNaN(t) ? null : t
  }
  return null
}

/** Human-readable duration from hours. */
export function formatAvgResponse(hours: number | null | undefined) {
  if (hours == null || Number.isNaN(hours) || hours < 0) return '—'
  if (hours < 1) {
    const mins = Math.max(1, Math.round(hours * 60))
    return `${mins}m`
  }
  if (hours < 24) {
    const h = Math.floor(hours)
    const m = Math.round((hours - h) * 60)
    return m > 0 ? `${h}h ${m}m` : `${h}h`
  }
  const days = hours / 24
  if (days < 10) {
    const whole = Math.floor(days)
    const remH = Math.round((days - whole) * 24)
    return remH > 0 ? `${whole}d ${remH}h` : `${whole}d`
  }
  return `${Math.round(days)}d`
}

function samePerson(a: string | undefined | null, b: string | undefined | null) {
  return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase()
}

/**
 * Average response time (hours) = mean of each discrete response on each letter.
 * Never returns a summed/total lifetime — only the average of individual responses.
 */
function averageResponseHours(
  name: string,
  letters: Letter[],
  history: WorkflowTransition[],
  extraHours?: number | null,
  focusedLetterId?: string,
): number | null {
  const samples: number[] = []
  const MS_H = 1000 * 60 * 60

  // Each workflow handoff interval for this user on the focused letter = one response.
  const chronological = [...history].sort((a, b) => a.id - b.id)
  let historySamples = 0
  for (let i = 0; i < chronological.length; i += 1) {
    const item = chronological[i]
    const actor = item.assignedTo?.trim() || item.performedBy?.trim() || ''
    if (!samePerson(actor, name)) continue
    const end = parseTimestamp(item.createdAt)
    if (!end) continue
    const prev = chronological[i - 1]
    const start = prev ? parseTimestamp(prev.createdAt) : null
    if (start != null && end >= start) {
      samples.push((end - start) / MS_H)
      historySamples += 1
    }
  }

  // Live / estimated segment on the focused letter when history has no sample for them.
  if (historySamples === 0 && extraHours != null && !Number.isNaN(extraHours) && extraHours >= 0) {
    samples.push(extraHours)
  }

  // One response sample per other letter this user handled as assignee.
  for (const letter of letters) {
    if (focusedLetterId && letter.id === focusedLetterId) continue
    if (!samePerson(letter.assignedTo, name)) continue

    const start = parseTimestamp(letter.receivedDate) ?? parseTimestamp(letter.letterDate)
    const end = parseTimestamp(letter.completionDate)
    if (end && start != null && end >= start) {
      samples.push((end - start) / MS_H)
      continue
    }
    if (typeof letter.daysPending === 'number' && letter.daysPending >= 0) {
      samples.push(Math.max(letter.daysPending, 0) * 24)
    }
  }

  if (!samples.length) {
    if (extraHours != null && !Number.isNaN(extraHours) && extraHours >= 0) return extraHours
    return null
  }
  return samples.reduce((sum, n) => sum + n, 0) / samples.length
}

function buildPeoplePipeline(
  letter: Letter,
  history: WorkflowTransition[],
  users: AppUser[],
  allLetters: Letter[],
): { steps: AnimatedProgressStep[]; currentStep: number } {
  type Node = {
    name: string
    task: string
    department: string
    taskDetail: HandlerTaskDetail
    eventAtMs: number | null
  }
  const nodes: Node[] = []
  const MS_H = 1000 * 60 * 60
  const letterStart =
    parseTimestamp(letter.receivedDate) ?? parseTimestamp(letter.letterDate) ?? null

  const push = (name: string | undefined | null, task: string, transition?: WorkflowTransition) => {
    const trimmed = (name || '').trim()
    if (!trimmed) return
    const department = resolveDepartment(trimmed, users, letter, transition)
    const eventAtMs =
      parseTimestamp(transition?.createdAt) ??
      (task === 'Registered' ? letterStart : null)
    const detail: HandlerTaskDetail = {
      action: transition?.action || task.toLowerCase().replace(/\s+/g, '_'),
      actionLabel: task,
      fromStatus: transition?.fromStatus,
      toStatus: transition?.toStatus,
      remarks: transition?.remarks || letter.remarks || '',
      performedBy: transition?.performedBy || trimmed,
      assignedTo: transition?.assignedTo || '',
      department,
      createdAt: transition?.createdAt || '',
    }
    const existing = nodes.findIndex((n) => n.name === trimmed)
    if (existing >= 0) {
      nodes[existing] = {
        name: trimmed,
        task,
        department,
        taskDetail: detail,
        eventAtMs: eventAtMs ?? nodes[existing].eventAtMs,
      }
      return
    }
    nodes.push({ name: trimmed, task, department, taskDetail: detail, eventAtMs })
  }

  push(letter.createdBy, 'Registered')
  push(letter.assignedBy && letter.assignedBy !== letter.createdBy ? letter.assignedBy : '', 'Assigned')

  const chronological = [...history].sort((a, b) => a.id - b.id)
  for (const item of chronological) {
    const label = workflowActionLabel(item.action)
    if (item.assignedTo?.trim()) push(item.assignedTo, label, item)
    else if (item.performedBy?.trim()) push(item.performedBy, label, item)
  }

  push(letter.assignedTo, 'Working now')

  if (!nodes.length) {
    push(letter.assignedTo || letter.createdBy || 'Unassigned', letter.assignedTo ? 'Working now' : 'Unassigned')
  }

  // Fill missing timestamps so segment durations can still be estimated.
  let cursor = letterStart
  for (const node of nodes) {
    if (node.eventAtMs == null && cursor != null) {
      node.eventAtMs = cursor
    }
    if (node.eventAtMs != null) cursor = node.eventAtMs
  }

  const currentName = (letter.assignedTo || nodes[nodes.length - 1]?.name || '').trim()
  let currentStep = nodes.findIndex((n) => n.name === currentName)
  if (currentStep < 0) currentStep = Math.max(nodes.length - 1, 0)

  if (nodes[currentStep]) {
    nodes[currentStep] = {
      ...nodes[currentStep],
      task: currentName ? 'Working now' : nodes[currentStep].task,
      taskDetail: {
        ...nodes[currentStep].taskDetail,
        actionLabel: currentName ? 'Working now' : nodes[currentStep].taskDetail.actionLabel,
      },
      eventAtMs: nodes[currentStep].eventAtMs ?? letterStart ?? Date.now(),
    }
  }

  const steps: AnimatedProgressStep[] = nodes.map((node, index) => {
    const start = node.eventAtMs
    const next = nodes[index + 1]
    const end =
      next?.eventAtMs ??
      (index === currentStep ? Date.now() : null)
    let letterHours: number | null = null
    if (start != null && end != null && end >= start) {
      letterHours = (end - start) / MS_H
    } else if (index === currentStep && start != null) {
      letterHours = Math.max(0, (Date.now() - start) / MS_H)
    }

    const avgHours = averageResponseHours(node.name, allLetters, history, letterHours, letter.id)

    return {
      id: `${letter.id}-${node.name}-${index}`,
      title: node.name,
      department: node.department,
      task: node.task,
      taskDetail: node.taskDetail,
      avgResponseLabel: avgHours == null ? 'Avg —' : `Avg ${formatAvgResponse(avgHours)}`,
      avgResponseHours: avgHours,
      letterDurationLabel: letterHours == null ? undefined : formatAvgResponse(letterHours),
      letterDurationHours: letterHours,
      avatarUrl: resolveUserAvatarUrl(users, node.name),
      initials: personInitials(node.name),
    }
  })

  return { steps, currentStep }
}

export function MonitoringPage() {
  const go = useGo()
  const { letters, me, users, departments, refresh } = useAppData()
  const { query } = useCmsSearch()
  const [focusId, setFocusId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pendingDelete, setPendingDelete] = useState<Letter[] | null>(null)
  const [history, setHistory] = useState<WorkflowTransition[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const isAdmin = isAdministrator(me.role)

  const monitored = useMemo(() => {
    return letters.filter((l) => {
      if (l.isArchived) return false
      if (!isMonitored(l)) return false
      if (!query) return true
      return Object.values(l).some((v) => String(v).toLowerCase().includes(query.toLowerCase()))
    })
  }, [letters, query])

  useEffect(() => {
    if (!monitored.length) {
      setFocusId(null)
      return
    }
    if (!focusId || !monitored.some((l) => l.id === focusId)) {
      setFocusId(monitored[0].id)
    }
  }, [monitored, focusId])

  const focused = monitored.find((l) => l.id === focusId) ?? null

  useEffect(() => {
    if (!focused) {
      setHistory([])
      return
    }
    let cancelled = false
    setHistoryLoading(true)
    fetchWorkflowHistory(focused.id)
      .then((rows) => {
        if (!cancelled) setHistory(rows)
      })
      .catch(() => {
        if (!cancelled) setHistory([])
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [focused?.id])

  const { steps, currentStep } = useMemo(
    () => (focused ? buildPeoplePipeline(focused, history, users, letters) : { steps: [], currentStep: 0 }),
    [focused, history, users, letters],
  )

  const stats = useMemo(() => {
    const overdue = monitored.filter((l) => l.status === 'Overdue')
    const aging = monitored.filter((l) => l.daysPending >= 7)
    const urgent = monitored.filter((l) => l.priority === 'Urgent')
    const awaiting = monitored.filter((l) =>
      ['Awaiting Response', 'Approval Pending', 'Response Prepared'].includes(l.status),
    )
    const escalated = monitored.filter((l) => l.status === 'Escalated')
    const due = monitored.filter(dueSoon)
    const window = seriesWindow(monitored)
    const base = Math.max(monitored.length, 1)
    const share = (n: number) => (monitored.length === 0 ? 0 : (n / base) * 100)
    return {
      total: monitored.length,
      overdue: overdue.length,
      aging: aging.length,
      urgent: urgent.length,
      awaiting: awaiting.length,
      escalated: escalated.length,
      due: due.length,
      pct: {
        overdue: share(overdue.length),
        aging: share(aging.length),
        urgent: share(urgent.length),
        awaiting: share(awaiting.length),
        escalated: share(escalated.length),
        due: share(due.length),
      },
      periods: {
        current: periodBreakdown(monitored),
        overdue: periodBreakdown(overdue),
        aging: periodBreakdown(aging),
        urgent: periodBreakdown(urgent),
        awaiting: periodBreakdown(awaiting),
        escalated: periodBreakdown(escalated),
      },
      series: {
        total: dailyCounts(monitored, window),
        overdue: dailyCounts(overdue, window),
        aging: dailyCounts(aging, window),
        urgent: dailyCounts(urgent, window),
        awaiting: dailyCounts(awaiting, window),
        escalated: dailyCounts(escalated, window),
        due: dailyCounts(due, window),
      },
    }
  }, [monitored])

  return (
    <>
      <PageTitle
        title="Monitoring"
        description="Watch overdue, aging, and open correspondence that still needs action."
      />

      <MiniDashboard
        title="Monitoring snapshot"
        description="Open workload KPIs — minimize to a compact strip"
        className="fade-merge-down mb-0 rounded-b-none border-b-0 shadow-none"
        gridClassName="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7"
      >
        <Kpi
          label="Current"
          value={String(stats.total)}
          icon={<Inbox className="size-4" />}
          series={stats.series.total}
          seriesColor="#2563eb"
          periods={stats.periods.current}
        />
        <Kpi
          label="Overdue"
          value={String(stats.overdue)}
          percent={stats.pct.overdue}
          icon={<CircleAlert className="size-4" />}
          series={stats.series.overdue}
          seriesColor="#dc2626"
          periods={stats.periods.overdue}
        />
        <Kpi
          label="Aging (≥7d)"
          value={String(stats.aging)}
          percent={stats.pct.aging}
          icon={<Timer className="size-4" />}
          series={stats.series.aging}
          seriesColor="#d97706"
          periods={stats.periods.aging}
        />
        <Kpi
          label="Urgent"
          value={String(stats.urgent)}
          percent={stats.pct.urgent}
          icon={<Flame className="size-4" />}
          series={stats.series.urgent}
          seriesColor="#ea580c"
          periods={stats.periods.urgent}
        />
        <Kpi
          label="Awaiting response"
          value={String(stats.awaiting)}
          percent={stats.pct.awaiting}
          icon={<Clock3 className="size-4" />}
          series={stats.series.awaiting}
          seriesColor="#7c3aed"
          periods={stats.periods.awaiting}
        />
        <Kpi
          label="Escalated"
          value={String(stats.escalated)}
          percent={stats.pct.escalated}
          icon={<AlertTriangle className="size-4" />}
          series={stats.series.escalated}
          seriesColor="#b91c1c"
          periods={stats.periods.escalated}
        />
        <Kpi
          label="Due in 2 days"
          value={String(stats.due)}
          percent={stats.pct.due}
          icon={<CheckCircle2 className="size-4" />}
          series={stats.series.due}
          seriesColor="#059669"
        />
      </MiniDashboard>

      <div className="relative z-1 py-8 sm:py-10">
        {focused ? (
          historyLoading ? (
            <p className="py-6 text-center text-xs text-slate-400">Loading handlers…</p>
          ) : (
            <AnimatedProgressStepper steps={steps} currentStep={currentStep} />
          )
        ) : (
          <p className="py-6 text-center text-xs text-slate-400">
            No open correspondence to monitor right now.
          </p>
        )}
      </div>

      <LetterTable
        className="fade-merge-up rounded-t-none border-t-0 shadow-none"
        data={monitored}
        onOpen={(id) => go(id)}
        highlightId={focusId}
        onRowFocus={(id) => setFocusId(id)}
        selectable
        selectedIds={selected}
        onToggle={(id) => {
          setFocusId(id)
          setSelected((current) => {
            const next = new Set(current)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
          })
        }}
        onToggleAll={(checked) => setSelected(checked ? new Set(monitored.map((l) => l.id)) : new Set())}
        role={me.role}
        users={users}
        departments={departments}
        onChanged={refresh}
        onDelete={(letter) => setPendingDelete([letter])}
      />

      {pendingDelete && pendingDelete.length > 0 && isAdmin && (
        <LetterDeleteDialog
          letters={pendingDelete}
          onClose={() => setPendingDelete(null)}
          onDeleted={async () => {
            setPendingDelete(null)
            setSelected(new Set())
            await refresh()
          }}
        />
      )}
    </>
  )
}
