'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  BarChart3,
  Bell,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  Download,
  FilePlus2,
  FileText,
  Inbox,
  LayoutDashboard,
  Lightbulb,
  LineChart,
  Menu,
  MoreHorizontal,
  Plus,
  Printer,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Table2,
  Tags,
  Users,
  X,
} from 'lucide-react'
import { AppDataProvider, metricValue, useAppData } from '@/components/app-provider'
import { AIAnalyzeDocument, AIIntelligencePanel } from '@/components/ai/letter-tools'
import { AIAssistant, AIManagementInsights, AISearchBanner, AIInsightsPage, LetterAnalysisPage } from '@/components/ai/pages'
import { Button } from '@/components/ui/button'
import { looksLikeNaturalQuery, naturalLanguageSearch, type InterpretedQuery } from '@/services/ai'
import { priorityTone, statusTone, type Letter, type LetterStatus } from '@/services/letters'

const toneClasses: Record<string, string> = {
  slate: 'bg-slate-100 text-slate-700',
  amber: 'bg-amber-100 text-amber-800',
  blue: 'bg-blue-100 text-blue-800',
  indigo: 'bg-indigo-100 text-indigo-800',
  violet: 'bg-violet-100 text-violet-800',
  green: 'bg-emerald-100 text-emerald-800',
  red: 'bg-red-100 text-red-800',
}

const groups = [
  { label: 'Workspace', items: [['Dashboard', LayoutDashboard], ['All Letters', Table2], ['Incoming', Inbox], ['Outgoing', ChevronRight], ['Pending', ClipboardList], ['Overdue', CircleAlert], ['Closed', CheckCircle2], ['Register Letter', FilePlus2], ['My Actions', CalendarClock], ['Monitoring', SlidersHorizontal]] as const },
  { label: 'AI Intelligence', items: [['AI Assistant', Sparkles], ['Letter Analysis', LineChart], ['AI Insights', Lightbulb]] as const },
  { label: 'Management', items: [['Analytics', BarChart3], ['Reports', FileText]] as const },
  { label: 'Administration', items: [['Departments', Building2], ['Organizations', Building2], ['Users & Roles', Users], ['Master Data', Tags], ['Audit Log', ShieldCheck]] as const },
  { label: 'System', items: [['Notifications', Bell], ['Settings', Settings2]] as const },
]

function Badge({ children, tone = 'slate' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`inline-flex items-center rounded-md px-2 py-1 text-[11px] font-semibold ${toneClasses[tone] ?? toneClasses.slate}`}>{children}</span>
}

function Logo() {
  return (
    <div className="flex size-9 items-center justify-center rounded-lg bg-[#0d3763] text-white shadow-sm">
      <BriefcaseBusiness className="size-5" />
    </div>
  )
}

