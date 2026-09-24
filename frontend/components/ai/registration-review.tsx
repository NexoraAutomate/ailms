'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppData } from '@/components/app-provider'
import { AIAdvisoryNote } from '@/components/ai/common'
import { Badge, Card, PageTitle } from '@/components/cms/ui'
import { Button } from '@/components/ui/button'
import {
  approveRegistrationJob,
  getRegistrationJob,
  patchRegistrationProposal,
  rejectRegistrationJob,
  resolveStagedPreviewUrl,
  rerunRegistrationJob,
  type AiRegistrationEvidence,
  type AiRegistrationJob,
  type AiRegistrationJobStatus,
} from '@/services/ai-registration'

const EDITABLE_FIELDS = [
  'number',
  'letterDate',
  'receivedDate',
  'type',
  'subject',
  'from',
  'to',
  'department',
  'priority',
  'dueDate',
  'assignedTo',
  'confidentiality',
  'actionRequired',
  'remarks',
  'summary',
  'documentCategory',
  'relatedLetterNumbers',
] as const

type EditableField = (typeof EDITABLE_FIELDS)[number]

type FormState = Record<EditableField, string>

const FIELD_LABELS: Record<EditableField, string> = {
  number: 'Letter number *',
  letterDate: 'Letter date *',
  receivedDate: 'Received date',
  type: 'Letter type',
  subject: 'Subject *',
  from: 'From',
  to: 'To',
  department: 'Department',
  priority: 'Priority',
  dueDate: 'Due date',
  assignedTo: 'Assigned to',
  confidentiality: 'Confidentiality',
  actionRequired: 'Action required',
  remarks: 'Remarks',
  summary: 'Summary',
  documentCategory: 'Document category',
  relatedLetterNumbers: 'Related letter numbers',
}

const DATE_FIELDS = new Set<EditableField>(['letterDate', 'receivedDate', 'dueDate'])
const TEXTAREA_FIELDS = new Set<EditableField>(['remarks', 'summary', 'actionRequired'])

const EMPTY_FORM: FormState = {
  number: '',
  letterDate: '',
  receivedDate: '',
  type: '',
  subject: '',
  from: '',
  to: '',
  department: '',
  priority: '',
  dueDate: '',
  assignedTo: '',
  confidentiality: '',
  actionRequired: '',
  remarks: '',
  summary: '',
  documentCategory: '',
  relatedLetterNumbers: '',
}

function proposalToForm(proposal: Record<string, unknown> | null | undefined): FormState {
  const next = { ...EMPTY_FORM }
  if (!proposal) return next
  for (const key of EDITABLE_FIELDS) {
    const raw = proposal[key]
    if (key === 'relatedLetterNumbers') {
      next[key] = Array.isArray(raw)
        ? raw.map((item) => String(item)).filter(Boolean).join(', ')
        : raw == null
          ? ''
          : String(raw)
      continue
    }
    if (raw == null) {
      next[key] = ''
      continue
    }
    next[key] = String(raw)
  }
  return next
}

function formValueForPatch(key: EditableField, value: string): unknown {
  if (key === 'relatedLetterNumbers') {
    return value
      .split(/[,;\n]/)
      .map((part) => part.trim())
      .filter(Boolean)
  }
  return value
}

function statusTone(status: AiRegistrationJobStatus): string {
  if (status === 'NEEDS_REVIEW') return 'amber'
  if (status === 'REJECTED' || status === 'FAILED') return 'red'
  if (status === 'REGISTERED' || status === 'APPROVED') return 'green'
  return 'slate'
}

function issuesForField(
  job: AiRegistrationJob | null,
  field: string,
): { message: string }[] {
  const issues = job?.validation?.fieldIssues?.[field]
  if (!Array.isArray(issues) || !issues.length) return []
  return issues.map((item) => ({
    message: typeof item.message === 'string' ? item.message : String(item.code ?? 'Issue'),
  }))
}

function evidenceForField(evidence: AiRegistrationEvidence[] | undefined, field: string) {
  if (!evidence?.length) return []
  return evidence.filter((item) => item.field === field && (item.snippet || item.page != null))
}

