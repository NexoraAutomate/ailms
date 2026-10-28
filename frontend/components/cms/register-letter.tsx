'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAppData } from '@/components/app-provider'
import { Button } from '@/components/ui/button'
import { AppTabPanel, appTabClass } from '@/components/ui/app-tabs'
import { Card, PageTitle } from '@/components/cms/ui'
import { RegistrationUpload } from '@/components/ai/registration-upload'
import { AppSelect } from '@/components/ui/app-select'
import { createRelation, listRelationTypes } from '@/services/correspondence'
import { uploadLetterDocument } from '@/services/documents'
import type { Letter, LetterStatus } from '@/services/letters'
import { cn } from '@/lib/utils'

export type PendingReferenceLink = {
  key: string
  letterId: string
  relationshipType: string
  remarks: string
  file: File | null
}

type RegisterMode = 'manual' | 'upload'
type LetterPurpose = 'Actionable' | 'Information'

const LETTER_TYPES = ['Incoming', 'Outgoing'] as const
const DEFAULT_PRIORITIES = ['Routine', 'Important', 'Urgent', 'Immediate', 'Most Immediate']
const DEFAULT_CONFIDENTIALITY = ['Normal', 'Confidential', 'Restricted', 'Secret']

export function Register({ go }: { go: (p: string) => void }) {
  const { registerLetter, departments, organizations, masterData, letters, me } = useAppData()
  const [mode, setMode] = useState<RegisterMode>('manual')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [numberError, setNumberError] = useState('')
  const [copyError, setCopyError] = useState('')
  const [duplicateLetter, setDuplicateLetter] = useState<Letter | null>(null)
  const [receivedDateTouched, setReceivedDateTouched] = useState(false)
  const documentTypes = masterData['Document Types'] ?? ['Original Letter', 'Scanned Letter', 'Supporting Document', 'Reference Document']
  const [letterCopyType, setLetterCopyType] = useState(documentTypes.includes('Original Letter') ? 'Original Letter' : documentTypes[0])
  const [letterCopyFile, setLetterCopyFile] = useState<File | null>(null)
  const [relationTypes, setRelationTypes] = useState<string[]>(['Reference', 'Related'])
  const [refLetterId, setRefLetterId] = useState('')
  const [refRelationshipType, setRefRelationshipType] = useState('Reference')
  const [refRemarks, setRefRemarks] = useState('')
  const [refFile, setRefFile] = useState<File | null>(null)
  const [pendingReferences, setPendingReferences] = useState<PendingReferenceLink[]>([])
  const [form, setForm] = useState({
    number: '',
    letterDate: '',
    receivedDate: '',
    type: 'Incoming',
    subject: '',
    priority: 'Routine',
    confidentiality: 'Normal',
    from: '',
    to: '',
    department: '',
    dueDate: '',
    actionRequired: '',
    remarks: '',
    status: 'Registered',
    correspondenceCategory: 'Actionable' as LetterPurpose,
  })
  const set = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }))

  const priorities = useMemo(() => {
    const fromMaster = (masterData.Priorities ?? []).filter((value) => value !== 'Test')
    const merged = [...fromMaster]
    for (const value of DEFAULT_PRIORITIES) {
      if (!merged.includes(value)) merged.push(value)
    }
    return merged
  }, [masterData.Priorities])

  const confidentialityLevels = useMemo(() => {
    const fromMaster = masterData['Confidentiality Levels'] ?? []
    const merged = [...fromMaster]
    for (const value of DEFAULT_CONFIDENTIALITY) {
      if (!merged.includes(value)) merged.push(value)
    }
    return merged
  }, [masterData])

  const existingNumbers = useMemo(() => {
    const seen = new Set<string>()
    const values: string[] = []
    for (const letter of letters) {
      const number = (letter.number || '').trim()
      if (!number || seen.has(number)) continue
      seen.add(number)
      values.push(number)
    }
    return values.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
  }, [letters])

  const organizationSuggestions = useMemo(() => {
    const seen = new Set<string>()
    const values: string[] = []
    const push = (raw: string) => {
      const value = raw.trim()
      if (!value || seen.has(value.toLowerCase())) return
      seen.add(value.toLowerCase())
      values.push(value)
    }
    for (const org of organizations) {
      if (!org.status || org.status === 'Active') push(org.name)
    }
    for (const letter of letters) {
      push(letter.from || '')
      push(letter.to || '')
    }
    return values.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  }, [organizations, letters])

  const departmentSuggestions = useMemo(() => {
    const seen = new Set<string>()
    const values: string[] = []
    const push = (raw: string) => {
      const value = raw.trim()
      if (!value || seen.has(value.toLowerCase())) return
      seen.add(value.toLowerCase())
      values.push(value)
    }
    for (const dept of departments) push(dept.name)
    for (const letter of letters) push(letter.department || '')
    return values.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  }, [departments, letters])

  const findDuplicate = (number: string) => {
    const needle = number.trim().toLowerCase()
    if (!needle) return null
    return letters.find((letter) => letter.number.trim().toLowerCase() === needle) ?? null
  }

  const onNumberChange = (value: string) => {
    set('number', value)
    const match = findDuplicate(value)
    setDuplicateLetter(match)
    setNumberError(match ? `Letter number ${match.number} is already registered.` : '')
  }

  const onLetterDateChange = (value: string) => {
    setForm((current) => ({
      ...current,
      letterDate: value,
      receivedDate: receivedDateTouched && current.receivedDate ? current.receivedDate : value,
    }))
  }

  useEffect(() => {
    listRelationTypes()
      .then((res) => {
        if (res.types.length) {
          setRelationTypes(res.types)
          setRefRelationshipType(res.types.includes('Reference') ? 'Reference' : res.types[0])
        }
      })
      .catch(() => {})
  }, [])

  const addPendingReference = () => {
    if (!refLetterId) {
      setError('Select a reference letter to link.')
      return
    }
    if (pendingReferences.some((item) => item.letterId === refLetterId)) {
      setError('That letter is already in the reference list.')
      return
    }
    setPendingReferences((current) => [
      ...current,
      {
        key: `${refLetterId}-${Date.now()}`,
        letterId: refLetterId,
        relationshipType: refRelationshipType,
        remarks: refRemarks,
        file: refFile,
      },
    ])
    setRefLetterId('')
    setRefRemarks('')
    setRefFile(null)
    setError('')
  }

  const submit = async (status: LetterStatus) => {
    setError('')
    setCopyError('')
    if (!form.number || !form.letterDate || !form.subject) {
      setError('Letter number, letter date and subject are required.')
      return
    }
    if (!form.receivedDate) {
      setError('Received date is required.')
      return
    }
    if (!form.correspondenceCategory) {
      setError('Select whether this letter is Actionable or Information.')
      return
    }
    const existing = findDuplicate(form.number)
    if (existing) {
      setDuplicateLetter(existing)
      setNumberError(`Letter number ${existing.number} is already registered.`)
      return
    }
    if (!letterCopyFile) {
      setCopyError('Letter copy is required. Attach a scanned or digital copy to continue.')
      return
    }
    setBusy(true)
    try {
      const created = await registerLetter({
        ...form,
        type: form.type as Letter['type'],
        priority: form.priority as Letter['priority'],
        assignedTo: me.name,
        correspondenceCategory: form.correspondenceCategory,
        status,
        lastAction: status === 'Registered' ? 'Registered' : 'Saved as draft',
      })
      await uploadLetterDocument(created.id, letterCopyFile, letterCopyType, 'Letter copy uploaded at registration')
      for (const link of pendingReferences) {
        await createRelation({
          fromLetterId: Number(created.id),
          toLetterId: Number(link.letterId),
          relationshipType: link.relationshipType,
          remarks: link.remarks,
        })
        const linked = letters.find((item) => item.id === link.letterId)
        if (link.file) {
          await uploadLetterDocument(
            created.id,
            link.file,
            'Reference Document',
            linked ? `Reference copy: ${linked.number}` : 'Reference letter copy',
          )
        }
      }
      setSaved(true)
      setTimeout(() => go(created.id), 400)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to register letter'
      const match = findDuplicate(form.number)
      if (match || /already exists/i.test(message)) {
        if (match) {
          setDuplicateLetter(match)
          setNumberError(`Letter number ${match.number} is already registered.`)
        } else {
          setNumberError(message)
        }
      } else {
        setError(message)
      }
    } finally {
      setBusy(false)
    }
  }

  const purposeIsActionable = form.correspondenceCategory === 'Actionable'

  return (
    <>
      <PageTitle title="Register letter" description="Capture correspondence details. New letters are assigned to you." action={<Button variant="outline" onClick={() => go('All Letters')}>Cancel</Button>} />
      <Card className="mx-auto w-full max-w-4xl">
        <div className="mb-0 flex gap-2 px-5 pt-4 pb-3">
          <button
            type="button"
            onClick={() => setMode('manual')}
            className={appTabClass(mode === 'manual')}
          >
            Manual
          </button>
          <button
            type="button"
            onClick={() => setMode('upload')}
            className={appTabClass(mode === 'upload')}
          >
            Upload &amp; analyze
          </button>
        </div>
        <AppTabPanel tabKey={mode}>
        {mode === 'upload' ? (
          <div className="p-5 pt-0">
            <h2 className="text-sm font-bold text-slate-700">Upload &amp; analyze</h2>
            <div className="mt-4">
              <RegistrationUpload onNeedsReview={(job) => go(`/letters/register/review/${job.jobId}`)} />
            </div>
          </div>
        ) : (
          <>
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-sm font-bold text-slate-700">Basic information</h2>
              <p className="text-xs text-slate-400">Fields marked with * are required. Assigned to you ({me.name || 'current user'}).</p>
            </div>
            <div className="grid gap-5 p-5 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className="text-xs font-semibold text-slate-600">Letter number *</span>
                <input
                  list="existing-letter-numbers"
                  value={form.number}
                  onChange={(e) => onNumberChange(e.target.value)}
                  placeholder="Type a number — suggestions from existing letters"
                  className={cn(
                    'h-10 rounded-md border px-3 text-xs',
                    numberError ? 'border-red-300 focus:outline-red-400' : 'border-slate-200',
                  )}
                />
                <datalist id="existing-letter-numbers">
                  {existingNumbers.map((number) => (
                    <option key={number} value={number} />
                  ))}
                </datalist>
                {numberError ? (
                  <span className="text-[11px] text-red-600">
                    {numberError}
                    {duplicateLetter ? (
                      <>
                        {' '}
                        <button
                          type="button"
                          className="font-semibold underline underline-offset-2"
                          onClick={() => go(duplicateLetter.id)}
                        >
                          Open existing letter
                        </button>
                      </>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-[11px] text-slate-400">Suggestions appear as you type. Exact duplicates are not allowed.</span>
                )}
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-600">Letter date *</span>
                <input
                  type="date"
                  value={form.letterDate}
                  onChange={(e) => onLetterDateChange(e.target.value)}
                  className="h-10 rounded-md border border-slate-200 px-3 text-xs"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-600">Received date *</span>
                <input
                  type="date"
                  value={form.receivedDate}
                  onChange={(e) => {
                    setReceivedDateTouched(true)
                    set('receivedDate', e.target.value)
                  }}
                  className="h-10 rounded-md border border-slate-200 px-3 text-xs"
                />
                <span className="text-[11px] text-slate-400">Defaults to letter date; change if received later.</span>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-600">Letter type *</span>
                <AppSelect
                  value={form.type}
                  onValueChange={(v) => set('type', v)}
                  options={[...LETTER_TYPES]}
                  className="h-10 text-xs"
                />
              </label>

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-600">Purpose *</span>
                <div
                  role="group"
                  aria-label="Letter purpose"
                  className="relative flex h-10 rounded-md border border-slate-200 bg-slate-100 p-0.5"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'absolute inset-y-0.5 w-[calc(50%-2px)] rounded-[5px] bg-white shadow-sm transition-transform duration-300 ease-out',
                      purposeIsActionable ? 'translate-x-0' : 'translate-x-full',
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => set('correspondenceCategory', 'Actionable')}
                    className={cn(
                      'relative z-10 flex-1 rounded-[5px] text-xs font-semibold transition-colors duration-300',
                      purposeIsActionable ? 'text-slate-900' : 'text-slate-500',
                    )}
                  >
                    Actionable
                  </button>
                  <button
                    type="button"
                    onClick={() => set('correspondenceCategory', 'Information')}
                    className={cn(
                      'relative z-10 flex-1 rounded-[5px] text-xs font-semibold transition-colors duration-300',
                      !purposeIsActionable ? 'text-slate-900' : 'text-slate-500',
                    )}
                  >
                    Information
                  </button>
                </div>
              </div>

              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className="text-xs font-semibold text-slate-600">Subject *</span>
                <input
                  value={form.subject}
                  onChange={(e) => set('subject', e.target.value)}
                  className="h-10 rounded-md border border-slate-200 px-3 text-xs"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-600">Priority</span>
                <AppSelect
                  value={form.priority}
                  onValueChange={(v) => set('priority', v)}
                  options={priorities}
                  className="h-10 text-xs"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-600">Confidentiality</span>
                <AppSelect
                  value={form.confidentiality}
                  onValueChange={(v) => set('confidentiality', v)}
                  options={confidentialityLevels}
                  className="h-10 text-xs"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-600">From organization</span>
                <input
                  list="register-org-suggestions"
                  value={form.from}
                  onChange={(e) => set('from', e.target.value)}
                  placeholder="Type or choose from existing"
                  className="h-10 rounded-md border border-slate-200 px-3 text-xs"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-600">To organization</span>
                <input
                  list="register-org-suggestions"
                  value={form.to}
                  onChange={(e) => set('to', e.target.value)}
                  placeholder="Type or choose from existing"
                  className="h-10 rounded-md border border-slate-200 px-3 text-xs"
                />
              </label>
              <datalist id="register-org-suggestions">
                {organizationSuggestions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-600">Department</span>
                <input
                  list="register-department-suggestions"
                  value={form.department}
                  onChange={(e) => set('department', e.target.value)}
                  placeholder="Type or choose from existing"
                  className="h-10 rounded-md border border-slate-200 px-3 text-xs"
                />
                <datalist id="register-department-suggestions">
                  {departmentSuggestions.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-600">Due date</span>
                <input
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => set('dueDate', e.target.value)}
                  className="h-10 rounded-md border border-slate-200 px-3 text-xs"
                />
              </label>

              <div
                className={cn(
                  'sm:col-span-2 overflow-hidden transition-all duration-300 ease-out',
                  purposeIsActionable ? 'max-h-24 opacity-100' : 'max-h-0 opacity-0',
                )}
              >
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-slate-600">Action required</span>
                  <input
                    value={form.actionRequired}
                    onChange={(e) => set('actionRequired', e.target.value)}
                    placeholder="Describe the action needed"
                    disabled={!purposeIsActionable}
                    className="h-10 rounded-md border border-slate-200 px-3 text-xs disabled:bg-slate-50"
                  />
                </label>
              </div>

              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className="text-xs font-semibold text-slate-600">Initial remarks</span>
                <textarea
                  rows={3}
                  value={form.remarks}
                  onChange={(e) => set('remarks', e.target.value)}
                  className="rounded-md border border-slate-200 px-3 py-2 text-xs"
                />
              </label>
            </div>

            <div className="border-t border-slate-200 px-5 py-4">
              <h2 className="text-sm font-bold text-slate-700">Letter copy *</h2>
              <p className="mt-1 text-xs text-slate-400">A scanned or digital copy is required to register.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-slate-600">Document type</span>
                  <AppSelect
                    value={letterCopyType}
                    onValueChange={setLetterCopyType}
                    options={documentTypes}
                    className="h-10 text-xs"
                  />
                </label>
                <label className="flex flex-col gap-1.5 sm:col-span-2">
                  <span className="text-xs font-semibold text-slate-600">Upload letter copy *</span>
                  <input
                    type="file"
                    onChange={(e) => {
                      setLetterCopyFile(e.target.files?.[0] ?? null)
                      setCopyError('')
                    }}
                    className="text-xs"
                  />
                  {letterCopyFile ? (
                    <span className="text-[11px] text-emerald-700">Selected: {letterCopyFile.name}</span>
                  ) : null}
                  {copyError ? <span className="text-[11px] text-red-600">{copyError}</span> : null}
                </label>
              </div>
            </div>

            <div className="border-t border-slate-200 px-5 py-4">
              <h2 className="text-sm font-bold text-slate-700">Reference letters</h2>
              <p className="mt-1 text-xs text-slate-400">Link existing correspondence as references. After registration you can open each linked letter from the letter detail page.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5 sm:col-span-2">
                  <span className="text-xs font-semibold text-slate-600">Reference letter</span>
                  <AppSelect
                    value={refLetterId}
                    onValueChange={setRefLetterId}
                    options={[
                      { value: '', label: 'Select letter…' },
                      ...letters.map((l) => ({ value: l.id, label: `${l.number} · ${l.subject}` })),
                    ]}
                    className="h-10 text-xs"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-slate-600">Relationship</span>
                  <AppSelect
                    value={refRelationshipType}
                    onValueChange={setRefRelationshipType}
                    options={relationTypes}
                    className="h-10 text-xs"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-slate-600">Reference copy (optional)</span>
                  <input type="file" onChange={(e) => setRefFile(e.target.files?.[0] ?? null)} className="text-xs" />
                </label>
                <label className="flex flex-col gap-1.5 sm:col-span-2">
                  <span className="text-xs font-semibold text-slate-600">Remarks</span>
                  <input value={refRemarks} onChange={(e) => setRefRemarks(e.target.value)} placeholder="Optional link notes" className="h-10 rounded-md border border-slate-200 px-3 text-xs" />
                </label>
                <div className="sm:col-span-2">
                  <Button type="button" size="sm" variant="outline" onClick={addPendingReference}>Add reference letter</Button>
                </div>
              </div>
              {pendingReferences.length > 0 && (
                <div className="mt-4 space-y-2">
                  {pendingReferences.map((item) => {
                    const linked = letters.find((l) => l.id === item.letterId)
                    return (
                      <div key={item.key} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
                        <div>
                          <p className="font-semibold text-slate-700">{linked?.number ?? item.letterId} · {linked?.subject ?? 'Letter'}</p>
                          <p className="text-slate-500">{item.relationshipType}{item.file ? ` · copy: ${item.file.name}` : ''}{item.remarks ? ` · ${item.remarks}` : ''}</p>
                        </div>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setPendingReferences((current) => current.filter((row) => row.key !== item.key))}>Remove</Button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            {error && <p className="px-5 pb-2 text-xs text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-4">
              <Button variant="outline" disabled={busy || Boolean(duplicateLetter)} onClick={() => submit('Registered')}>Save as draft</Button>
              <Button disabled={busy || Boolean(duplicateLetter)} onClick={() => submit('Registered')}>Register letter</Button>
            </div>
          </>
        )}
        </AppTabPanel>
      </Card>
      {saved && <div className="fixed bottom-5 right-5 rounded-lg bg-[#102a43] px-4 py-3 text-xs font-semibold text-white">Letter saved successfully.</div>}
    </>
  )
}
