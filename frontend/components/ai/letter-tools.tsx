'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, Copy, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AIAdvisoryNote,
  AIConfidenceBadge,
  AIConfirmationDialog,
  AIStatusIndicator,
  AISuggestionCard,
  AiBadge,
  SectionCard,
} from '@/components/ai/common'
import {
  analyzeCorrespondence,
  assessUrgency,
  classifyLetter,
  extractLetterInformation,
  generateDraftResponse,
  recommendActions,
  summarizeLetter,
  type ActionRecommendation,
  type AiDecision,
  type AiStatus,
  type ClassificationSuggestion,
  type CorrespondenceAnalysis,
  type DraftResponse,
  type ExtractedField,
  type UrgencyAssessment,
  type AiSummary,
} from '@/services/ai'
import type { Letter } from '@/services/letters'

type ConfirmTarget = { title: string; current: string; suggested: string; reason?: string; apply: (value: string, decision: AiDecision) => Promise<void> }

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    /* ignore */
  }
}

export function AISummary({ letter }: { letter: Letter }) {
  const [status, setStatus] = useState<AiStatus>('idle')
  const [data, setData] = useState<AiSummary | null>(null)
  const [open, setOpen] = useState(true)
  const [variant, setVariant] = useState(0)
  const load = async (next = variant) => {
    setStatus('analyzing')
    try {
      setData(await summarizeLetter(letter, next))
      setStatus('success')
    } catch {
      setStatus('error')
    }
  }
  useEffect(() => { void load(0) }, [letter.id])
  return (
    <SectionCard title="AI Summary" action={<div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => { const next = variant + 1; setVariant(next); void load(next) }}>Regenerate Summary</Button><Button size="sm" variant="outline" onClick={() => data && copyText([data.executiveSummary, ...data.keyPoints].join('\n'))}><Copy data-icon="inline-start" />Copy Summary</Button></div>}>
      <AIStatusIndicator status={status === 'success' ? 'idle' : status} />
      {data && status === 'success' && (
        <div className="space-y-3">
          <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen((v) => !v)}>
            <p className="text-xs font-semibold text-slate-700">Executive Summary</p>
            <ChevronDown className={`size-4 text-slate-400 ${open ? 'rotate-180' : ''}`} />
          </button>
          {open && <p className="text-xs leading-5 text-slate-600">{data.executiveSummary}</p>}
          {[
            ['Purpose', data.purpose],
            ['Required Actions', data.requiredActions],
            ['Current Status', data.currentStatus],
            ['Potential Risk', data.potentialRisk],
            ['Recommended Follow-up', data.recommendedFollowUp],
          ].map(([label, value]) => (
            <details key={label} className="rounded-md bg-slate-50 p-3" open>
              <summary className="cursor-pointer text-xs font-semibold text-slate-700">{label}</summary>
              <p className="mt-2 text-xs text-slate-600">{value}</p>
            </details>
          ))}
          <details className="rounded-md bg-slate-50 p-3" open>
            <summary className="cursor-pointer text-xs font-semibold text-slate-700">Key Points</summary>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-600">{data.keyPoints.map((item) => <li key={item}>{item}</li>)}</ul>
          </details>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><p className="text-[11px] text-slate-400">Important Dates</p><p className="mt-1 text-xs text-slate-600">{data.importantDates.join(' · ') || '—'}</p></div>
            <div><p className="text-[11px] text-slate-400">Organizations / Persons</p><p className="mt-1 text-xs text-slate-600">{data.organizations.join(' · ') || '—'}</p></div>
          </div>
        </div>
      )}
    </SectionCard>
  )
}

