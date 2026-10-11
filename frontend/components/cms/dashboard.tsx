'use client'

import { CircleAlert, ChevronRight, Clock3, Inbox, Percent, Plus, Sparkles, Timer, TriangleAlert } from 'lucide-react'
import { metricValue, useAppData } from '@/components/app-provider'
import { AIManagementInsights } from '@/components/ai/pages'
import { Button } from '@/components/ui/button'
import { Card, Kpi, MiniDashboard, PageTitle } from '@/components/cms/ui'

const DECISION_KPIS = [
  { label: 'Pending', icon: Clock3, href: '/analytics?status=Pending' },
  { label: 'Overdue', icon: TriangleAlert, href: '/analytics?view=needs-action' },
  { label: 'Due Today', icon: Timer, href: '/analytics?view=needs-action' },
  { label: 'Closure Rate', icon: Percent, href: '/analytics' },
  { label: 'Average Response Time', icon: Inbox, href: '/analytics' },
] as const

export function Dashboard({ go }: { go: (p: string) => void }) {
  const { metrics, alerts } = useAppData()

  return (
    <>
      <PageTitle
        title="Dashboard"
        description="Key signals for decisions — open Analytics to explore the register in depth."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => go('My Actions')}>
              My Actions
            </Button>
            <Button variant="outline" onClick={() => go('AI Assistant')}>
              <Sparkles data-icon="inline-start" />
              AI Assistant
            </Button>
            <Button onClick={() => go('Register Letter')}>
              <Plus data-icon="inline-start" />
              Register letter
            </Button>
          </div>
        }
      />

      <MiniDashboard
        title="Decision metrics"
        description="Instant KPIs — click through to Analytics"
        className="mb-0"
        gridClassName="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5"
      >
        {DECISION_KPIS.map((m) => {
          const Icon = m.icon
          return (
            <Kpi
              key={m.label}
              label={m.label}
              value={metricValue(metrics, m.label)}
              icon={<Icon className="size-4" />}
              onClick={() => go(m.href)}
            />
          )
        })}
      </MiniDashboard>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1fr_1.2fr]">
        <Card className="p-5">
          <h2 className="text-sm font-bold text-slate-700">Needs attention</h2>
          <p className="text-xs text-slate-400">Items that may need a decision or follow-up</p>
          <div className="mt-4 flex flex-col gap-3">
            {alerts.map((alert) => (
              <button
                key={alert.title}
                type="button"
                onClick={() => go('/analytics?view=needs-action')}
                className="flex items-center gap-3 rounded-md bg-slate-50 p-3 text-left hover:bg-blue-50"
              >
                <CircleAlert className={`size-4 ${alert.tone === 'red' ? 'text-red-500' : 'text-amber-500'}`} />
                <span className="flex-1 text-xs font-semibold text-slate-700">{alert.title}</span>
                <b className="text-sm text-[#102a43]">{alert.count}</b>
                <ChevronRight className="size-4 text-slate-400" />
              </button>
            ))}
            {!alerts.length && (
              <p className="py-4 text-center text-xs text-slate-400">No attention items right now.</p>
            )}
          </div>
        </Card>

        <div className="min-w-0">
          <AIManagementInsights go={go} />
        </div>
      </div>
    </>
  )
}
