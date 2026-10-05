'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, Copy, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CollapsibleCard } from '@/components/ui/collapsible-card'
import { DataTable, type DataTableColumn } from '@/components/cms/data-table'
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
  fetchLetterAiAnalysis,
  generateDraftResponse,
  recommendActions,
  saveLetterAiDecisions,
  summarizeLetter,
  type ActionRecommendation,
  type AiAnalysisKind,
  type AiDecision,
  type AiStatus,
  type ClassificationSuggestion,
  type CorrespondenceAnalysis,
  type DraftResponse,
  type ExtractedField,
  type LetterAiAnalysisBundle,
  type StoredAiAnalysis,
  type UrgencyAssessment,
  type AiSummary,
} from '@/services/ai'
import type { Letter } from '@/services/letters'

type ConfirmTarget = { title: string; current: string; suggested: string; reason?: string; apply: (value: string, decision: AiDecision) => Promise<void> }

type PanelShared = {
  canRegenerate: boolean
  stored?: StoredAiAnalysis | null
  onStored?: (kind: AiAnalysisKind, next: StoredAiAnalysis | null) => void
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    /* ignore */
  }
}

function asRecordDecisions(value: unknown): Record<string, AiDecision> {
  if (!value || typeof value !== 'object') return {}
  return value as Record<string, AiDecision>
}

async function persistDecision(
  letterId: string,
  kind: AiAnalysisKind,
  decisions: Record<string, AiDecision>,
  onStored?: (kind: AiAnalysisKind, next: StoredAiAnalysis | null) => void,
) {
  try {
    const saved = await saveLetterAiDecisions(letterId, kind, decisions)
    onStored?.(kind, saved)
  } catch {
    /* keep UI decision even if persistence fails */
  }
}

export function AISummary({ letter, canRegenerate = false, stored = null, onStored }: { letter: Letter } & PanelShared) {
  const [status, setStatus] = useState<AiStatus>('idle')
  const [data, setData] = useState<AiSummary | null>((stored?.payload as AiSummary | undefined) ?? null)
  const [open, setOpen] = useState(true)
  const [variant, setVariant] = useState(0)
  const load = async (next = variant, force = false) => {
    if (!force && stored?.payload) {
      setData(stored.payload as AiSummary)
      setStatus('success')
      return
    }
    setStatus('analyzing')
    try {
      const result = await summarizeLetter(letter, next, { force })
      setData(result)
      setStatus('success')
      onStored?.('summarize', {
        kind: 'summarize',
        payload: result,
        decisions: stored?.decisions || {},
        meta: { variant: next },
      })
    } catch {
      setStatus('error')
    }
  }
  useEffect(() => {
    if (stored?.payload) {
      setData(stored.payload as AiSummary)
      setStatus('success')
      return
    }
    void load(0, false)
  }, [letter.id, stored?.payload])
  return (
    <SectionCard
      title="AI Summary"
      action={
        <div className="flex gap-2">
          {canRegenerate && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const next = variant + 1
                setVariant(next)
                void load(next, true)
              }}
            >
              Regenerate Summary
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => data && copyText([data.executiveSummary, ...data.keyPoints].join('\n'))}>
            <Copy data-icon="inline-start" />
            Copy Summary
          </Button>
        </div>
      }
    >
      <AIStatusIndicator status={status === 'success' ? 'idle' : status} />
      {stored?.generatedAt && status === 'success' && (
        <p className="mb-2 text-[11px] text-slate-400">Stored analysis · {new Date(stored.generatedAt).toLocaleString()}</p>
      )}
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

