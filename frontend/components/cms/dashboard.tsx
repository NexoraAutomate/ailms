'use client'

import { useMemo } from 'react'
import { Activity, CircleAlert, ChevronRight, Inbox, Plus, Sparkles } from 'lucide-react'
import { metricValue, useAppData } from '@/components/app-provider'
import { AIManagementInsights } from '@/components/ai/pages'
import { Button } from '@/components/ui/button'
import { Card, Kpi, MiniDashboard, PageTitle } from '@/components/cms/ui'
import { DataTable, type DataTableColumn } from '@/components/cms/data-table'

type DeptRow = {
  name: string
  assigned: number
  pending: number
  completed: number
  overdue: number
}

export function Dashboard({ go }: { go: (p: string) => void }) {
  const { dashboardMetrics, metrics, trend, alerts, departmentPerformance, auditRecords } = useAppData()

  const deptColumns = useMemo<DataTableColumn<DeptRow>[]>(
    () => [
      { id: 'name', header: 'Department', sortValue: (d) => d.name, className: 'font-semibold text-slate-700', cell: (d) => d.name },
      { id: 'assigned', header: 'Assigned', sortValue: (d) => d.assigned, className: 'text-slate-600', cell: (d) => d.assigned },
      { id: 'pending', header: 'Pending', sortValue: (d) => d.pending, className: 'text-amber-700', cell: (d) => d.pending },
      { id: 'completed', header: 'Completed', sortValue: (d) => d.completed, className: 'text-emerald-700', cell: (d) => d.completed },
      { id: 'overdue', header: 'Overdue', sortValue: (d) => d.overdue, className: 'text-red-600', cell: (d) => d.overdue },
    ],
    [],
  )

  return (
    <>
      <PageTitle title="Dashboard" description="Overview of correspondence activity and action performance." action={<div className="flex gap-2"><Button variant="outline" onClick={() => go('AI Assistant')}><Sparkles data-icon="inline-start" />AI Assistant</Button><Button onClick={() => go('Register Letter')}><Plus data-icon="inline-start" />Register letter</Button></div>} />
      <MiniDashboard
        title="Key metrics"
        description="Correspondence snapshot — expand for full cards"
        className="mb-0"
        gridClassName="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-7"
      >
        {dashboardMetrics.map((m) => (
          <Kpi key={m.label} label={m.label === 'Total Letters' ? 'Total Correspondence' : m.label} value={metricValue(metrics, m.label === 'Total Letters' ? 'Total Correspondence' : m.label)} icon={<Inbox className="size-4" />} onClick={() => go(m.filter)} />
        ))}
      </MiniDashboard>
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
        <DataTable
          columns={deptColumns}
          data={departmentPerformance}
          rowKey={(d) => d.name}
          storageKey="dashboard-dept"
          minWidth="520px"
          maxHeight="min(320px, 45vh)"
          title="Department performance"
          description="Current workload snapshot"
        />
        <Card>
          <div className="border-b border-slate-100 p-5">
            <h2 className="text-sm font-bold text-slate-700">Recent management activity</h2>
            <p className="text-xs text-slate-400">Latest audit records</p>
          </div>
          <div className="max-h-[320px] overflow-y-auto">
            {auditRecords.slice(0, 10).map((a, index) => (
              <div className="flex gap-3 border-b border-slate-100 p-4" key={`${a.date}-${a.record}-${a.action}-${a.user}-${index}`}>
                <Activity className="mt-0.5 size-4 text-[#1769aa]" />
                <div>
                  <p className="text-xs font-semibold text-slate-700">{a.action}</p>
                  <p className="text-[11px] text-slate-400">{a.description}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <AIManagementInsights go={go} />
    </>
  )
}
