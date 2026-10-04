'use client'

import { createContext, useContext, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'
import { BriefcaseBusiness, ChevronDown, ChevronRight, Maximize2, Minimize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sparkline } from '@/components/ui/sparkline'
import { cn } from '@/lib/utils'

const MiniDashboardExpandedCtx = createContext(true)

/** Shared expand/collapse for KPI mini-dashboard strips. */
export function MiniDashboard({
  title,
  description,
  children,
  defaultExpanded = true,
  className,
  gridClassName,
  style,
}: {
  title?: string
  description?: string
  children: ReactNode
  defaultExpanded?: boolean
  className?: string
  /** Applied to the expanded content wrapper (typically a grid). */
  gridClassName?: string
  style?: CSSProperties
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  return (
    <section className={cn('rounded-lg border border-slate-200 bg-white shadow-sm', className)} style={style}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5 sm:px-4">
        <div className="min-w-0">
          {title ? <h2 className="text-sm font-bold text-slate-700">{title}</h2> : null}
          {description ? <p className="text-[11px] text-slate-400">{description}</p> : null}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? <Minimize2 data-icon="inline-start" /> : <Maximize2 data-icon="inline-start" />}
          {expanded ? 'Minimize' : 'Expand'}
          <ChevronDown className={cn('size-3.5 transition', expanded ? 'rotate-180' : '')} />
        </Button>
      </div>
      <MiniDashboardExpandedCtx.Provider value={expanded}>
        <div
          className={cn(
            expanded ? 'p-3 sm:p-4' : 'flex flex-wrap gap-2 px-3 py-2 sm:px-4',
            expanded && gridClassName,
          )}
        >
          {children}
        </div>
      </MiniDashboardExpandedCtx.Provider>
    </section>
  )
}

export function useMiniDashboardExpanded() {
  return useContext(MiniDashboardExpandedCtx)
}

const toneClasses: Record<string, string> = {
  slate: 'bg-slate-100 text-slate-700 dark:text-slate-200',
  amber: 'bg-amber-100 text-amber-800 dark:text-amber-200',
  blue: 'bg-blue-100 text-blue-800 dark:text-blue-200',
  indigo: 'bg-indigo-100 text-indigo-800 dark:text-indigo-200',
  violet: 'bg-violet-100 text-violet-800 dark:text-violet-200',
  green: 'bg-emerald-100 text-emerald-800 dark:text-emerald-200',
  red: 'bg-red-100 text-red-800 dark:text-red-200',
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: string }) {
  return <span className={`inline-flex items-center rounded-md px-2 py-1 text-[11px] font-semibold ${toneClasses[tone] ?? toneClasses.slate}`}>{children}</span>
}

export function Logo() {
  return (
    <div className="flex size-9 items-center justify-center rounded-lg bg-[#0d3763] text-white shadow-sm">
      <BriefcaseBusiness className="size-5" />
    </div>
  )
}

export function PageTitle({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
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

export function Card({ children, className = '', ...props }: HTMLAttributes<HTMLElement> & { children: ReactNode; className?: string }) {
  return <section className={cn('rounded-lg border border-slate-200 bg-white shadow-sm', className)} {...props}>{children}</section>
}

export function Kpi({
  label,
  icon,
  onClick,
  value,
  percent,
  series,
  seriesColor,
  periods,
}: {
  label: string
  icon: React.ReactNode
  onClick?: () => void
  value: string
  /** Share of the parent total, 0–100. Omit to hide. */
  percent?: number | null
  /** Optional daily counts for a compact sparkline (no axes/labels). */
  series?: number[]
  seriesColor?: string
  /** Compact period breakdown (Today / Week / Month / Year / Overall). */
  periods?: { label: string; value: number }[]
}) {
  const expanded = useMiniDashboardExpanded()
  const pct =
    percent == null || Number.isNaN(percent)
      ? null
      : Math.max(0, Math.min(100, Math.round(percent * 10) / 10))

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="inline-flex min-w-0 items-center gap-2 rounded-md border border-slate-200 bg-slate-50/80 px-2.5 py-1.5 text-left transition hover:border-blue-200 hover:bg-blue-50/50"
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded text-[#1769aa]">{icon}</span>
        <span className="min-w-0 truncate text-[11px] text-slate-500">{label}</span>
        <span className="shrink-0 text-sm font-bold tabular-nums text-[#102a43]">{value}</span>
        {pct != null ? <span className="shrink-0 text-[10px] font-semibold text-slate-400">{pct}%</span> : null}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="group rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md sm:p-4"
    >
      <div className="mb-2 flex items-center justify-between gap-2 sm:mb-3">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-blue-50 text-[#1769aa]">{icon}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <p className="text-2xl font-bold text-[#102a43]">{value}</p>
        {pct != null ? (
          <span className="text-xs font-semibold text-slate-500">{pct}%</span>
        ) : null}
      </div>
      {periods && periods.length > 0 ? (
        <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] leading-snug">
          {periods.map((p) => (
            <div key={p.label} className="flex items-baseline justify-between gap-1 border-b border-slate-50 py-0.5 last:border-0">
              <dt className="text-slate-400">{p.label}</dt>
              <dd className="font-semibold tabular-nums text-slate-700">{p.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {series && series.length > 0 ? (
        <div className="mt-2 h-7 w-full">
          <Sparkline
            values={series}
            className="h-full w-full"
            stroke={seriesColor ?? '#1769aa'}
            fill={seriesColor ? `${seriesColor}20` : 'rgba(23, 105, 170, 0.12)'}
          />
        </div>
      ) : null}
    </button>
  )
}

export function Filters() {
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
