'use client'

import { BriefcaseBusiness, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

const toneClasses: Record<string, string> = {
  slate: 'bg-slate-100 text-slate-700',
  amber: 'bg-amber-100 text-amber-800',
  blue: 'bg-blue-100 text-blue-800',
  indigo: 'bg-indigo-100 text-indigo-800',
  violet: 'bg-violet-100 text-violet-800',
  green: 'bg-emerald-100 text-emerald-800',
  red: 'bg-red-100 text-red-800',
}

export function Badge({ children, tone = 'slate' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`inline-flex items-center rounded-md px-2 py-1 text-[11px] font-semibold ${toneClasses[tone] ?? toneClasses.slate}`}>{children}</span>
}

export function Logo() {
  return (
    <div className="flex size-9 items-center justify-center rounded-lg bg-[#0d3763] text-white shadow-sm">
      <BriefcaseBusiness className="size-5" />
    </div>
  )
}

export function PageTitle({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
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

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>{children}</section>
}

export function Kpi({ label, icon, onClick, value }: { label: string; icon: React.ReactNode; onClick?: () => void; value: string }) {
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