export function AIExtractionPanel({
  letter,
  onApply,
  canRegenerate = false,
  stored = null,
  onStored,
}: {
  letter: Letter
  onApply: (field: string, value: string, decision: AiDecision) => Promise<void>
} & PanelShared) {
  const [status, setStatus] = useState<AiStatus>('idle')
  const [fields, setFields] = useState<ExtractedField[]>((stored?.payload as ExtractedField[] | undefined) ?? [])
  const [decisions, setDecisions] = useState<Record<string, AiDecision>>(asRecordDecisions(stored?.decisions))
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [confirm, setConfirm] = useState<ConfirmTarget | null>(null)

  const setDecision = (key: string, decision: AiDecision) => {
    setDecisions((current) => {
      const next = { ...current, [key]: decision }
      void persistDecision(letter.id, 'extract', next, onStored)
      return next
    })
  }

  useEffect(() => {
    if (stored?.payload) {
      setFields(stored.payload as ExtractedField[])
      setDecisions(asRecordDecisions(stored.decisions))
      setStatus('success')
      return
    }
    setStatus('analyzing')
    extractLetterInformation(letter)
      .then((rows) => {
        setFields(rows)
        setStatus('success')
        onStored?.('extract', { kind: 'extract', payload: rows, decisions: {}, meta: {} })
      })
      .catch(() => setStatus('error'))
  }, [letter.id, stored?.payload])

  const officialKeys = new Set(['number', 'letterDate', 'receivedDate', 'from', 'to', 'department', 'subject', 'priority', 'dueDate', 'actionRequired'])
  return (
    <SectionCard
      title="AI Information Extraction"
      action={
        canRegenerate ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setStatus('analyzing')
              extractLetterInformation(letter, { force: true })
                .then((rows) => {
                  setFields(rows)
                  setDecisions({})
                  setStatus('success')
                  onStored?.('extract', { kind: 'extract', payload: rows, decisions: {}, meta: {} })
                })
                .catch(() => setStatus('error'))
            }}
          >
            Regenerate
          </Button>
        ) : undefined
      }
    >
      <AIAdvisoryNote />
      <AIStatusIndicator status={status === 'success' ? 'idle' : status} />
      {stored?.generatedAt && status === 'success' && (
        <p className="mt-1 text-[11px] text-slate-400">Stored analysis · {new Date(stored.generatedAt).toLocaleString()}</p>
      )}
      <div className="mt-3 grid gap-3">
        {fields.map((field) => (
          <AISuggestionCard key={field.key} title={field.label} decision={decisions[field.key]}>
            <div className="flex flex-wrap items-center gap-2">
              <input className="h-9 min-w-[180px] flex-1 rounded-md border border-slate-200 px-2 text-xs" value={edits[field.key] ?? field.value} onChange={(e) => setEdits((current) => ({ ...current, [field.key]: e.target.value }))} />
              <AIConfidenceBadge value={field.confidence} />
            </div>
            {officialKeys.has(field.key) && decisions[field.key] !== 'accepted' && decisions[field.key] !== 'modified' && decisions[field.key] !== 'rejected' && (
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => setConfirm({ title: field.label, current: field.official || '—', suggested: edits[field.key] ?? field.value, apply: (value: string, decision: AiDecision) => onApply(field.key, value, decision).then(() => setDecision(field.key, decision)) })}>Accept</Button>
                <Button size="sm" variant="outline" onClick={() => setConfirm({ title: field.label, current: field.official || '—', suggested: edits[field.key] ?? field.value, apply: (value: string, decision: AiDecision) => onApply(field.key, value, decision).then(() => setDecision(field.key, decision)) })}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => setDecision(field.key, 'rejected')}>Reject</Button>
              </div>
            )}
          </AISuggestionCard>
        ))}
      </div>
      {confirm && <AIConfirmationDialog title={confirm.title} current={confirm.current} suggested={confirm.suggested} onClose={() => setConfirm(null)} onReject={() => { void confirm.apply(confirm.current, 'rejected'); setConfirm(null) }} onAccept={async () => { await confirm.apply(confirm.suggested, 'accepted'); setConfirm(null) }} onEdit={async (value) => { await confirm.apply(value, 'modified'); setConfirm(null) }} />}
    </SectionCard>
  )
}