function PageTitle({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs text-slate-400">
          <span>Workspace</span>
          <ChevronRight className="size-3" />
          <span className="text-slate-600">{title}</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[#102a43]">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      {action}
    </div>
  )
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>{children}</section>
}

function Sidebar({ page, setPage, mobile, setMobile }: { page: string; setPage: (p: string) => void; mobile: boolean; setMobile: (v: boolean) => void }) {
  const { unreadCount } = useAppData()
  return (
    <aside className={`${mobile ? 'fixed inset-y-0 left-0 z-20 flex w-72' : 'hidden lg:flex lg:w-64'} flex-col border-r border-slate-200 bg-white`}>
      <div className="flex h-[72px] items-center gap-3 border-b border-slate-200 px-5">
        <Logo />
        <div>
          <p className="text-sm font-bold text-[#102a43]">Correspondence</p>
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400">Management System</p>
        </div>
        {mobile && (
          <button className="ml-auto" onClick={() => setMobile(false)}>
            <X className="size-5" />
          </button>
        )}
      </div>
      <nav className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
        {groups.map((group) => (
          <div key={group.label}>
            <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{group.label}</p>
            <div className="flex flex-col gap-1">
              {group.items.map(([label, Icon]) => (
                <button
                  key={label}
                  onClick={() => {
                    setPage(label)
                    setMobile(false)
                  }}
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${page === label ? 'bg-blue-50 font-semibold text-[#0d3763]' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  <Icon className="size-4" />
                  <span>{label}</span>
                  {label === 'Notifications' && unreadCount > 0 && <span className="ml-auto rounded-full bg-red-100 px-1.5 text-[10px] font-bold text-red-600">{unreadCount}</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  )
}

function Header({ setMobile, query, setQuery, go }: { setMobile: (v: boolean) => void; query: string; setQuery: (v: string) => void; go: (p: string) => void }) {
  const { me, unreadCount } = useAppData()
  return (
    <header className="flex min-h-[72px] items-center gap-3 border-b border-slate-200 bg-white px-4 sm:px-7">
      <button className="lg:hidden" onClick={() => setMobile(true)}>
        <Menu className="size-5 text-slate-600" />
      </button>
      <div className="hidden min-w-0 flex-1 md:block">
        <p className="text-xs text-slate-400">Wednesday, September 13, 2026</p>
        <p className="truncate text-sm font-semibold text-slate-700">Correspondence workspace</p>
      </div>
      <div className="relative flex-1 md:max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search or ask: Show overdue letters from SUPARCO" className="h-10 w-full rounded-md border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs outline-none ring-blue-500 focus:ring-2" />
      </div>
      <button className="rounded-md p-2 text-slate-500 hover:bg-slate-50" onClick={() => go('AI Assistant')} title="AI Assistant"><Sparkles className="size-5" /></button>
      <button className="relative rounded-md p-2 text-slate-500 hover:bg-slate-50" onClick={() => go('Notifications')}>
        <Bell className="size-5" />
        {unreadCount > 0 && <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-red-500" />}
      </button>
      <button className="hidden items-center gap-2 border-l border-slate-200 pl-4 sm:flex">
        <span className="flex size-8 items-center justify-center rounded-full bg-[#dce9f7] text-xs font-bold text-[#0d3763]">{me.initials}</span>
        <span className="text-left">
          <span className="block text-xs font-semibold text-slate-700">{me.name}</span>
          <span className="block text-[10px] text-slate-400">{me.role}</span>
        </span>
      </button>
    </header>
  )
}

function Kpi({ label, icon, onClick, value }: { label: string; icon: React.ReactNode; onClick?: () => void; value: string }) {
  return (
    <button onClick={onClick} className="group rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <span className="flex size-8 items-center justify-center rounded-md bg-blue-50 text-[#1769aa]">{icon}</span>
      </div>
      <p className="text-2xl font-bold text-[#102a43]">{value}</p>
      <p className="mt-1 text-[11px] font-medium text-emerald-600">
        Live data <span className="font-normal text-slate-400">from PostgreSQL</span>
      </p>
    </button>
  )
}

function LetterTable({ data, onOpen }: { data: Letter[]; onOpen: (id: string) => void }) {
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-bold text-slate-700">Correspondence register</h2>
          <p className="text-xs text-slate-400">{data.length} records shown</p>
        </div>
        <Button variant="outline" size="sm">
          <SlidersHorizontal data-icon="inline-start" />
          Columns
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[850px] text-left">
          <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-400">
            <tr>{['Letter no.', 'Subject / source', 'Department', 'Priority', 'Status', 'Due date', 'Assigned to', ''].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}</tr>
          </thead>
          <tbody>
            {data.map((l) => (
              <tr key={l.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <button onClick={() => onOpen(l.id)} className="text-left text-xs font-bold text-[#1769aa] hover:underline">{l.number}</button>
                  <p className="mt-1 text-[11px] text-slate-400">{l.letterDate}</p>
                </td>
                <td className="max-w-[250px] px-4 py-3">
                  <button onClick={() => onOpen(l.id)} className="line-clamp-2 text-left text-xs font-semibold text-slate-700">{l.subject}</button>
                  <p className="mt-1 text-[11px] text-slate-400">{l.from}</p>
                </td>
                <td className="px-4 py-3 text-xs text-slate-600">{l.department}</td>
                <td className="px-4 py-3"><Badge tone={priorityTone(l.priority)}>{l.priority}</Badge></td>
                <td className="px-4 py-3"><Badge tone={statusTone(l.status)}>{l.status}</Badge></td>
                <td className="px-4 py-3 text-xs text-slate-600">{l.dueDate}</td>
                <td className="px-4 py-3 text-xs text-slate-600">{l.assignedTo}</td>
                <td className="px-4 py-3"><MoreHorizontal className="size-4 text-slate-400" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-400">
        <span>Showing {data.length} letters</span>
      </div>
    </Card>
  )
}

function Dashboard({ go }: { go: (p: string) => void }) {
  const { dashboardMetrics, metrics, trend, alerts, departmentPerformance, auditRecords } = useAppData()
  return (
    <>
      <PageTitle title="Dashboard" description="Overview of correspondence activity and action performance." action={<div className="flex gap-2"><Button variant="outline" onClick={() => go('AI Assistant')}><Sparkles data-icon="inline-start" />AI Assistant</Button><Button onClick={() => go('Register Letter')}><Plus data-icon="inline-start" />Register letter</Button></div>} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-7">
        {dashboardMetrics.map((m) => (
          <Kpi key={m.label} label={m.label === 'Total Letters' ? 'Total Correspondence' : m.label} value={metricValue(metrics, m.label === 'Total Letters' ? 'Total Correspondence' : m.label)} icon={<Inbox className="size-4" />} onClick={() => go(m.filter)} />
        ))}
      </div>
      <div className="mt-6 grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Card className="p-5">
          <div>
            <h2 className="text-sm font-bold text-slate-700">Letters by month</h2>
            <p className="text-xs text-slate-400">Registered correspondence volume</p>
          </div>
          <div className="mt-6 flex h-44 items-end gap-3 sm:gap-5">
            {trend.map((m) => (
              <div key={m.month} className="flex flex-1 flex-col items-center gap-2">
                <div className="flex h-36 w-full max-w-10 items-end gap-1">
                  <div className="w-1/2 rounded-t bg-[#2d75b9]" style={{ height: `${Math.min(m.incoming * 2, 144)}px` }} />
                  <div className="w-1/2 rounded-t bg-[#8fb7d9]" style={{ height: `${Math.min(m.outgoing * 2, 144)}px` }} />
                </div>
                <span className="text-[10px] text-slate-400">{m.month}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="text-sm font-bold text-slate-700">Management alerts</h2>
          <p className="text-xs text-slate-400">Items requiring attention</p>
          <div className="mt-4 flex flex-col gap-3">
            {alerts.map((alert) => (
              <button key={alert.title} onClick={() => go('Monitoring')} className="flex items-center gap-3 rounded-md bg-slate-50 p-3 text-left hover:bg-blue-50">
                <CircleAlert className={`size-4 ${alert.tone === 'red' ? 'text-red-500' : 'text-amber-500'}`} />
                <span className="flex-1 text-xs font-semibold text-slate-700">{alert.title}</span>
                <b className="text-sm text-[#102a43]">{alert.count}</b>
                <ChevronRight className="size-4 text-slate-400" />
              </button>
            ))}
          </div>
        </Card>
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <div className="border-b border-slate-100 p-5">
            <h2 className="text-sm font-bold text-slate-700">Department performance</h2>
            <p className="text-xs text-slate-400">Current workload snapshot</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left">
              <thead className="bg-slate-50 text-[10px] uppercase text-slate-400">
                <tr>{['Department', 'Assigned', 'Pending', 'Completed', 'Overdue'].map((h) => <th className="px-5 py-3" key={h}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {departmentPerformance.slice(0, 4).map((d) => (
                  <tr className="border-t border-slate-100 text-xs" key={d.name}>
                    <td className="px-5 py-3 font-semibold text-slate-700">{d.name}</td>
                    <td className="px-5 py-3 text-slate-600">{d.assigned}</td>
                    <td className="px-5 py-3 text-amber-700">{d.pending}</td>
                    <td className="px-5 py-3 text-emerald-700">{d.completed}</td>
                    <td className="px-5 py-3 text-red-600">{d.overdue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card>
          <div className="border-b border-slate-100 p-5">
            <h2 className="text-sm font-bold text-slate-700">Recent management activity</h2>
            <p className="text-xs text-slate-400">Latest audit records</p>
          </div>
          {auditRecords.slice(0, 4).map((a) => (
            <div className="flex gap-3 border-b border-slate-100 p-4" key={`${a.date}-${a.record}`}>
              <Activity className="mt-0.5 size-4 text-[#1769aa]" />
              <div>
                <p className="text-xs font-semibold text-slate-700">{a.action}</p>
                <p className="text-[11px] text-slate-400">{a.description}</p>
              </div>
            </div>
          ))}
        </Card>
      </div>
      <AIManagementInsights go={go} />
    </>
  )
}

function Filters() {
  return (
    <div className="mb-5 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-4">
      <label className="flex flex-col gap-1 text-[10px] font-bold uppercase text-slate-400">Date from<input type="date" className="h-9 rounded border border-slate-200 px-2 text-xs font-normal text-slate-600" /></label>
      <label className="flex flex-col gap-1 text-[10px] font-bold uppercase text-slate-400">Date to<input type="date" className="h-9 rounded border border-slate-200 px-2 text-xs font-normal text-slate-600" /></label>
      {['Department', 'Letter type', 'Priority', 'Status'].map((f) => (
        <label className="flex flex-col gap-1 text-[10px] font-bold uppercase text-slate-400" key={f}>
          {f}
          <select className="h-9 min-w-28 rounded border border-slate-200 bg-white px-2 text-xs font-normal text-slate-600"><option>All</option></select>
        </label>
      ))}
      <Button size="sm">Apply Filters</Button>
      <Button size="sm" variant="ghost">Clear</Button>
    </div>
  )
}

function Analytics() {
  const { metrics, trend, statusDistribution, departmentPerformance, priorityPerformance } = useAppData()
  const labels = ['Total Correspondence', 'Incoming', 'Outgoing', 'Pending', 'Completed', 'Overdue', 'Average Response Time', 'Closure Rate']
  return (
    <>
      <PageTitle title="Analytics" description="Interactive management analytics across the correspondence register." />
      <Filters />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {labels.map((x) => <Kpi key={x} label={x} value={metricValue(metrics, x)} icon={<BarChart3 className="size-4" />} />)}
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-sm font-bold text-slate-700">Correspondence trend</h2>
          <p className="text-xs text-slate-400">Monthly incoming and outgoing volume</p>
          <div className="mt-5 flex h-48 items-end gap-3">
            {trend.map((m) => (
              <div className="flex flex-1 flex-col items-center gap-2" key={m.month}>
                <div className="flex h-40 w-full items-end justify-center gap-1">
                  <div className="w-3 rounded-t bg-[#2d75b9]" style={{ height: `${Math.min(m.incoming * 2.3, 160)}px` }} />
                  <div className="w-3 rounded-t bg-[#8fb7d9]" style={{ height: `${Math.min(m.outgoing * 2.3, 160)}px` }} />
                </div>
                <small className="text-[10px] text-slate-400">{m.month}</small>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="text-sm font-bold text-slate-700">Status distribution</h2>
          <p className="text-xs text-slate-400">Current register snapshot</p>
          <div className="mt-6 grid grid-cols-2 gap-3">
            {statusDistribution.map((item) => (
              <div className="flex items-center justify-between rounded bg-slate-50 p-3" key={item.name}>
                <span className="text-xs text-slate-600">{item.name}</span>
                <Badge tone={item.tone}>{item.value}</Badge>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="text-sm font-bold text-slate-700">Department workload</h2>
          <p className="text-xs text-slate-400">Pending vs completed letters</p>
          <div className="mt-5 flex flex-col gap-4">
            {departmentPerformance.slice(0, 5).map((d) => (
              <div key={d.name}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="font-semibold text-slate-600">{d.name}</span>
                  <span className="text-slate-400">{d.pending} pending · {d.completed} completed</span>
                </div>
                <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="bg-amber-400" style={{ width: `${Math.min(d.pending * 12, 50)}%` }} />
                  <div className="bg-[#2d75b9]" style={{ width: `${Math.min(d.completed * 12, 50)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="text-sm font-bold text-slate-700">Priority & response performance</h2>
          <p className="text-xs text-slate-400">Distribution and completion timing</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {priorityPerformance.map((item) => (
              <div className="flex items-center justify-between border-b border-slate-100 pb-3" key={item.label}>
                <span className="text-xs text-slate-600">{item.label}</span>
                <Badge tone={item.tone}>{item.value}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  )
}

function Reports() {
  const { letters } = useAppData()
  const [report, setReport] = useState('Incoming Letters Report')
  const rows = useMemo(() => {
    if (report === 'Outgoing Letters Report') return letters.filter((r) => r.type === 'Outgoing')
    if (report === 'Pending Letters Report') return letters.filter((r) => !['Closed', 'Completed'].includes(r.status))
    if (report === 'Overdue Letters Report') return letters.filter((r) => r.status === 'Overdue')
    if (report === 'Closed Letters Report') return letters.filter((r) => r.status === 'Closed')
    if (report === 'Incoming Letters Report') return letters.filter((r) => r.type === 'Incoming')
    return letters
  }, [letters, report])

  const exportCsv = () => {
    const header = ['Letter No.', 'Date', 'Subject', 'Department', 'Assigned To', 'Status', 'Priority', 'Due Date', 'Completion Date']
    const lines = rows.map((r) => [r.number, r.letterDate, r.subject, r.department, r.assignedTo, r.status, r.priority, r.dueDate, r.completionDate ?? '—'].map((v) => `"${String(v).replaceAll('"', '""')}"`).join(','))
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${report.replaceAll(' ', '-').toLowerCase()}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <PageTitle title="Reports" description="Generate operational reports from the correspondence register." />
      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-bold text-slate-700">Predefined reports</h2>
          <div className="flex flex-col gap-1">
            {['Incoming Letters Report', 'Outgoing Letters Report', 'Pending Letters Report', 'Overdue Letters Report', 'Closed Letters Report', 'Department Workload Report', 'Response Performance Report'].map((r) => (
              <button key={r} onClick={() => setReport(r)} className={`rounded-md px-3 py-2 text-left text-xs ${report === r ? 'bg-blue-50 font-semibold text-[#1769aa]' : 'text-slate-600 hover:bg-slate-50'}`}>{r}</button>
            ))}
          </div>
        </Card>
        <div>
          <Filters />
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
              <div>
                <h2 className="text-sm font-bold text-slate-700">{report}</h2>
                <p className="text-xs text-slate-400">{rows.length} records ready</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => window.print()}><Printer data-icon="inline-start" />Print</Button>
                <Button size="sm" variant="outline" onClick={exportCsv}><Download data-icon="inline-start" />Export CSV</Button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left">
                <thead className="bg-slate-50 text-[10px] uppercase text-slate-400">
                  <tr>{['Letter No.', 'Date', 'Subject', 'Department', 'Assigned To', 'Status', 'Priority', 'Due Date', 'Completion Date'].map((h) => <th className="px-3 py-3" key={h}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr className="border-t border-slate-100 text-xs" key={r.id}>
                      <td className="px-3 py-3 font-semibold text-[#1769aa]">{r.number}</td>
                      <td className="px-3 py-3">{r.letterDate}</td>
                      <td className="max-w-[190px] truncate px-3 py-3 text-slate-700">{r.subject}</td>
                      <td className="px-3 py-3">{r.department}</td>
                      <td className="px-3 py-3">{r.assignedTo}</td>
                      <td className="px-3 py-3"><Badge tone={statusTone(r.status)}>{r.status}</Badge></td>
                      <td className="px-3 py-3"><Badge tone={priorityTone(r.priority)}>{r.priority}</Badge></td>
                      <td className="px-3 py-3">{r.dueDate}</td>
                      <td className="px-3 py-3">{r.completionDate ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}

function FormDialog({ title, fields, onClose, onSubmit }: { title: string; fields: { name: string; label: string; required?: boolean }[]; onClose: () => void; onSubmit: (values: Record<string, string>) => Promise<void> }) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/30 p-4">
      <Card className="w-full max-w-lg p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-700">{title}</h2>
          <button onClick={onClose}><X className="size-4 text-slate-400" /></button>
        </div>
        <div className="grid gap-3">
          {fields.map((field) => (
            <label key={field.name} className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-slate-600">{field.label}</span>
              <input className="h-10 rounded-md border border-slate-200 px-3 text-xs" value={values[field.name] ?? ''} onChange={(e) => setValues((current) => ({ ...current, [field.name]: e.target.value }))} />
            </label>
          ))}
        </div>
        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={async () => {
            setBusy(true)
            setError('')
            try {
              await onSubmit(values)
              onClose()
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Unable to save')
            } finally {
              setBusy(false)
            }
          }}>Save</Button>
        </div>
      </Card>
    </div>
  )
}

function ManagementTable({ title, description, headers, rows, onAdd, addTitle, addFields }: { title: string; description: string; headers: string[]; rows: Record<string, string | number>[]; onAdd?: (values: Record<string, string>) => Promise<void>; addTitle?: string; addFields?: { name: string; label: string }[] }) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const filtered = rows.filter((r) => Object.values(r).some((v) => String(v).toLowerCase().includes(search.toLowerCase())))
  return (
    <>
      <PageTitle title={title} description={description} action={onAdd && <Button onClick={() => setOpen(true)}><Plus data-icon="inline-start" />Add {title.slice(0, -1).toLowerCase()}</Button>} />
      <div className="mb-4 flex gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${title.toLowerCase()}...`} className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-xs" />
        </div>
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-400">
              <tr>{headers.map((h) => <th className="px-4 py-3" key={h}>{h}</th>)}<th className="px-4 py-3">Actions</th></tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr className="border-t border-slate-100 text-xs" key={i}>
                  {Object.values(r).map((v, j) => (
                    <td className="px-4 py-3 text-slate-600" key={j}>{j === Object.values(r).length - 1 && ['Active', 'Inactive'].includes(String(v)) ? <Badge tone={v === 'Active' ? 'green' : 'slate'}>{String(v)}</Badge> : String(v)}</td>
                  ))}
                  <td className="px-4 py-3"><button className="rounded p-1 text-slate-400 hover:bg-slate-100"><MoreHorizontal className="size-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {open && onAdd && addFields && <FormDialog title={addTitle ?? `Add ${title}`} fields={addFields} onClose={() => setOpen(false)} onSubmit={onAdd} />}
    </>
  )
}

function Notifications({ go }: { go: (p: string) => void }) {
  const { notifications, readNotification, readAllNotifications } = useAppData()
  const [view, setView] = useState<'all' | 'unread'>('all')
  const visible = notifications.filter((n) => view === 'all' || !n.read)
  return (
    <>
      <PageTitle title="Notifications" description="Stay informed about assignments, deadlines and correspondence updates." action={<Button variant="outline" onClick={() => readAllNotifications()}><Check data-icon="inline-start" />Mark all as read</Button>} />
      <div className="mb-4 flex gap-2">
        <Button size="sm" variant={view === 'all' ? 'default' : 'outline'} onClick={() => setView('all')}>All notifications</Button>
        <Button size="sm" variant={view === 'unread' ? 'default' : 'outline'} onClick={() => setView('unread')}>Unread only</Button>
      </div>
      <Card>
        {visible.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">You&apos;re all caught up.</div> : visible.map((n) => (
          <div className={`flex gap-4 border-b border-slate-100 p-5 last:border-0 ${!n.read ? 'bg-blue-50/40' : ''}`} key={n.id}>
            <div className={`mt-1 flex size-8 shrink-0 items-center justify-center rounded-full ${n.priority === 'Critical' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-[#1769aa]'}`}><Bell className="size-4" /></div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-bold text-slate-700">{n.title}</h2>
                <Badge tone={n.priority === 'Critical' ? 'red' : n.priority === 'High' ? 'amber' : 'slate'}>{n.priority}</Badge>
                {!n.read && <Badge tone="blue">Unread</Badge>}
              </div>
              <p className="mt-1 text-xs text-slate-500">{n.description}</p>
              <p className="mt-2 text-[11px] text-slate-400">{n.time}</p>
            </div>
            <div className="flex gap-2">
              {n.letter && <Button size="sm" variant="outline" onClick={() => go(n.letter)}>Open letter</Button>}
              {!n.read && <Button size="sm" variant="ghost" onClick={() => readNotification(n.id)}>Mark read</Button>}
            </div>
          </div>
        ))}
      </Card>
    </>
  )
}

function Audit() {
  const { auditRecords, aiAudit } = useAppData()
  const rows = [...aiAudit.map((item) => ({ date: item.date, user: item.user, module: item.module, action: item.action, record: item.record, description: item.description, source: item.source })), ...auditRecords]
  return (
    <>
      <PageTitle title="Audit Log" description="Read-only record of system activity and administrative changes." />
      <Filters />
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-400">
              <tr>{['Date / Time', 'User', 'Module', 'Action', 'Record', 'Description', 'IP / Source'].map((h) => <th className="px-4 py-3" key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((a, index) => (
                <tr className="border-t border-slate-100 text-xs" key={`${a.date}-${a.record}-${a.action}-${index}`}>
                  <td className="px-4 py-3 text-slate-500">{a.date}</td>
                  <td className="px-4 py-3 font-semibold">{a.user}</td>
                  <td className="px-4 py-3"><Badge tone={a.module === 'AI Intelligence' ? 'violet' : 'blue'}>{a.module}</Badge></td>
                  <td className="px-4 py-3">{a.action}</td>
                  <td className="px-4 py-3 text-[#1769aa]">{a.record}</td>
                  <td className="px-4 py-3 text-slate-600">{a.description}</td>
                  <td className="px-4 py-3 text-slate-400">{a.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

function MasterData() {
  const { masterData, addMasterValue } = useAppData()
  const tabs = Object.keys(masterData)
  const [tab, setTab] = useState(tabs[0] ?? 'Letter Types')
  const [open, setOpen] = useState(false)
  const current = masterData[tab] ?? []
  return (
    <>
      <PageTitle title="Master Data" description="Manage reusable reference values used across the system." action={<Button onClick={() => setOpen(true)}><Plus data-icon="inline-start" />Add value</Button>} />
      <Card>
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200 p-3">
          {tabs.map((t) => (
            <button onClick={() => setTab(t)} className={`whitespace-nowrap rounded-md px-3 py-2 text-xs ${tab === t ? 'bg-blue-50 font-semibold text-[#1769aa]' : 'text-slate-500 hover:bg-slate-50'}`} key={t}>{t}</button>
          ))}
        </div>
        <div className="p-4">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-400">
              <tr><th className="px-4 py-3">Value</th><th className="px-4 py-3">Status</th></tr>
            </thead>
            <tbody>
              {current.map((v) => (
                <tr className="border-t border-slate-100 text-xs" key={v}>
                  <td className="px-4 py-3 font-semibold text-slate-700">{v}</td>
                  <td className="px-4 py-3"><Badge tone="green">Active</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {open && <FormDialog title={`Add ${tab} value`} fields={[{ name: 'value', label: 'Value' }]} onClose={() => setOpen(false)} onSubmit={(values) => addMasterValue(tab, values.value)} />}
    </>
  )
}

function Details({ id, go }: { id: string; go: (p: string) => void }) {
  const { letters, addAction, applyLetterField, acceptAiAction } = useAppData()
  const [action, setAction] = useState('')
  const letter = letters.find((item) => item.id === id)
  if (!letter) return <p className="text-sm text-slate-500">Letter not found.</p>
  return (
    <>
      <button onClick={() => go('All Letters')} className="mb-4 text-xs font-semibold text-[#1769aa]">← Back to letter database</button>
      <PageTitle title={letter.subject} description={`${letter.number} · ${letter.type} correspondence`} action={<div className="flex gap-2"><Button variant="outline" onClick={() => go('AI Assistant')}><Sparkles data-icon="inline-start" />AI Assistant</Button><Button variant="outline" onClick={() => go(`analysis:${letter.id}`)}>Letter Analysis</Button></div>} />
      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-bold text-slate-700">Correspondence details</h2>
          <div className="grid grid-cols-2 gap-5">
            {[['Letter number', letter.number], ['Letter date', letter.letterDate], ['Received date', letter.receivedDate], ['Type', letter.type], ['From', letter.from], ['To', letter.to], ['Department', letter.department], ['Assigned to', letter.assignedTo], ['Due date', letter.dueDate], ['Last action', letter.lastAction]].map(([a, b]) => (
              <div key={a}>
                <p className="text-[11px] text-slate-400">{a}</p>
                <p className="mt-1 text-xs font-semibold text-slate-700">{b}</p>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-bold text-slate-700">Tracking status</h2>
          <div className="flex flex-wrap gap-2">
            <Badge tone={letter.type === 'Incoming' ? 'blue' : 'violet'}>{letter.type}</Badge>
            <Badge tone={priorityTone(letter.priority)}>{letter.priority}</Badge>
            <Badge tone={statusTone(letter.status)}>{letter.status}</Badge>
          </div>
          <div className="mt-6 flex flex-col gap-3">
            <input value={action} onChange={(e) => setAction(e.target.value)} placeholder="Describe the next action" className="h-10 rounded-md border border-slate-200 px-3 text-xs" />
            <Button onClick={async () => { if (!action.trim()) return; await addAction(letter.id, action.trim()); setAction('') }}>Add action</Button>
          </div>
        </Card>
      </div>
      <div className="mt-5">
        <AIIntelligencePanel letter={letter} letters={letters} onApplyField={(field, value, decision) => applyLetterField(letter.id, field, value, decision)} onAcceptAction={(next, decision) => acceptAiAction(letter.id, next, decision)} />
        <div className="mt-5"><AIAnalyzeDocument letter={letter} /></div>
      </div>
    </>
  )
}

function Database({ page, query, go, aiSearch, onClearAi }: { page: string; query: string; go: (p: string) => void; aiSearch: InterpretedQuery | null; onClearAi: () => void }) {
  const { letters, me } = useAppData()
  const [filter, setFilter] = useState('All')
  const source = aiSearch ? aiSearch.letters : letters
  const data = source.filter((l) => {
    const q = aiSearch || !query || Object.values(l).some((v) => String(v).toLowerCase().includes(query.toLowerCase()))
    const matchesPage =
      page === 'All Letters' ||
      (page === 'Incoming' && l.type === 'Incoming') ||
      (page === 'Outgoing' && l.type === 'Outgoing') ||
      (page === 'Overdue' && l.status === 'Overdue') ||
      (page === 'Closed' && l.status === 'Closed') ||
      (page === 'Pending' && !['Closed', 'Completed'].includes(l.status)) ||
      (page === 'My Actions' && l.assignedTo === me.name) ||
      (page === 'Monitoring' && (l.status === 'Overdue' || l.daysPending >= 7 || !['Closed', 'Completed'].includes(l.status)))
    return q && matchesPage && (filter === 'All' || l.priority === filter)
  })
  const title = page === 'All Letters' ? 'Letter database' : page
  return (
    <>
      <PageTitle title={title} description="Search, filter and manage all registered correspondence." action={<Button onClick={() => go('Register Letter')}><Plus data-icon="inline-start" />Register letter</Button>} />
      <AISearchBanner result={aiSearch} onClear={onClearAi} go={go} />
      <div className="mb-4 flex flex-wrap gap-2">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-xs">
          <option>All</option><option>Routine</option><option>Important</option><option>Urgent</option>
        </select>
        <Button variant="ghost" size="sm" onClick={() => setFilter('All')}>Clear</Button>
      </div>
      <LetterTable data={data} onOpen={(id) => go(id)} />
    </>
  )
}

function Register({ go }: { go: (p: string) => void }) {
  const { registerLetter, departments, organizations, users, masterData } = useAppData()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    number: '',
    letterDate: '',
    receivedDate: '',
    type: 'Incoming',
    subject: '',
    priority: 'Routine',
    confidentiality: 'Normal',
    from: '',
    to: '',
    department: '',
    assignedTo: '',
    dueDate: '',
    actionRequired: '',
    remarks: '',
    status: 'Registered',
  })
  const set = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }))
  const submit = async (status: LetterStatus) => {
    setError('')
    if (!form.number || !form.letterDate || !form.subject) {
      setError('Letter number, letter date and subject are required.')
      return
    }
    try {
      await registerLetter({ ...form, type: form.type as Letter['type'], priority: form.priority as Letter['priority'], status, lastAction: status === 'Registered' ? 'Registered' : 'Saved as draft' })
      setSaved(true)
      setTimeout(() => go('All Letters'), 400)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to register letter')
    }
  }
  return (
    <>
      <PageTitle title="Register letter" description="Capture correspondence details and assign the next action." action={<Button variant="outline" onClick={() => go('All Letters')}>Cancel</Button>} />
      <Card className="max-w-4xl">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-bold text-slate-700">Basic information</h2>
          <p className="text-xs text-slate-400">Fields marked with * are required.</p>
        </div>
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5"><span className="text-xs font-semibold text-slate-600">Letter number *</span><input value={form.number} onChange={(e) => set('number', e.target.value)} className="h-10 rounded-md border border-slate-200 px-3 text-xs" /></label>
          <label className="flex flex-col gap-1.5"><span className="text-xs font-semibold text-slate-600">Letter date *</span><input type="date" value={form.letterDate} onChange={(e) => set('letterDate', e.target.value)} className="h-10 rounded-md border border-slate-200 px-3 text-xs" /></label>
          <label className="flex flex-col gap-1.5"><span className="text-xs font-semibold text-slate-600">Received date *</span><input type="date" value={form.receivedDate} onChange={(e) => set('receivedDate', e.target.value)} className="h-10 rounded-md border border-slate-200 px-3 text-xs" /></label>
          <label className="flex flex-col gap-1.5"><span className="text-xs font-semibold text-slate-600">Letter type *</span><select value={form.type} onChange={(e) => set('type', e.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-xs">{(masterData['Letter Types'] ?? ['Incoming', 'Outgoing']).map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="flex flex-col gap-1.5 sm:col-span-2"><span className="text-xs font-semibold text-slate-600">Subject *</span><input value={form.subject} onChange={(e) => set('subject', e.target.value)} className="h-10 rounded-md border border-slate-200 px-3 text-xs" /></label>
          <label className="flex flex-col gap-1.5"><span className="text-xs font-semibold text-slate-600">Priority</span><select value={form.priority} onChange={(e) => set('priority', e.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-xs">{(masterData.Priorities ?? ['Routine', 'Important', 'Urgent']).map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="flex flex-col gap-1.5"><span className="text-xs font-semibold text-slate-600">Confidentiality</span><select value={form.confidentiality} onChange={(e) => set('confidentiality', e.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-xs">{(masterData['Confidentiality Levels'] ?? ['Normal']).map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="flex flex-col gap-1.5"><span className="text-xs font-semibold text-slate-600">From organization</span><input list="orgs" value={form.from} onChange={(e) => set('from', e.target.value)} className="h-10 rounded-md border border-slate-200 px-3 text-xs" /></label>
          <label className="flex flex-col gap-1.5"><span className="text-xs font-semibold text-slate-600">To organization</span><input list="orgs" value={form.to} onChange={(e) => set('to', e.target.value)} className="h-10 rounded-md border border-slate-200 px-3 text-xs" /></label>
          <label className="flex flex-col gap-1.5"><span className="text-xs font-semibold text-slate-600">Department</span><select value={form.department} onChange={(e) => set('department', e.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-xs"><option value="">Select...</option>{departments.map((d) => <option key={d.code}>{d.name}</option>)}</select></label>
          <label className="flex flex-col gap-1.5"><span className="text-xs font-semibold text-slate-600">Assigned to</span><select value={form.assignedTo} onChange={(e) => set('assignedTo', e.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-xs"><option value="">Select...</option>{users.map((u) => <option key={u.username}>{u.name}</option>)}</select></label>
          <label className="flex flex-col gap-1.5"><span className="text-xs font-semibold text-slate-600">Due date</span><input type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} className="h-10 rounded-md border border-slate-200 px-3 text-xs" /></label>
          <label className="flex flex-col gap-1.5 sm:col-span-2"><span className="text-xs font-semibold text-slate-600">Action required</span><input value={form.actionRequired} onChange={(e) => set('actionRequired', e.target.value)} className="h-10 rounded-md border border-slate-200 px-3 text-xs" /></label>
          <label className="flex flex-col gap-1.5 sm:col-span-2"><span className="text-xs font-semibold text-slate-600">Initial remarks</span><textarea rows={3} value={form.remarks} onChange={(e) => set('remarks', e.target.value)} className="rounded-md border border-slate-200 px-3 py-2 text-xs" /></label>
        </div>
        <datalist id="orgs">{organizations.map((org) => <option key={org.name} value={org.name} />)}</datalist>
        {error && <p className="px-5 pb-2 text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-4">
          <Button variant="outline" onClick={() => submit('Registered')}>Save as draft</Button>
          <Button onClick={() => submit('Registered')}>Register letter</Button>
        </div>
      </Card>
      {saved && <div className="fixed bottom-5 right-5 rounded-lg bg-[#102a43] px-4 py-3 text-xs font-semibold text-white">Letter saved successfully.</div>}
    </>
  )
}

function SettingsPage() {
  const { settings, updateSettings } = useAppData()
  const [form, setForm] = useState(settings)
  const [saved, setSaved] = useState(false)
  return (
    <>
      <PageTitle title="Settings" description="System defaults used across the correspondence workspace." />
      <Card className="max-w-2xl p-5">
        <div className="grid gap-4">
          {([
            ['organizationName', 'Organization name'],
            ['systemName', 'System name'],
            ['defaultDueDays', 'Default due days'],
            ['currentUser', 'Current user'],
          ] as const).map(([key, label]) => (
            <label key={key} className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-600">{label}</span>
              <input value={form[key]} onChange={(e) => setForm((current) => ({ ...current, [key]: e.target.value }))} className="h-10 rounded-md border border-slate-200 px-3 text-xs" />
            </label>
          ))}
        </div>
        <div className="mt-5 flex justify-end">
          <Button onClick={async () => { await updateSettings(form); setSaved(true); setTimeout(() => setSaved(false), 2000) }}>Save settings</Button>
        </div>
      </Card>
      {saved && <div className="fixed bottom-5 right-5 rounded-lg bg-[#102a43] px-4 py-3 text-xs font-semibold text-white">Settings saved.</div>}
    </>
  )
}

function Workspace() {
  const { loading, error, refresh, departments, organizations, users, addDepartment, addOrganization, addUser, letters } = useAppData()
  const [page, setPage] = useState('Dashboard')
  const [query, setQuery] = useState('')
  const [mobile, setMobile] = useState(false)
  const [aiSearch, setAiSearch] = useState<InterpretedQuery | null>(null)
  const go = (p: string) => setPage(/^\d+$/.test(p) ? `detail:${p}` : p)

  useEffect(() => {
    if (!looksLikeNaturalQuery(query)) {
      setAiSearch(null)
      return
    }
    let active = true
    naturalLanguageSearch(query, letters).then((result) => { if (active) setAiSearch(result) })
    return () => { active = false }
  }, [query, letters])

  let content: React.ReactNode
  if (loading) content = <div className="rounded-lg border border-slate-200 bg-white p-10 text-sm text-slate-500">Loading correspondence workspace…</div>
  else if (error) content = (
    <Card className="p-8">
      <h2 className="text-sm font-bold text-slate-700">Backend unavailable</h2>
      <p className="mt-2 text-sm text-slate-500">{error}</p>
      <Button className="mt-4" onClick={() => refresh()}>Retry connection</Button>
    </Card>
  )
  else if (page === 'Dashboard') content = <Dashboard go={go} />
  else if (page === 'Analytics') content = <Analytics />
  else if (page === 'Reports') content = <Reports />
  else if (page === 'Departments') content = <ManagementTable title="Departments" description="Manage organizational departments and workload ownership." headers={['Code', 'Department Name', 'Head / Responsible Officer', 'Active Users', 'Pending Letters', 'Status']} rows={departments} onAdd={(v) => addDepartment({ code: v.code, name: v.name, head: v.head })} addFields={[{ name: 'code', label: 'Code' }, { name: 'name', label: 'Department name' }, { name: 'head', label: 'Head / responsible officer' }]} />
  else if (page === 'Organizations') content = <ManagementTable title="Organizations" description="Manage internal and external correspondence sources." headers={['Organization', 'Short Name', 'Type', 'Contact Person', 'Email', 'Phone', 'Status']} rows={organizations} onAdd={(v) => addOrganization({ name: v.name, short: v.short, type: v.type, contact: v.contact, email: v.email, phone: v.phone })} addFields={[{ name: 'name', label: 'Organization' }, { name: 'short', label: 'Short name' }, { name: 'type', label: 'Type' }, { name: 'contact', label: 'Contact person' }, { name: 'email', label: 'Email' }, { name: 'phone', label: 'Phone' }]} />
  else if (page === 'Users & Roles') content = <ManagementTable title="Users & Roles" description="Manage user accounts and conceptual access roles." headers={['Name', 'Username', 'Department', 'Role', 'Email', 'Status', 'Last Activity']} rows={users} onAdd={(v) => addUser({ name: v.name, username: v.username, department: v.department, role: v.role, email: v.email })} addFields={[{ name: 'name', label: 'Name' }, { name: 'username', label: 'Username' }, { name: 'department', label: 'Department' }, { name: 'role', label: 'Role' }, { name: 'email', label: 'Email' }]} />
  else if (page === 'Master Data') content = <MasterData />
  else if (page === 'Audit Log') content = <Audit />
  else if (page === 'Notifications') content = <Notifications go={go} />
  else if (page === 'Register Letter') content = <Register go={go} />
  else if (page === 'Settings') content = <SettingsPage />
  else if (page === 'AI Assistant') content = <><PageTitle title="AI Assistant" description="Ask questions about the correspondence register. Responses are mock, advisory intelligence." /><AIAssistant go={go} /></>
  else if (page === 'AI Insights') content = <><PageTitle title="AI Insights" description="Operational, risk and management observations generated from the current register." /><AIInsightsPage go={go} /></>
  else if (page === 'Letter Analysis' || page.startsWith('analysis:')) content = <><PageTitle title="Letter Analysis" description="Timeline, delays and relationship analysis for selected correspondence." /><LetterAnalysisPage selectedId={page.startsWith('analysis:') ? page.split(':')[1] : undefined} go={go} /></>
  else if (page.startsWith('detail:')) content = <Details id={page.split(':')[1]} go={go} />
  else content = <Database page={page} query={query} go={go} aiSearch={aiSearch} onClearAi={() => { setAiSearch(null); setQuery('') }} />

  return (
    <div className="flex min-h-screen bg-[#f5f8fb] text-slate-900">
      <Sidebar page={page.startsWith('detail:') ? 'All Letters' : page.startsWith('analysis:') ? 'Letter Analysis' : page} setPage={setPage} mobile={mobile} setMobile={setMobile} />
      {mobile && <div onClick={() => setMobile(false)} className="fixed inset-0 z-10 bg-slate-900/20 lg:hidden" />}
      <div className="flex min-w-0 flex-1 flex-col">
        <Header setMobile={setMobile} query={query} setQuery={(value) => { setQuery(value); if (looksLikeNaturalQuery(value)) setPage('All Letters') }} go={go} />
        <main className="mx-auto w-full max-w-[1600px] flex-1 p-4 sm:p-7">{content}</main>
      </div>
    </div>
  )
}

export default function Page() {
  return (
    <AppDataProvider>
      <Workspace />
    </AppDataProvider>
  )
}