export function RegistrationReview({
  jobId,
  go,
}: {
  jobId: string
  go: (target: string) => void
}) {
  const { departments, users, masterData } = useAppData()
  const [job, setJob] = useState<AiRegistrationJob | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [baseline, setBaseline] = useState<FormState>(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [savedMsg, setSavedMsg] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const [showReject, setShowReject] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [expandedEvidence, setExpandedEvidence] = useState<Record<string, boolean>>({})

  const applyJob = useCallback((next: AiRegistrationJob) => {
    setJob(next)
    const proposal =
      next.proposal && !Array.isArray(next.proposal) ? (next.proposal as Record<string, unknown>) : null
    const mapped = proposalToForm(proposal)
    setForm(mapped)
    setBaseline(mapped)
  }, [])

  const load = useCallback(async () => {
    setError('')
    setLoading(true)
    try {
      const next = await getRegistrationJob(jobId)
      applyJob(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load review job')
      setJob(null)
    } finally {
      setLoading(false)
    }
  }, [applyJob, jobId])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = useMemo(
    () => EDITABLE_FIELDS.some((key) => form[key] !== baseline[key]),
    [baseline, form],
  )

  const requiredOk = Boolean(form.number.trim() && form.letterDate.trim() && form.subject.trim())
  const editable = job?.status === 'NEEDS_REVIEW'
  const previewUrl = resolveStagedPreviewUrl(job?.stagedDocument)
  const isImage = Boolean(job?.stagedDocument?.mimeType?.startsWith('image/'))
  const aiSet = useMemo(() => new Set(job?.aiGenerated ?? []), [job?.aiGenerated])
  const overrides = job?.userOverrides ?? {}

  const setField = (key: EditableField, value: string) => {
    setForm((current) => ({ ...current, [key]: value }))
    setSavedMsg('')
  }

  const saveEdits = async () => {
    setError('')
    setSavedMsg('')
    if (!editable) {
      setError('Proposal can only be edited while the job needs review.')
      return
    }
    const updates: Record<string, unknown> = {}
    for (const key of EDITABLE_FIELDS) {
      if (form[key] === baseline[key]) continue
      updates[key] = formValueForPatch(key, form[key])
    }
    if (!Object.keys(updates).length) {
      setSavedMsg('No changes to save.')
      return
    }
    setBusy(true)
    try {
      const next = await patchRegistrationProposal(jobId, updates)
      applyJob(next)
      setSavedMsg('Edits saved to proposal. No letter has been created yet.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save proposal')
    } finally {
      setBusy(false)
    }
  }

  const reject = async () => {
    setError('')
    setBusy(true)
    try {
      const next = await rejectRegistrationJob(jobId, rejectReason.trim())
      applyJob(next)
      setShowReject(false)
      setSavedMsg('Job rejected. Artifacts retained; no letter created.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject job')
    } finally {
      setBusy(false)
    }
  }

  const rerun = async () => {
    setError('')
    setBusy(true)
    try {
      await rerunRegistrationJob(jobId)
      go('/letters/register')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to re-queue analysis')
      setBusy(false)
    }
  }

  const approve = async () => {
    setError('')
    setSavedMsg('')
    if (!editable) {
      setError('Only jobs that need review can be approved.')
      return
    }
    if (dirty) {
      setError('Save edits before approving.')
      return
    }
    if (!requiredOk) {
      setError('Letter number, letter date, and subject are required.')
      return
    }
    if (!confirmed) {
      setError('Confirm that you have reviewed the proposal before approving.')
      return
    }
    setBusy(true)
    try {
      const result = await approveRegistrationJob(jobId, true)
      setSavedMsg(`Letter registered (${result.number}).`)
      setTimeout(() => go(result.letterId), 400)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve registration')
      setBusy(false)
    }
  }

  const documentTypes = masterData['Document Types'] ?? ['Original Letter', 'Scanned Letter', 'Supporting Document']
  const letterTypes = masterData['Letter Types'] ?? ['Incoming', 'Outgoing']
  const priorities = masterData.Priorities ?? ['Routine', 'Important', 'Urgent']
  const confidentiality = masterData['Confidentiality Levels'] ?? ['Normal']

  const renderFieldControl = (key: EditableField) => {
    const value = form[key]
    const common = 'h-10 rounded-md border border-slate-200 bg-white px-3 text-xs disabled:bg-slate-50'
    if (key === 'type') {
      return (
        <select value={value} disabled={!editable || busy} onChange={(e) => setField(key, e.target.value)} className={common}>
          <option value="">Select…</option>
          {letterTypes.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      )
    }
    if (key === 'priority') {
      return (
        <select value={value} disabled={!editable || busy} onChange={(e) => setField(key, e.target.value)} className={common}>
          <option value="">Select…</option>
          {priorities.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      )
    }
    if (key === 'confidentiality') {
      return (
        <select value={value} disabled={!editable || busy} onChange={(e) => setField(key, e.target.value)} className={common}>
          <option value="">Select…</option>
          {confidentiality.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      )
    }
    if (key === 'department') {
      return (
        <select value={value} disabled={!editable || busy} onChange={(e) => setField(key, e.target.value)} className={common}>
          <option value="">Select…</option>
          {departments.map((d) => (
            <option key={d.code} value={d.name}>
              {d.name}
            </option>
          ))}
        </select>
      )
    }
    if (key === 'assignedTo') {
      return (
        <select value={value} disabled={!editable || busy} onChange={(e) => setField(key, e.target.value)} className={common}>
          <option value="">Select…</option>
          {users.map((u) => (
            <option key={u.username} value={u.name}>
              {u.name}
            </option>
          ))}
        </select>
      )
    }
    if (key === 'documentCategory') {
      return (
        <select value={value} disabled={!editable || busy} onChange={(e) => setField(key, e.target.value)} className={common}>
          <option value="">Select…</option>
          {documentTypes.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      )
    }
    if (DATE_FIELDS.has(key)) {
      return (
        <input
          type="date"
          value={value}
          disabled={!editable || busy}
          onChange={(e) => setField(key, e.target.value)}
          className={common}
        />
      )
    }
    if (TEXTAREA_FIELDS.has(key)) {
      return (
        <textarea
          rows={3}
          value={value}
          disabled={!editable || busy}
          onChange={(e) => setField(key, e.target.value)}
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs disabled:bg-slate-50"
        />
      )
    }
    return (
      <input
        value={value}
        disabled={!editable || busy}
        onChange={(e) => setField(key, e.target.value)}
        placeholder={key === 'relatedLetterNumbers' ? 'Comma-separated numbers' : undefined}
        className={common}
      />
    )
  }

  if (loading) {
    return (
      <>
        <PageTitle title="Review AI proposal" description="Loading job…" />
        <Card className="p-6">
          <p className="text-xs text-slate-500">Loading proposal for job {jobId}…</p>
        </Card>
      </>
    )
  }

  if (!job) {
    return (
      <>
        <PageTitle
          title="Review AI proposal"
          description="Unable to load this registration job."
          action={
            <Button variant="outline" onClick={() => go('/letters/register')}>
              Back to register
            </Button>
          }
        />
        <Card className="p-6">
          <p className="text-xs text-red-600">{error || 'Job not found.'}</p>
        </Card>
      </>
    )
  }

  return (
    <>
      <PageTitle
        title="Review AI proposal"
        description="Edit extracted fields against the source document. Nothing is registered until you approve."
        action={
          <Button variant="outline" onClick={() => go('/letters/register')}>
            Back to register
          </Button>
        }
      />
      <div className="mb-3">
        <AIAdvisoryNote />
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span>
          Job <span className="font-semibold text-slate-800">{job.jobId}</span>
        </span>
        <Badge tone={statusTone(job.status)}>{job.status}</Badge>
        {job.validation?.passed === false && <Badge tone="red">Validation issues</Badge>}
        {job.validation?.passed === true && <Badge tone="green">Validation passed</Badge>}
        {job.stagedDocument?.originalFilename && (
          <span className="text-slate-400">{job.stagedDocument.originalFilename}</span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex min-h-[70vh] flex-col overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-bold text-slate-700">Source document</h2>
            <p className="text-xs text-slate-400">Preview of the staged upload used for OCR and extraction.</p>
          </div>
          <div className="min-h-0 flex-1 bg-slate-50 p-3">
            {!previewUrl ? (
              <p className="text-xs text-slate-500">No preview available for this job.</p>
            ) : isImage ? (
              <img src={previewUrl} alt="Staged document" className="mx-auto max-h-[calc(70vh-4rem)] max-w-full object-contain" />
            ) : (
              <iframe title="Staged document preview" src={previewUrl} className="h-[calc(70vh-4rem)] w-full rounded border border-slate-200 bg-white" />
            )}
          </div>
        </Card>

        <Card className="flex min-h-[70vh] flex-col overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-bold text-slate-700">Proposed fields</h2>
            <p className="text-xs text-slate-400">AI-sourced values are marked. Save edits to update the proposal only.</p>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {job.validation?.blockingErrors && job.validation.blockingErrors.length > 0 && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                <p className="font-semibold">Blocking validation errors</p>
                <ul className="mt-1 list-disc pl-4">
                  {job.validation.blockingErrors.map((item, index) => (
                    <li key={index}>{typeof item === 'string' ? item : JSON.stringify(item)}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              {EDITABLE_FIELDS.map((key) => {
                const fieldIssues = issuesForField(job, key)
                const evidence = evidenceForField(job.evidence ?? undefined, key)
                const overridden = Boolean(overrides?.[key])
                return (
                  <label
                    key={key}
                    className={`flex flex-col gap-1.5 ${key === 'subject' || TEXTAREA_FIELDS.has(key) || key === 'relatedLetterNumbers' || key === 'summary' ? 'sm:col-span-2' : ''}`}
                  >
                    <span className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-slate-600">
                      {FIELD_LABELS[key]}
                      {aiSet.has(key) && <Badge tone="blue">AI</Badge>}
                      {overridden && <Badge tone="indigo">Edited</Badge>}
                    </span>
                    {renderFieldControl(key)}
                    {fieldIssues.map((issue, index) => (
                      <span key={index} className="text-[11px] text-red-600">
                        {issue.message}
                      </span>
                    ))}
                    {evidence.length > 0 && (
                      <div className="text-[11px] text-slate-500">
                        <button
                          type="button"
                          className="font-semibold text-[#1769aa]"
                          onClick={() =>
                            setExpandedEvidence((current) => ({ ...current, [key]: !current[key] }))
                          }
                        >
                          {expandedEvidence[key] ? 'Hide source' : 'Show source'} ({evidence.length})
                        </button>
                        {expandedEvidence[key] && (
                          <ul className="mt-1 space-y-1 rounded border border-slate-100 bg-slate-50 px-2 py-1.5">
                            {evidence.map((item, index) => (
                              <li key={index}>
                                {item.page != null && <span className="font-semibold">p.{item.page}: </span>}
                                <span className="text-slate-600">{item.snippet || '—'}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </label>
                )
              })}
            </div>
          </div>

          <div className="space-y-3 border-t border-slate-100 bg-slate-50 px-4 py-4">
            <label className="flex items-start gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                disabled={!editable}
              />
              <span>I confirm I have reviewed the document and fields.</span>
            </label>

            {showReject && (
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-slate-600">Rejection reason (optional)</span>
                  <textarea
                    rows={2}
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    className="rounded-md border border-slate-200 px-3 py-2 text-xs"
                  />
                </label>
                <div className="mt-2 flex gap-2">
                  <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={reject}>
                    Confirm reject
                  </Button>
                  <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setShowReject(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {error && <p className="text-xs text-red-600">{error}</p>}
            {savedMsg && <p className="text-xs text-emerald-700">{savedMsg}</p>}

            <div className="flex flex-wrap justify-end gap-2">
              {editable && (
                <Button type="button" variant="outline" disabled={busy} onClick={() => setShowReject(true)}>
                  Reject
                </Button>
              )}
              {editable && (
                <Button type="button" variant="outline" disabled={busy} onClick={rerun}>
                  Re-run analysis
                </Button>
              )}
              <Button type="button" variant="outline" disabled={busy || !editable || !dirty} onClick={saveEdits}>
                {busy ? 'Saving…' : 'Save edits'}
              </Button>
              <Button
                type="button"
                disabled={busy || !editable || dirty || !requiredOk || !confirmed}
                title={
                  dirty
                    ? 'Save edits before approving'
                    : !confirmed
                      ? 'Confirm review before approving'
                      : !requiredOk
                        ? 'Fill required fields first'
                        : 'Create the official letter from this proposal'
                }
                onClick={approve}
              >
                {busy ? 'Registering…' : 'Approve & register'}
              </Button>
            </div>
            <p className="text-[11px] text-slate-400">
              Required for approval: letter number, letter date, and subject
              {requiredOk ? ' — currently filled' : ' — incomplete'}
              {confirmed ? '; review confirmed' : '; review not yet confirmed'}
              {dirty ? '; unsaved edits' : ''}.
            </p>
          </div>
        </Card>
      </div>
    </>
  )
}
