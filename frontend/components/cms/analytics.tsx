'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { BarChart3 } from 'lucide-react'
import { useAppData } from '@/components/app-provider'
import { NeedsActionWorkbench } from '@/components/cms/monitoring-page'
import {
  Badge,
  Card,
  EMPTY_ANALYTICS_FILTERS,
  Filters,
  Kpi,
  MiniDashboard,
  PageTitle,
  type AnalyticsFilterValues,
} from '@/components/cms/ui'
import { AppTab, AppTabList, AppTabPanel } from '@/components/ui/app-tabs'
import {
  statusTone,
  type Letter,
  type LetterStatus,
  type Priority,
} from '@/services/letters'

const CLOSED = new Set(['Closed', 'Completed', 'Archived', 'Information Delivered', 'Dispatched'])
const PENDING_ALIAS = 'Pending'

type AnalyticsView = 'overview' | 'needs-action'

function letterDay(letter: Letter): string {
  const raw = letter.receivedDate || letter.letterDate
  if (!raw || raw === '—') return ''
  const direct = Date.parse(raw)
  if (!Number.isNaN(direct)) return new Date(direct).toISOString().slice(0, 10)
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return ''
}

function matchesFilters(letter: Letter, f: AnalyticsFilterValues) {
  if (f.department !== 'All' && letter.department !== f.department) return false
  if (f.letterType !== 'All' && letter.type !== f.letterType) return false
  if (f.priority !== 'All' && letter.priority !== f.priority) return false
  if (f.status !== 'All') {
    if (f.status === PENDING_ALIAS) {
      if (CLOSED.has(letter.status)) return false
    } else if (letter.status !== f.status) {
      return false
    }
  }
  const day = letterDay(letter)
  if (f.dateFrom && day && day < f.dateFrom) return false
  if (f.dateTo && day && day > f.dateTo) return false
  if ((f.dateFrom || f.dateTo) && !day) return false
  return true
}