export function AIClassification({
  letter,
  onApply,
  canRegenerate = false,
  stored = null,
  onStored,
}: {
  letter: Letter
  onApply: (field: string, value: string, decision: AiDecision) => Promise<void>
} & PanelShared) {
  const [status, setStatus] = useState<AiStatus>('idle')
  const [items, setItems] = useState<ClassificationSuggestion[]>((stored?.payload as ClassificationSuggestion[] | undefined) ?? [])
  const [decisions, setDecisions] = useState<Record<string, AiDecision>>(asRecordDecisions(stored?.decisions))
  const [confirm, setConfirm] = useState<ConfirmTarget | null>(null)

  const setDecision = (key: string, decision: AiDecision) => {
    setDecisions((current) => {
      const next = { ...current, [key]: decision }
      void persistDecision(letter.id, 'classify', next, onStored)
      return next
    })
  }

  useEffect(() => {
    if (stored?.payload) {
      setItems(stored.payload as ClassificationSuggestion[])
      setDecisions(asRecordDecisions(stored.decisions))
      setStatus('success')
      return
    }
    setStatus('analyzing')
    classifyLetter(letter)
      .then((rows) => {
        setItems(rows)
        setStatus('success')
        onStored?.('classify', { kind: 'classify', payload: rows, decisions: {}, meta: {} })
      })
      .catch(() => setStatus('error'))
  }, [letter.id, stored?.payload])

  const current: Record<string, string> = { category: letter.type, subjectCategory: '—', department: letter.department, priority: letter.priority, confidentiality: letter.confidentiality || 'Normal' }
  return (
    <SectionCard
      title="AI Classification"
      action={
        canRegenerate ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setStatus('analyzing')
              classifyLetter(letter, { force: true })
                .then((rows) => {
                  setItems(rows)
                  setDecisions({})
                  setStatus('success')
                  onStored?.('classify', { kind: 'classify', payload: rows, decisions: {}, meta: {} })
                })
                .catch(() => setStatus('error'))
            }}
          >
            Regenerate
          </Button>
        ) : undefined
      }
    >
      <AIStatusIndicator status={status === 'success' ? 'idle' : status} />
      {stored?.generatedAt && status === 'success' && (
        <p className="mb-2 text-[11px] text-slate-400">Stored analysis · {new Date(stored.generatedAt).toLocaleString()}</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <AISuggestionCard key={item.field} title={item.label} decision={decisions[item.field]}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-700">{item.value}</p>
              <AIConfidenceBadge value={item.confidence} />
            </div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={() => setConfirm({ title: item.label, current: current[item.field] || '—', suggested: item.value, apply: (value: string, decision: AiDecision) => onApply(item.field, value, decision).then(() => setDecision(item.field, decision)) })}>Accept</Button>
              <Button size="sm" variant="ghost" onClick={() => setDecision(item.field, 'rejected')}>Reject</Button>
            </div>
          </AISuggestionCard>
        ))}
      </div>
      {confirm && <AIConfirmationDialog title={confirm.title} current={confirm.current} suggested={confirm.suggested} onClose={() => setConfirm(null)} onReject={() => { void confirm.apply(confirm.current, 'rejected'); setConfirm(null) }} onAccept={async () => { await confirm.apply(confirm.suggested, 'accepted'); setConfirm(null) }} onEdit={async (value) => { await confirm.apply(value, 'modified'); setConfirm(null) }} />}
    </SectionCard>
  )
}

export function AIActionRecommendations({
  letter,
  onAcceptAction,
  canRegenerate = false,
  stored = null,
  onStored,
}: {
  letter: Letter
  onAcceptAction: (action: string, decision: AiDecision) => Promise<void>
} & PanelShared) {
  const [status, setStatus] = useState<AiStatus>('idle')
  const [rows, setRows] = useState<ActionRecommendation[]>((stored?.payload as ActionRecommendation[] | undefined) ?? [])
  const [decisions, setDecisions] = useState<Record<string, AiDecision>>(asRecordDecisions(stored?.decisions))
  const [confirm, setConfirm] = useState<ActionRecommendation | null>(null)

  const setDecision = (key: string, decision: AiDecision) => {
    setDecisions((current) => {
      const next = { ...current, [key]: decision }
      void persistDecision(letter.id, 'recommend_actions', next, onStored)
      return next
    })
  }

  useEffect(() => {
    if (stored?.payload) {
      setRows(stored.payload as ActionRecommendation[])
      setDecisions(asRecordDecisions(stored.decisions))
      setStatus('success')
      return
    }
    setStatus('analyzing')
    recommendActions(letter)
      .then((items) => {
        setRows(items)
        setStatus('success')
        onStored?.('recommend_actions', { kind: 'recommend_actions', payload: items, decisions: {}, meta: {} })
      })
      .catch(() => setStatus('error'))
  }, [letter.id, stored?.payload])

  return (
    <SectionCard
      title="AI Recommended Actions"
      action={
        canRegenerate ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setStatus('analyzing')
              recommendActions(letter, { force: true })
                .then((items) => {
                  setRows(items)
                  setDecisions({})
                  setStatus('success')
                  onStored?.('recommend_actions', { kind: 'recommend_actions', payload: items, decisions: {}, meta: {} })
                })
                .catch(() => setStatus('error'))
            }}
          >
            Regenerate
          </Button>
        ) : undefined
      }
    >
      <AIAdvisoryNote />
      <AIStatusIndicator status={status === 'success' ? 'idle' : status} />
      {stored?.generatedAt && status === 'success' && (
        <p className="mt-1 text-[11px] text-slate-400">Stored analysis · {new Date(stored.generatedAt).toLocaleString()}</p>
      )}
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
                <Button size="sm" variant="ghost" onClick={() => setDecision(row.id, 'rejected')}>Reject</Button>
              </div>
            )}
          </AISuggestionCard>
        ))}
      </div>
      {confirm && <AIConfirmationDialog title="Add recommended action" current={letter.lastAction} suggested={confirm.action} reason={confirm.reason} onClose={() => setConfirm(null)} onReject={() => { setDecision(confirm.id, 'rejected'); setConfirm(null) }} onAccept={async () => { await onAcceptAction(confirm.action, 'accepted'); setDecision(confirm.id, 'accepted'); setConfirm(null) }} onEdit={async (value) => { await onAcceptAction(value, 'modified'); setDecision(confirm.id, 'modified'); setConfirm(null) }} />}
    </SectionCard>
  )
}

