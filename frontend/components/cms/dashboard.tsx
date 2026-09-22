'use client'

import { Activity, CircleAlert, ChevronRight, Inbox, Plus, Sparkles } from 'lucide-react'
import { metricValue, useAppData } from '@/components/app-provider'
import { AIManagementInsights } from '@/components/ai/pages'
import { Button } from '@/components/ui/button'
import { Card, Kpi, PageTitle } from '@/components/cms/ui'

export function Dashboard({ go }: { go: (p: string) => void }) {
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
          {auditRecords.slice(0, 4).map((a, index) => (
            <div className="flex gap-3 border-b border-slate-100 p-4" key={`${a.date}-${a.record}-${a.action}-${a.user}-${index}`}>
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