export function AIExtractionPanel({ letter, onApply }: { letter: Letter; onApply: (field: string, value: string, decision: AiDecision) => Promise<void> }) {
  const [status, setStatus] = useState<AiStatus>('idle')
  const [fields, setFields] = useState<ExtractedField[]>([])
  const [decisions, setDecisions] = useState<Record<string, AiDecision>>({})
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [confirm, setConfirm] = useState<ConfirmTarget | null>(null)
  useEffect(() => {
    setStatus('analyzing')
    extractLetterInformation(letter).then((rows) => { setFields(rows); setStatus('success') }).catch(() => setStatus('error'))
  }, [letter.id])
  const officialKeys = new Set(['number', 'letterDate', 'receivedDate', 'from', 'to', 'department', 'subject', 'priority', 'dueDate', 'actionRequired'])
  return (
    <SectionCard title="AI Information Extraction">
      <AIAdvisoryNote />
      <AIStatusIndicator status={status === 'success' ? 'idle' : status} />
      <div className="mt-3 grid gap-3">
        {fields.map((field) => (
          <AISuggestionCard key={field.key} title={field.label} decision={decisions[field.key]}>
            <div className="flex flex-wrap items-center gap-2">
              <input className="h-9 min-w-[180px] flex-1 rounded-md border border-slate-200 px-2 text-xs" value={edits[field.key] ?? field.value} onChange={(e) => setEdits((current) => ({ ...current, [field.key]: e.target.value }))} />
              <AIConfidenceBadge value={field.confidence} />
            </div>
            {officialKeys.has(field.key) && decisions[field.key] !== 'accepted' && decisions[field.key] !== 'modified' && decisions[field.key] !== 'rejected' && (
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => setConfirm({ title: field.label, current: field.official || '—', suggested: edits[field.key] ?? field.value, apply: (value: string, decision: AiDecision) => onApply(field.key, value, decision).then(() => setDecisions((c) => ({ ...c, [field.key]: decision }))) })}>Accept</Button>
                <Button size="sm" variant="outline" onClick={() => setConfirm({ title: field.label, current: field.official || '—', suggested: edits[field.key] ?? field.value, apply: (value: string, decision: AiDecision) => onApply(field.key, value, decision).then(() => setDecisions((c) => ({ ...c, [field.key]: decision }))) })}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => setDecisions((c) => ({ ...c, [field.key]: 'rejected' }))}>Reject</Button>
              </div>
            )}
          </AISuggestionCard>
        ))}
      </div>
      {confirm && <AIConfirmationDialog title={confirm.title} current={confirm.current} suggested={confirm.suggested} onClose={() => setConfirm(null)} onReject={() => { void confirm.apply(confirm.current, 'rejected'); setConfirm(null) }} onAccept={async () => { await confirm.apply(confirm.suggested, 'accepted'); setConfirm(null) }} onEdit={async (value) => { await confirm.apply(value, 'modified'); setConfirm(null) }} />}
    </SectionCard>
  )
}

export function AIClassification({ letter, onApply }: { letter: Letter; onApply: (field: string, value: string, decision: AiDecision) => Promise<void> }) {
  const [status, setStatus] = useState<AiStatus>('idle')
  const [items, setItems] = useState<ClassificationSuggestion[]>([])
  const [decisions, setDecisions] = useState<Record<string, AiDecision>>({})
  const [confirm, setConfirm] = useState<ConfirmTarget | null>(null)
  useEffect(() => {
    setStatus('analyzing')
    classifyLetter(letter).then((rows) => { setItems(rows); setStatus('success') }).catch(() => setStatus('error'))
  }, [letter.id])
  const current: Record<string, string> = { category: letter.type, subjectCategory: '—', department: letter.department, priority: letter.priority, confidentiality: letter.confidentiality || 'Normal' }
  return (
    <SectionCard title="AI Classification">
      <AIStatusIndicator status={status === 'success' ? 'idle' : status} />
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <AISuggestionCard key={item.field} title={item.label} decision={decisions[item.field]}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-700">{item.value}</p>
              <AIConfidenceBadge value={item.confidence} />
            </div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={() => setConfirm({ title: item.label, current: current[item.field] || '—', suggested: item.value, apply: (value: string, decision: AiDecision) => onApply(item.field, value, decision).then(() => setDecisions((c) => ({ ...c, [item.field]: decision }))) })}>Accept</Button>
              <Button size="sm" variant="ghost" onClick={() => setDecisions((c) => ({ ...c, [item.field]: 'rejected' }))}>Reject</Button>
            </div>
          </AISuggestionCard>
        ))}
      </div>
      {confirm && <AIConfirmationDialog title={confirm.title} current={confirm.current} suggested={confirm.suggested} onClose={() => setConfirm(null)} onReject={() => { void confirm.apply(confirm.current, 'rejected'); setConfirm(null) }} onAccept={async () => { await confirm.apply(confirm.suggested, 'accepted'); setConfirm(null) }} onEdit={async (value) => { await confirm.apply(value, 'modified'); setConfirm(null) }} />}
    </SectionCard>
  )
}