export function AIUrgencyAssessment({
  letter,
  onApply,
  canRegenerate = false,
  stored = null,
  onStored,
}: {
  letter: Letter
  onApply: (priority: string, decision: AiDecision) => Promise<void>
} & PanelShared) {
  const [status, setStatus] = useState<AiStatus>('idle')
  const [data, setData] = useState<UrgencyAssessment | null>((stored?.payload as UrgencyAssessment | undefined) ?? null)
  const [confirm, setConfirm] = useState(false)
  const [decision, setDecision] = useState<AiDecision>((stored?.decisions?.priority as AiDecision | undefined) || 'pending')

  useEffect(() => {
    if (stored?.payload) {
      setData(stored.payload as UrgencyAssessment)
      setDecision((stored.decisions?.priority as AiDecision | undefined) || 'pending')
      setStatus('success')
      return
    }
    setStatus('analyzing')
    assessUrgency(letter)
      .then((row) => {
        setData(row)
        setStatus('success')
        onStored?.('urgency', { kind: 'urgency', payload: row, decisions: {}, meta: {} })
      })
      .catch(() => setStatus('error'))
  }, [letter.id, stored?.payload])

  const applyDecision = (next: AiDecision) => {
    setDecision(next)
    void persistDecision(letter.id, 'urgency', { priority: next }, onStored)
  }

  return (
    <SectionCard
      title="AI Urgency Assessment"
      action={
        <div className="flex gap-2">
          {canRegenerate && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setStatus('analyzing')
                assessUrgency(letter, { force: true })
                  .then((row) => {
                    setData(row)
                    setDecision('pending')
                    setStatus('success')
                    onStored?.('urgency', { kind: 'urgency', payload: row, decisions: {}, meta: {} })
                  })
                  .catch(() => setStatus('error'))
              }}
            >
              Regenerate
            </Button>
          )}
          {data && <Button size="sm" onClick={() => setConfirm(true)}>Apply Suggested Priority</Button>}
        </div>
      }
    >
      <AIStatusIndicator status={status === 'success' ? 'idle' : status} />
      {stored?.generatedAt && status === 'success' && (
        <p className="mb-2 text-[11px] text-slate-400">Stored analysis · {new Date(stored.generatedAt).toLocaleString()}</p>
      )}
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
      {confirm && data && <AIConfirmationDialog title="Apply suggested priority" current={letter.priority} suggested={data.priority} reason={data.reasons[0]} onClose={() => setConfirm(false)} onReject={() => { applyDecision('rejected'); setConfirm(false) }} onAccept={async () => { await onApply(data.priority, 'accepted'); applyDecision('accepted'); setConfirm(false) }} onEdit={async (value) => { await onApply(value, 'modified'); applyDecision('modified'); setConfirm(false) }} />}
    </SectionCard>
  )
}

