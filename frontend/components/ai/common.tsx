'use client'

import { useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AiDecision, AiStatus, InsightSeverity, ManagementInsight } from '@/services/ai'

const severityTone: Record<InsightSeverity, string> = {
  Critical: 'red',
  High: 'amber',
  Medium: 'blue',
  Informational: 'slate',
}

const toneClasses: Record<string, string> = {
  slate: 'bg-slate-100 text-slate-700',
  amber: 'bg-amber-100 text-amber-800',
  blue: 'bg-blue-100 text-blue-800',
  green: 'bg-emerald-100 text-emerald-800',
  red: 'bg-red-100 text-red-800',
}

export function AiBadge({ children, tone = 'slate' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`inline-flex items-center rounded-md px-2 py-1 text-[11px] font-semibold ${toneClasses[tone] ?? toneClasses.slate}`}>{children}</span>
}

export function AIConfidenceBadge({ value }: { value: number }) {
  return <AiBadge tone={value >= 90 ? 'green' : value >= 80 ? 'blue' : 'amber'}>{value}%</AiBadge>
}

export function AIStatusIndicator({ status, label }: { status: AiStatus; label?: string }) {
  const text = {
    idle: 'Ready',
    analyzing: 'AI is analyzing correspondence...',
    generating: 'AI is generating a response...',
    success: 'Analysis complete',
    empty: 'Nothing to analyze yet.',
    'no-result': 'No matching correspondence found.',
    error: 'The AI service could not complete this request.',
    unavailable: 'AI assistance is temporarily unavailable.',
  }[status]
  if (status === 'analyzing' || status === 'generating') {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
        <div className="mb-2 h-2 w-32 animate-pulse rounded bg-slate-200" />
        <div className="h-2 w-full animate-pulse rounded bg-slate-200" />
        <p className="mt-3 text-xs text-slate-500">{label || text}</p>
      </div>
    )
  }
  if (status === 'error' || status === 'unavailable' || status === 'empty' || status === 'no-result') {
    return <p className="rounded-md bg-slate-50 p-4 text-xs text-slate-500">{label || text}</p>
  }
  return null
}

export function AIAdvisoryNote() {
  return (
    <p className="text-[11px] leading-5 text-slate-400">
      AI suggestions may be wrong; verify against the document. Nothing is registered until you approve.
    </p>
  )
}

export function AISuggestionCard({ title, children, decision }: { title: string; children: React.ReactNode; decision?: AiDecision }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold text-slate-700">{title}</h3>
        <AiBadge tone="blue">AI Suggested</AiBadge>
      </div>
      {children}
      {decision && decision !== 'pending' && (
        <p className="mt-3 text-[11px] text-slate-400">
          {decision === 'accepted' && 'User accepted this suggestion.'}
          {decision === 'modified' && 'User modified this suggestion before acceptance.'}
          {decision === 'rejected' && 'User rejected this suggestion. The official record was not changed.'}
        </p>
      )}
    </div>
  )
}

export function AIInsightCard({ insight, onView }: { insight: ManagementInsight; onView: (ids: string[]) => void }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold text-slate-700">{insight.title}</h3>
        <AiBadge tone={severityTone[insight.severity]}>{insight.severity}</AiBadge>
        <AiBadge>{insight.group}</AiBadge>
      </div>
      <p className="text-xs text-slate-600">{insight.explanation}</p>
      <p className="mt-2 text-[11px] text-slate-500">{insight.recommendation}</p>
      <Button className="mt-3" size="sm" variant="outline" onClick={() => onView(insight.letterIds)}>View Related Letters</Button>
    </article>
  )
}

export function AIConfirmationDialog({
  title,
  current,
  suggested,
  reason,
  onAccept,
  onEdit,
  onReject,
  onClose,
}: {
  title: string
  current: string
  suggested: string
  reason?: string
  onAccept: () => void | Promise<void>
  onEdit?: (value: string) => void | Promise<void>
  onReject: () => void
  onClose: () => void
}) {
  const [value, setValue] = useState(suggested)
  const [busy, setBusy] = useState(false)
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/30 p-4">
      <section className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-[#1769aa]"><Sparkles className="size-3" /> Review suggestion</p>
            <h2 className="text-sm font-bold text-slate-700">{title}</h2>
          </div>
          <button onClick={onClose}><X className="size-4 text-slate-400" /></button>
        </div>
        <div className="grid gap-3 text-xs">
          <div className="rounded-md bg-slate-50 p-3"><p className="text-[11px] text-slate-400">Current</p><p className="mt-1 font-semibold text-slate-700">{current || '—'}</p></div>
          <label className="rounded-md border border-blue-100 bg-blue-50/50 p-3">
            <p className="text-[11px] text-[#1769aa]">AI suggested</p>
            <input className="mt-1 h-9 w-full rounded border border-slate-200 bg-white px-2 text-xs" value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
          {reason && <p className="text-slate-500">{reason}</p>}
        </div>
        <AIAdvisoryNote />
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onReject}>Reject</Button>
          <Button variant="outline" disabled={busy} onClick={async () => { setBusy(true); await onEdit?.(value); setBusy(false) }}>Edit & accept</Button>
          <Button disabled={busy} onClick={async () => { setBusy(true); await onAccept(); setBusy(false) }}>Accept</Button>
        </div>
      </section>
    </div>
  )
}

export function SectionCard({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-bold text-slate-700">{title}</h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}