export function AIActionRecommendations({ letter, onAcceptAction }: { letter: Letter; onAcceptAction: (action: string, decision: AiDecision) => Promise<void> }) {
  const [status, setStatus] = useState<AiStatus>('idle')
  const [rows, setRows] = useState<ActionRecommendation[]>([])
  const [decisions, setDecisions] = useState<Record<string, AiDecision>>({})
  const [confirm, setConfirm] = useState<ActionRecommendation | null>(null)
  useEffect(() => {
    setStatus('analyzing')
    recommendActions(letter).then((items) => { setRows(items); setStatus('success') }).catch(() => setStatus('error'))
  }, [letter.id])
  return (
    <SectionCard title="AI Recommended Actions">
      <AIAdvisoryNote />
      <AIStatusIndicator status={status === 'success' ? 'idle' : status} />
      <div className="space-y-3">
        {rows.map((row, index) => (
          <AISuggestionCard key={row.id} title={`${index + 1}. ${row.action}`} decision={decisions[row.id]}>
            <div className="grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
              <p><span className="text-slate-400">Department · </span>{row.department}</p>
              <p><span className="text-slate-400">Person · </span>{row.person}</p>
              <p><span className="text-slate-400">Due · </span>{row.dueDate || '—'}</p>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">{row.reason}</p>
            {decisions[row.id] !== 'accepted' && decisions[row.id] !== 'rejected' && (
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => setConfirm(row)}>Accept</Button>
                <Button size="sm" variant="ghost" onClick={() => setDecisions((c) => ({ ...c, [row.id]: 'rejected' }))}>Reject</Button>
              </div>
            )}
          </AISuggestionCard>
        ))}
      </div>
      {confirm && <AIConfirmationDialog title="Add recommended action" current={letter.lastAction} suggested={confirm.action} reason={confirm.reason} onClose={() => setConfirm(null)} onReject={() => { setDecisions((c) => ({ ...c, [confirm.id]: 'rejected' })); setConfirm(null) }} onAccept={async () => { await onAcceptAction(confirm.action, 'accepted'); setDecisions((c) => ({ ...c, [confirm.id]: 'accepted' })); setConfirm(null) }} onEdit={async (value) => { await onAcceptAction(value, 'modified'); setDecisions((c) => ({ ...c, [confirm.id]: 'modified' })); setConfirm(null) }} />}
    </SectionCard>
  )
}

export function AIUrgencyAssessment({ letter, onApply }: { letter: Letter; onApply: (priority: string, decision: AiDecision) => Promise<void> }) {
  const [status, setStatus] = useState<AiStatus>('idle')
  const [data, setData] = useState<UrgencyAssessment | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [decision, setDecision] = useState<AiDecision>('pending')
  useEffect(() => {
    setStatus('analyzing')
    assessUrgency(letter).then((row) => { setData(row); setStatus('success') }).catch(() => setStatus('error'))
  }, [letter.id])
  return (
    <SectionCard title="AI Urgency Assessment" action={data && <Button size="sm" onClick={() => setConfirm(true)}>Apply Suggested Priority</Button>}>
      <AIStatusIndicator status={status === 'success' ? 'idle' : status} />
      {data && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <AiBadge tone={data.priority === 'Urgent' ? 'red' : 'amber'}>Priority: {data.priority}</AiBadge>
            <AiBadge tone={data.urgency === 'Critical' ? 'red' : 'amber'}>Urgency: {data.urgency}</AiBadge>
            <AIConfidenceBadge value={data.confidence} />
          </div>
          <p className="text-xs text-slate-600">Suggested response deadline: {data.suggestedDeadline || '—'}</p>
          <ul className="list-disc space-y-1 pl-4 text-xs text-slate-600">{data.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          {decision !== 'pending' && <p className="text-[11px] text-slate-400">Priority suggested by AI and {decision} by the current user.</p>}
        </div>
      )}
      {confirm && data && <AIConfirmationDialog title="Apply suggested priority" current={letter.priority} suggested={data.priority} reason={data.reasons[0]} onClose={() => setConfirm(false)} onReject={() => { setDecision('rejected'); setConfirm(false) }} onAccept={async () => { await onApply(data.priority, 'accepted'); setDecision('accepted'); setConfirm(false) }} onEdit={async (value) => { await onApply(value, 'modified'); setDecision('modified'); setConfirm(false) }} />}
    </SectionCard>
  )
}