export function AIDraftResponse({ letter, canRegenerate = false, stored = null, onStored }: { letter: Letter } & PanelShared) {
  const [status, setStatus] = useState<AiStatus>('idle')
  const [draft, setDraft] = useState<DraftResponse | null>((stored?.payload as DraftResponse | undefined) ?? null)
  const [text, setText] = useState((stored?.payload as DraftResponse | undefined)?.text || '')
  const load = async (style: 'default' | 'shorten' | 'expand' | 'formal' | 'concise' = 'default', force = false) => {
    if (!force && style === 'default' && stored?.payload) {
      const cached = stored.payload as DraftResponse
      setDraft(cached)
      setText(cached.text)
      setStatus('success')
      return
    }
    setStatus('generating')
    try {
      const next = await generateDraftResponse(letter, style, { force: force || style !== 'default' })
      setDraft(next)
      setText(next.text)
      setStatus('success')
      onStored?.('draft_response', { kind: 'draft_response', payload: next, decisions: {}, meta: { style } })
    } catch {
      setStatus('error')
    }
  }
  useEffect(() => {
    if (stored?.payload) {
      const cached = stored.payload as DraftResponse
      setDraft(cached)
      setText(cached.text)
      setStatus('success')
      return
    }
    void load('default', false)
  }, [letter.id, stored?.payload])
  return (
    <SectionCard
      title="AI Draft Response"
      action={
        <div className="flex flex-wrap gap-2">
          {canRegenerate && (
            <Button size="sm" variant="outline" onClick={() => void load('default', true)}>
              Regenerate
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => void copyText(text)}>
            <Copy data-icon="inline-start" />
            Copy Draft
          </Button>
        </div>
      }
    >
      <p className="mb-3 text-[11px] text-slate-400">AI-generated text is only a draft. It does not become an official outgoing letter.</p>
      <AIStatusIndicator status={status === 'success' ? 'idle' : status} />
      {stored?.generatedAt && status === 'success' && (
        <p className="mb-2 text-[11px] text-slate-400">Stored analysis · {new Date(stored.generatedAt).toLocaleString()}</p>
      )}
      {draft && (
        <>
          {canRegenerate && (
            <div className="mb-3 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => void load('shorten', true)}>Shorten</Button>
              <Button size="sm" variant="outline" onClick={() => void load('expand', true)}>Expand</Button>
              <Button size="sm" variant="outline" onClick={() => void load('formal', true)}>Make more formal</Button>
              <Button size="sm" variant="outline" onClick={() => void load('concise', true)}>Make more concise</Button>
            </div>
          )}
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

export function AIAnalysisPanel({
  letter,
  letters,
  canRegenerate = false,
  stored = null,
  onStored,
}: {
  letter: Letter
  letters: Letter[]
} & PanelShared) {
  const [status, setStatus] = useState<AiStatus>('idle')
  const [data, setData] = useState<CorrespondenceAnalysis | null>((stored?.payload as CorrespondenceAnalysis | undefined) ?? null)
  const [localCanRegenerate, setLocalCanRegenerate] = useState(canRegenerate)
  const [localStored, setLocalStored] = useState(stored)

  useEffect(() => {
    setLocalCanRegenerate(canRegenerate)
    setLocalStored(stored)
  }, [canRegenerate, stored])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (localStored?.payload) {
        setData(localStored.payload as CorrespondenceAnalysis)
        setStatus('success')
        return
      }
      // Standalone page may not receive a parent bundle — load stored first.
      if (!stored) {
        try {
          const bundle = await fetchLetterAiAnalysis(letter.id)
          if (cancelled) return
          setLocalCanRegenerate(bundle.canRegenerate)
          const row = bundle.analyses.analyze_correspondence ?? null
          if (row?.payload) {
            setLocalStored(row)
            setData(row.payload as CorrespondenceAnalysis)
            setStatus('success')
            return
          }
        } catch {
          /* fall through to generate */
        }
      }
      setStatus('analyzing')
      try {
        const row = await analyzeCorrespondence(letter, letters)
        if (cancelled) return
        setData(row)
        setStatus('success')
        onStored?.('analyze_correspondence', { kind: 'analyze_correspondence', payload: row, decisions: {}, meta: {} })
      } catch {
        if (!cancelled) setStatus('error')
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [letter.id, localStored?.payload])

  return (
    <SectionCard
      title="Correspondence analysis"
      action={
        localCanRegenerate ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setStatus('analyzing')
              analyzeCorrespondence(letter, letters, { force: true })
                .then((row) => {
                  setData(row)
                  setStatus('success')
                  const next = { kind: 'analyze_correspondence' as const, payload: row, decisions: {}, meta: {} }
                  setLocalStored(next)
                  onStored?.('analyze_correspondence', next)
                })
                .catch(() => setStatus('error'))
            }}
          >
            Regenerate
          </Button>
        ) : undefined
      }
    >
      <AIStatusIndicator status={status === 'success' ? 'idle' : status} />
      {localStored?.generatedAt && status === 'success' && (
        <p className="mb-2 text-[11px] text-slate-400">Stored analysis · {new Date(localStored.generatedAt).toLocaleString()}</p>
      )}
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
          <DataTable
            bordered={false}
            columns={[
              {
                id: 'stage',
                header: 'Stage',
                sortValue: (event) => event.label,
                className: 'font-semibold text-slate-700',
                cell: (event) => (
                  <>
                    {event.label}
                    {event.delay ? <AiBadge tone="red">Delay</AiBadge> : null}
                  </>
                ),
              },
              { id: 'date', header: 'Date', sortValue: (event) => event.date, className: 'text-slate-500', cell: (event) => event.date },
              { id: 'note', header: 'Note', sortValue: (event) => event.note, className: 'text-slate-600', cell: (event) => event.note },
            ] satisfies DataTableColumn<{ label: string; date: string; note: string; delay?: boolean }>[]}
            data={data.timeline}
            rowKey={(event) => event.label}
            storageKey="ai-analysis-timeline"
            minWidth="520px"
            maxHeight="min(280px, 40vh)"
          />
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
    <CollapsibleCard
      title="Attachment analysis"
      action={<Button size="sm" variant="outline" onClick={() => void run()}>AI Analyze Document</Button>}
    >
      <AIStatusIndicator status={status === 'success' ? 'idle' : status} />
      {notes.length === 0 && status === 'idle' && <p className="text-xs text-slate-500">Mock document analysis is available. No OCR or live model is used.</p>}
      <ul className="list-disc space-y-1 pl-4 text-xs text-slate-600">{notes.map((note) => <li key={note}>{note}</li>)}</ul>
    </CollapsibleCard>
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
  const [tab, setTab] = useState('Summarize')
  const [bundle, setBundle] = useState<LetterAiAnalysisBundle | null>(null)
  const tabs = ['Summarize', 'Extract Information', 'Classify', 'Recommend Actions', 'Assess Urgency', 'Draft Response', 'Analyze Correspondence']

  useEffect(() => {
    let cancelled = false
    setBundle(null)
    fetchLetterAiAnalysis(letter.id)
      .then((next) => {
        if (!cancelled) setBundle(next)
      })
      .catch(() => {
        if (!cancelled) setBundle({ letterId: Number(letter.id), canRegenerate: false, analyses: {} })
      })
    return () => {
      cancelled = true
    }
  }, [letter.id])

  const canRegenerate = bundle?.canRegenerate ?? false
  const storedOf = (kind: AiAnalysisKind) => bundle?.analyses[kind] ?? null
  const onStored = (kind: AiAnalysisKind, next: StoredAiAnalysis | null) => {
    setBundle((current) => {
      const base = current ?? { letterId: Number(letter.id), canRegenerate, analyses: {} }
      return {
        ...base,
        analyses: {
          ...base.analyses,
          [kind]: next,
        },
      }
    })
  }

  const shared = (kind: AiAnalysisKind): PanelShared => ({
    canRegenerate,
    stored: storedOf(kind),
    onStored,
  })

  return (
    <CollapsibleCard
      title={
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-700">
          <Sparkles className="size-4 text-[#1769aa]" />
          AI Intelligence Panel
        </h2>
      }
      contentClassName="p-0 sm:p-0"
    >
      <div className="flex gap-1 overflow-x-auto px-3 pt-0 pb-3 sm:px-4">
        {tabs.map((item) => (
          <button key={item} onClick={() => setTab(item)} className={`whitespace-nowrap rounded-md px-3 py-2 text-xs ${tab === item ? 'bg-blue-50 font-semibold text-[#1769aa]' : 'text-slate-500 hover:bg-slate-50'}`}>{item}</button>
        ))}
      </div>
      <div className="border-t border-slate-100 p-3">
        {!bundle ? (
          <p className="text-[11px] text-slate-400">Loading stored AI analysis…</p>
        ) : (
          <>
            {tab === 'Summarize' && <AISummary letter={letter} {...shared('summarize')} />}
            {tab === 'Extract Information' && <AIExtractionPanel letter={letter} onApply={onApplyField} {...shared('extract')} />}
            {tab === 'Classify' && <AIClassification letter={letter} onApply={onApplyField} {...shared('classify')} />}
            {tab === 'Recommend Actions' && <AIActionRecommendations letter={letter} onAcceptAction={onAcceptAction} {...shared('recommend_actions')} />}
            {tab === 'Assess Urgency' && <AIUrgencyAssessment letter={letter} onApply={(priority, decision) => onApplyField('priority', priority, decision)} {...shared('urgency')} />}
            {tab === 'Draft Response' && <AIDraftResponse letter={letter} {...shared('draft_response')} />}
            {tab === 'Analyze Correspondence' && <AIAnalysisPanel letter={letter} letters={letters} {...shared('analyze_correspondence')} />}
          </>
        )}
      </div>
    </CollapsibleCard>
  )
}