function monthKey(isoDay: string) {
  if (!isoDay) return ''
  const d = new Date(`${isoDay}T12:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en', { month: 'short' })
}

function computeFromLetters(letters: Letter[]) {
  const total = letters.length
  const incoming = letters.filter((l) => l.type === 'Incoming').length
  const outgoing = total - incoming
  const pending = letters.filter((l) => !CLOSED.has(l.status)).length
  const completed = letters.filter((l) => CLOSED.has(l.status)).length
  const overdue = letters.filter((l) => l.status === 'Overdue').length
  const closureRate = total ? `${Math.round((completed / total) * 100)}%` : '0%'
  const pendingDays = letters.filter((l) => !CLOSED.has(l.status)).map((l) => l.daysPending)
  const avgResponse = pendingDays.length
    ? `${Math.round((pendingDays.reduce((a, b) => a + b, 0) / pendingDays.length) * 10) / 10}d`
    : '0d'

  const monthOrder: string[] = []
  const trendMap = new Map<string, { incoming: number; outgoing: number }>()
  for (const letter of letters) {
    const key = monthKey(letterDay(letter))
    if (!key) continue
    if (!trendMap.has(key)) {
      trendMap.set(key, { incoming: 0, outgoing: 0 })
      monthOrder.push(key)
    }
    const row = trendMap.get(key)!
    if (letter.type === 'Incoming') row.incoming += 1
    else row.outgoing += 1
  }
  const trend = monthOrder.map((month) => ({ month, ...trendMap.get(month)! }))

  const statusMap = new Map<string, number>()
  for (const letter of letters) {
    statusMap.set(letter.status, (statusMap.get(letter.status) || 0) + 1)
  }
  const statusDistribution = [...statusMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({
      name,
      value,
      tone: statusTone(name as LetterStatus),
    }))

  const deptMap = new Map<string, { pending: number; completed: number }>()
  for (const letter of letters) {
    const name = letter.department || 'Unassigned'
    const row = deptMap.get(name) || { pending: 0, completed: 0 }
    if (CLOSED.has(letter.status)) row.completed += 1
    else row.pending += 1
    deptMap.set(name, row)
  }
  const departmentWorkload = [...deptMap.entries()]
    .map(([name, v]) => ({ name, ...v, total: v.pending + v.completed }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5)

  const priorities: Priority[] = ['Urgent', 'Important', 'Routine']
  const priorityCounts = priorities.map((label) => ({
    label,
    value: letters.filter((l) => l.priority === label).length,
    tone: label === 'Urgent' ? 'red' : label === 'Important' ? 'amber' : 'slate',
  }))
  const closed = letters.filter((l) => CLOSED.has(l.status))
  let onTime = 0
  let delayed = 0
  for (const item of closed) {
    if (!item.completionDate || item.completionDate === '—' || !item.dueDate || item.dueDate === '—') continue
    if (item.completionDate <= item.dueDate) onTime += 1
    else delayed += 1
  }
  const timingTotal = onTime + delayed
  const priorityPerformance = [
    ...priorityCounts,
    {
      label: 'On-time closure',
      value: timingTotal ? `${Math.round((onTime / timingTotal) * 100)}%` : '—',
      tone: 'green',
    },
    {
      label: 'Delayed closure',
      value: timingTotal ? `${Math.round((delayed / timingTotal) * 100)}%` : '—',
      tone: 'red',
    },
  ]

  return {
    kpis: {
      'Total Correspondence': String(total),
      Incoming: String(incoming),
      Outgoing: String(outgoing),
      Pending: String(pending),
      Completed: String(completed),
      Overdue: String(overdue),
      'Average Response Time': avgResponse,
      'Closure Rate': closureRate,
    },
    trend,
    statusDistribution,
    departmentWorkload,
    priorityPerformance,
  }
}

function filtersFromSearchParams(params: URLSearchParams): AnalyticsFilterValues {
  const status = params.get('status')
  return {
    ...EMPTY_ANALYTICS_FILTERS,
    dateFrom: params.get('from') || '',
    dateTo: params.get('to') || '',
    department: params.get('department') || 'All',
    letterType: params.get('type') || 'All',
    priority: params.get('priority') || 'All',
    status: status || 'All',
  }
}

export function Analytics() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { letters, departments } = useAppData()

  const view: AnalyticsView = searchParams.get('view') === 'needs-action' ? 'needs-action' : 'overview'

  const [draft, setDraft] = useState<AnalyticsFilterValues>(() => filtersFromSearchParams(searchParams))
  const [applied, setApplied] = useState<AnalyticsFilterValues>(() => filtersFromSearchParams(searchParams))

  useEffect(() => {
    const next = filtersFromSearchParams(searchParams)
    setDraft(next)
    setApplied(next)
  }, [searchParams])

  const filterOptions = useMemo(() => {
    const deptNames = [
      ...new Set([
        ...departments.map((d) => d.name).filter(Boolean),
        ...letters.map((l) => l.department).filter(Boolean),
      ]),
    ].sort()
    const statuses = [
      PENDING_ALIAS,
      ...[...new Set(letters.map((l) => l.status))].sort(),
    ]
    return {
      departments: deptNames,
      letterTypes: ['Incoming', 'Outgoing'],
      priorities: ['Urgent', 'Important', 'Routine'],
      statuses,
    }
  }, [departments, letters])

  const filtered = useMemo(
    () => letters.filter((l) => !l.isArchived && matchesFilters(l, applied)),
    [letters, applied],
  )

  const stats = useMemo(() => computeFromLetters(filtered), [filtered])
  const kpiEntries = Object.entries(stats.kpis) as [keyof typeof stats.kpis, string][]
  const maxTrend = Math.max(1, ...stats.trend.flatMap((m) => [m.incoming, m.outgoing]))

  const setView = (next: AnalyticsView) => {
    const params = new URLSearchParams(searchParams.toString())
    if (next === 'needs-action') params.set('view', 'needs-action')
    else params.delete('view')
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }

  const syncUrlFilters = (values: AnalyticsFilterValues) => {
    const params = new URLSearchParams()
    if (view === 'needs-action') params.set('view', 'needs-action')
    if (values.dateFrom) params.set('from', values.dateFrom)
    if (values.dateTo) params.set('to', values.dateTo)
    if (values.department !== 'All') params.set('department', values.department)
    if (values.letterType !== 'All') params.set('type', values.letterType)
    if (values.priority !== 'All') params.set('priority', values.priority)
    if (values.status !== 'All') params.set('status', values.status)
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <>
      <PageTitle
        title="Analytics"
        description="Explore correspondence with filters, or clear items that still need action."
      />

      <AppTabList groupId="analytics-tabs">
        <AppTab active={view === 'overview'} onClick={() => setView('overview')}>
          Overview
        </AppTab>
        <AppTab active={view === 'needs-action'} onClick={() => setView('needs-action')}>
          Needs action
        </AppTab>
      </AppTabList>

      <AppTabPanel tabKey={view}>
        {view === 'needs-action' ? (
          <NeedsActionWorkbench />
        ) : (
          <>
            <Filters
              values={draft}
              options={filterOptions}
              onChange={setDraft}
              onApply={() => {
                setApplied(draft)
                syncUrlFilters(draft)
              }}
              onClear={() => {
                setDraft(EMPTY_ANALYTICS_FILTERS)
                setApplied(EMPTY_ANALYTICS_FILTERS)
                syncUrlFilters(EMPTY_ANALYTICS_FILTERS)
              }}
            />

            <p className="mb-3 text-xs text-slate-400">
              Showing <span className="font-semibold text-slate-600">{filtered.length}</span> of {letters.filter((l) => !l.isArchived).length} active letters
            </p>

            <MiniDashboard
              title="Filtered overview"
              description="KPIs for the current query"
              className="mb-0"
              gridClassName="grid grid-cols-2 gap-3 md:grid-cols-4"
            >
              {kpiEntries.map(([label, value]) => (
                <Kpi key={label} label={label} value={value} icon={<BarChart3 className="size-4" />} />
              ))}
            </MiniDashboard>

            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <Card className="p-5">
                <h2 className="text-sm font-bold text-slate-700">Correspondence trend</h2>
                <p className="text-xs text-slate-400">Monthly incoming and outgoing volume</p>
                {stats.trend.length ? (
                  <div className="mt-5 flex h-48 items-end gap-3">
                    {stats.trend.map((m) => (
                      <div className="flex flex-1 flex-col items-center gap-2" key={m.month}>
                        <div className="flex h-40 w-full items-end justify-center gap-1">
                          <div
                            className="w-3 rounded-t bg-[#2d75b9]"
                            style={{ height: `${Math.min((m.incoming / maxTrend) * 160, 160)}px` }}
                          />
                          <div
                            className="w-3 rounded-t bg-[#8fb7d9]"
                            style={{ height: `${Math.min((m.outgoing / maxTrend) * 160, 160)}px` }}
                          />
                        </div>
                        <small className="text-[10px] text-slate-400">{m.month}</small>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-8 text-center text-xs text-slate-400">No dated correspondence in this filter.</p>
                )}
              </Card>

              <Card className="p-5">
                <h2 className="text-sm font-bold text-slate-700">Status distribution</h2>
                <p className="text-xs text-slate-400">Current filtered snapshot</p>
                <div className="mt-6 grid max-h-64 grid-cols-2 gap-3 overflow-y-auto">
                  {stats.statusDistribution.map((item) => (
                    <div className="flex items-center justify-between rounded bg-slate-50 p-3" key={item.name}>
                      <span className="text-xs text-slate-600">{item.name}</span>
                      <Badge tone={item.tone}>{item.value}</Badge>
                    </div>
                  ))}
                  {!stats.statusDistribution.length && (
                    <p className="col-span-2 text-center text-xs text-slate-400">No letters match.</p>
                  )}
                </div>
              </Card>

              <Card className="p-5">
                <h2 className="text-sm font-bold text-slate-700">Department workload</h2>
                <p className="text-xs text-slate-400">Pending vs completed letters</p>
                <div className="mt-5 flex flex-col gap-4">
                  {stats.departmentWorkload.map((d) => {
                    const share = Math.max(d.total, 1)
                    return (
                      <div key={d.name}>
                        <div className="mb-1 flex justify-between text-xs">
                          <span className="font-semibold text-slate-600">{d.name}</span>
                          <span className="text-slate-400">
                            {d.pending} pending · {d.completed} completed
                          </span>
                        </div>
                        <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
                          <div className="bg-amber-400" style={{ width: `${(d.pending / share) * 100}%` }} />
                          <div className="bg-[#2d75b9]" style={{ width: `${(d.completed / share) * 100}%` }} />
                        </div>
                      </div>
                    )
                  })}
                  {!stats.departmentWorkload.length && (
                    <p className="text-center text-xs text-slate-400">No department data for this filter.</p>
                  )}
                </div>
              </Card>

              <Card className="p-5">
                <h2 className="text-sm font-bold text-slate-700">Priority & response performance</h2>
                <p className="text-xs text-slate-400">Distribution and completion timing</p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {stats.priorityPerformance.map((item) => (
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3" key={item.label}>
                      <span className="text-xs text-slate-600">{item.label}</span>
                      <Badge tone={item.tone}>{item.value}</Badge>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </>
        )}
      </AppTabPanel>
    </>
  )
}