export function AIDraftResponse({ letter }: { letter: Letter }) {
  const [status, setStatus] = useState<AiStatus>('idle')
  const [draft, setDraft] = useState<DraftResponse | null>(null)
  const [text, setText] = useState('')
  const load = async (style: 'default' | 'shorten' | 'expand' | 'formal' | 'concise' = 'default') => {
    setStatus('generating')
    try {
      const next = await generateDraftResponse(letter, style)
      setDraft(next)
      setText(next.text)
      setStatus('success')
    } catch {
      setStatus('error')
    }
  }
  useEffect(() => { void load('default') }, [letter.id])
  return (
    <SectionCard title="AI Draft Response" action={<div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void load('default')}>Regenerate</Button><Button size="sm" variant="outline" onClick={() => void copyText(text)}><Copy data-icon="inline-start" />Copy Draft</Button></div>}>
      <p className="mb-3 text-[11px] text-slate-400">AI-generated text is only a draft. It does not become an official outgoing letter.</p>
      <AIStatusIndicator status={status === 'success' ? 'idle' : status} />
      {draft && (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void load('shorten')}>Shorten</Button>
            <Button size="sm" variant="outline" onClick={() => void load('expand')}>Expand</Button>
            <Button size="sm" variant="outline" onClick={() => void load('formal')}>Make more formal</Button>
            <Button size="sm" variant="outline" onClick={() => void load('concise')}>Make more concise</Button>
          </div>
          <textarea className="min-h-36 w-full rounded-md border border-slate-200 px-3 py-2 text-xs" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
            <p><span className="text-slate-400">Tone · </span>{draft.tone}</p>
            <p><span className="text-slate-400">Points addressed · </span>{draft.pointsAddressed.join('; ')}</p>
          </div>
          <p className="mt-2 text-[11px] text-amber-700">{draft.missingInformation.join(' ')}</p>
        </>
      )}
    </SectionCard>
  )
}

