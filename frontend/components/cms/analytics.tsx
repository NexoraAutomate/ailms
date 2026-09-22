'use client'

import { BarChart3 } from 'lucide-react'
import { metricValue, useAppData } from '@/components/app-provider'
import { Badge, Card, Filters, Kpi, PageTitle } from '@/components/cms/ui'

export function Analytics() {
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