export function AIAnalysisPanel({ letter, letters }: { letter: Letter; letters: Letter[] }) {
  const [status, setStatus] = useState<AiStatus>('idle')
  const [data, setData] = useState<CorrespondenceAnalysis | null>(null)
  useEffect(() => {
    setStatus('analyzing')
    analyzeCorrespondence(letter, letters).then((row) => { setData(row); setStatus('success') }).catch(() => setStatus('error'))
  }, [letter.id, letters])
  return (
    <SectionCard title="Correspondence analysis">
      <AIStatusIndicator status={status === 'success' ? 'idle' : status} />
      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            {[['Related letters', data.relatedCount], ['Replies', data.replies], ['Reminders', data.reminders], ['Duration (days)', data.durationDays]].map(([label, value]) => (
              <div key={String(label)} className="rounded-md bg-slate-50 p-3"><p className="text-[11px] text-slate-400">{label}</p><p className="mt-1 font-semibold text-slate-700">{value}</p></div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            {data.chain.map((step, index) => <span key={step} className="flex items-center gap-2"><span className="rounded bg-slate-100 px-2 py-1 font-semibold text-slate-600">{step}</span>{index < data.chain.length - 1 && <span>↓</span>}</span>)}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead className="text-[10px] uppercase text-slate-400"><tr><th className="py-2">Stage</th><th>Date</th><th>Note</th></tr></thead>
              <tbody>
                {data.timeline.map((event) => (
                  <tr key={event.label} className="border-t border-slate-100">
                    <td className="py-2 font-semibold text-slate-700">{event.label}{event.delay && <AiBadge tone="red">Delay</AiBadge>}</td>
                    <td className="text-slate-500">{event.date}</td>
                    <td className="text-slate-600">{event.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.delays.length > 0 && <ul className="list-disc pl-4 text-xs text-amber-700">{data.delays.map((item) => <li key={item}>{item}</li>)}</ul>}
        </div>
      )}
    </SectionCard>
  )
}

export function AIAnalyzeDocument({ letter }: { letter: Letter }) {
  const [status, setStatus] = useState<AiStatus>('idle')
  const [notes, setNotes] = useState<string[]>([])
  const run = async () => {
    setStatus('analyzing')
    await summarizeLetter(letter)
    setNotes([
      'Document summary: the attachment is treated as supporting correspondence for this letter.',
      `Identified dates: ${[letter.letterDate, letter.receivedDate, letter.dueDate].filter(Boolean).join(', ') || 'none'}.`,
      `Action requirement: ${letter.actionRequired || letter.lastAction || 'Review and respond'}.`,
      `Classification hint: ${topicLabel(letter)}.`,
    ])
    setStatus('success')
  }
  return (
    <SectionCard title="Attachment analysis" action={<Button size="sm" variant="outline" onClick={() => void run()}>AI Analyze Document</Button>}>
      <AIStatusIndicator status={status === 'success' ? 'idle' : status} />
      {notes.length === 0 && status === 'idle' && <p className="text-xs text-slate-500">Mock document analysis is available. No OCR or live model is used.</p>}
      <ul className="list-disc space-y-1 pl-4 text-xs text-slate-600">{notes.map((note) => <li key={note}>{note}</li>)}</ul>
    </SectionCard>
  )
}

function topicLabel(letter: Letter) {
  const text = letter.subject.toLowerCase()
  if (text.includes('satellite') || text.includes('technical')) return 'Technical / Procurement'
  if (text.includes('budget')) return 'Financial'
  return 'Administrative'
}

export function AIIntelligencePanel({
  letter,
  letters,
  onApplyField,
  onAcceptAction,
}: {
  letter: Letter
  letters: Letter[]
  onApplyField: (field: string, value: string, decision: AiDecision) => Promise<void>
  onAcceptAction: (action: string, decision: AiDecision) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('Summarize')
  const tabs = ['Summarize', 'Extract Information', 'Classify', 'Recommend Actions', 'Assess Urgency', 'Draft Response', 'Analyze Correspondence']
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <button className="flex w-full items-center justify-between px-4 py-3 text-left lg:cursor-default" onClick={() => setOpen((v) => !v)}>
        <span className="flex items-center gap-2 text-sm font-bold text-slate-700"><Sparkles className="size-4 text-[#1769aa]" /> AI Intelligence Panel</span>
        <ChevronDown className={`size-4 text-slate-400 lg:hidden ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className={`${open ? 'block' : 'hidden'} border-t border-slate-100 lg:block`}>
        <div className="flex gap-1 overflow-x-auto p-3">
          {tabs.map((item) => (
            <button key={item} onClick={() => setTab(item)} className={`whitespace-nowrap rounded-md px-3 py-2 text-xs ${tab === item ? 'bg-blue-50 font-semibold text-[#1769aa]' : 'text-slate-500 hover:bg-slate-50'}`}>{item}</button>
          ))}
        </div>
        <div className="border-t border-slate-100 p-3">
          {tab === 'Summarize' && <AISummary letter={letter} />}
          {tab === 'Extract Information' && <AIExtractionPanel letter={letter} onApply={onApplyField} />}
          {tab === 'Classify' && <AIClassification letter={letter} onApply={onApplyField} />}
          {tab === 'Recommend Actions' && <AIActionRecommendations letter={letter} onAcceptAction={onAcceptAction} />}
          {tab === 'Assess Urgency' && <AIUrgencyAssessment letter={letter} onApply={(priority, decision) => onApplyField('priority', priority, decision)} />}
          {tab === 'Draft Response' && <AIDraftResponse letter={letter} />}
          {tab === 'Analyze Correspondence' && <AIAnalysisPanel letter={letter} letters={letters} />}
        </div>
      </div>
    </section>
  )
}
