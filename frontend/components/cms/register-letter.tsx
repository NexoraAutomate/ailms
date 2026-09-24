'use client'

import { useEffect, useState } from 'react'
import { useAppData } from '@/components/app-provider'
import { Button } from '@/components/ui/button'
import { Card, PageTitle } from '@/components/cms/ui'
import { RegistrationUpload } from '@/components/ai/registration-upload'
import { createRelation, listRelationTypes } from '@/services/correspondence'
import { uploadLetterDocument } from '@/services/documents'
import type { Letter, LetterStatus } from '@/services/letters'

export type PendingReferenceLink = {
  key: string
  letterId: string
  relationshipType: string
  remarks: string
  file: File | null
}

type RegisterMode = 'manual' | 'upload'

export function Register({ go }: { go: (p: string) => void }) {
  const { registerLetter, departments, organizations, users, masterData, letters } = useAppData()
  const [mode, setMode] = useState<RegisterMode>('manual')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
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
    assignedTo: '',
    dueDate: '',
    actionRequired: '',
    remarks: '',
    status: 'Registered',
  })
  const set = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }))

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
    if (!form.number || !form.letterDate || !form.subject) {
      setError('Letter number, letter date and subject are required.')
      return
    }
    setBusy(true)
    try {
      const created = await registerLetter({
        ...form,
        type: form.type as Letter['type'],
        priority: form.priority as Letter['priority'],
        status,
        lastAction: status === 'Registered' ? 'Registered' : 'Saved as draft',
      })
      if (letterCopyFile) {
        await uploadLetterDocument(created.id, letterCopyFile, letterCopyType, 'Letter copy uploaded at registration')
      }
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
      setError(err instanceof Error ? err.message : 'Unable to register letter')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageTitle title="Register letter" description="Capture correspondence details and assign the next action." action={<Button variant="outline" onClick={() => go('All Letters')}>Cancel</Button>} />
      <Card className="max-w-4xl">
        <div className="mb-0 flex gap-2 border-b border-slate-200 px-5 pt-4">
          <button
            type="button"
            onClick={() => setMode('manual')}
            className={`border-b-2 px-3 pb-2 text-xs font-semibold ${mode === 'manual' ? 'border-[#102a43] text-[#102a43]' : 'border-transparent text-slate-400'}`}
          >
            Manual
          </button>
          <button
            type="button"
            onClick={() => setMode('upload')}
            className={`border-b-2 px-3 pb-2 text-xs font-semibold ${mode === 'upload' ? 'border-[#102a43] text-[#102a43]' : 'border-transparent text-slate-400'}`}
          >
            Upload &amp; analyze
          </button>
        </div>
        {mode === 'upload' ? (
          <div className="p-5">
            <h2 className="text-sm font-bold text-slate-700">Upload &amp; analyze</h2>
            <div className="mt-4">
              <RegistrationUpload />
            </div>
          </div>
        ) : (
          <>
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-sm font-bold text-slate-700">Basic information</h2>
              <p className="text-xs text-slate-400">Fields marked with * are required.</p>
            </div>
            <div className="grid gap-5 p-5 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5"><span className="text-xs font-semibold text-slate-600">Letter number *</span><input value={form.number} onChange={(e) => set('number', e.target.value)} className="h-10 rounded-md border border-slate-200 px-3 text-xs" /></label>
              <label className="flex flex-col gap-1.5"><span className="text-xs font-semibold text-slate-600">Letter date *</span><input type="date" value={form.letterDate} onChange={(e) => set('letterDate', e.target.value)} className="h-10 rounded-md border border-slate-200 px-3 text-xs" /></label>
              <label className="flex flex-col gap-1.5"><span className="text-xs font-semibold text-slate-600">Received date *</span><input type="date" value={form.receivedDate} onChange={(e) => set('receivedDate', e.target.value)} className="h-10 rounded-md border border-slate-200 px-3 text-xs" /></label>
              <label className="flex flex-col gap-1.5"><span className="text-xs font-semibold text-slate-600">Letter type *</span><select value={form.type} onChange={(e) => set('type', e.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-xs">{(masterData['Letter Types'] ?? ['Incoming', 'Outgoing']).map((item) => <option key={item}>{item}</option>)}</select></label>
              <label className="flex flex-col gap-1.5 sm:col-span-2"><span className="text-xs font-semibold text-slate-600">Subject *</span><input value={form.subject} onChange={(e) => set('subject', e.target.value)} className="h-10 rounded-md border border-slate-200 px-3 text-xs" /></label>
              <label className="flex flex-col gap-1.5"><span className="text-xs font-semibold text-slate-600">Priority</span><select value={form.priority} onChange={(e) => set('priority', e.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-xs">{(masterData.Priorities ?? ['Routine', 'Important', 'Urgent']).map((item) => <option key={item}>{item}</option>)}</select></label>
              <label className="flex flex-col gap-1.5"><span className="text-xs font-semibold text-slate-600">Confidentiality</span><select value={form.confidentiality} onChange={(e) => set('confidentiality', e.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-xs">{(masterData['Confidentiality Levels'] ?? ['Normal']).map((item) => <option key={item}>{item}</option>)}</select></label>
              <label className="flex flex-col gap-1.5"><span className="text-xs font-semibold text-slate-600">From organization</span><input list="orgs" value={form.from} onChange={(e) => set('from', e.target.value)} className="h-10 rounded-md border border-slate-200 px-3 text-xs" /></label>
              <label className="flex flex-col gap-1.5"><span className="text-xs font-semibold text-slate-600">To organization</span><input list="orgs" value={form.to} onChange={(e) => set('to', e.target.value)} className="h-10 rounded-md border border-slate-200 px-3 text-xs" /></label>
              <label className="flex flex-col gap-1.5"><span className="text-xs font-semibold text-slate-600">Department</span><select value={form.department} onChange={(e) => set('department', e.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-xs"><option value="">Select...</option>{departments.map((d) => <option key={d.code}>{d.name}</option>)}</select></label>
              <label className="flex flex-col gap-1.5"><span className="text-xs font-semibold text-slate-600">Assigned to</span><select value={form.assignedTo} onChange={(e) => set('assignedTo', e.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-xs"><option value="">Select...</option>{users.map((u) => <option key={u.username}>{u.name}</option>)}</select></label>
              <label className="flex flex-col gap-1.5"><span className="text-xs font-semibold text-slate-600">Due date</span><input type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} className="h-10 rounded-md border border-slate-200 px-3 text-xs" /></label>
              <label className="flex flex-col gap-1.5 sm:col-span-2"><span className="text-xs font-semibold text-slate-600">Action required</span><input value={form.actionRequired} onChange={(e) => set('actionRequired', e.target.value)} className="h-10 rounded-md border border-slate-200 px-3 text-xs" /></label>
              <label className="flex flex-col gap-1.5 sm:col-span-2"><span className="text-xs font-semibold text-slate-600">Initial remarks</span><textarea rows={3} value={form.remarks} onChange={(e) => set('remarks', e.target.value)} className="rounded-md border border-slate-200 px-3 py-2 text-xs" /></label>
            </div>
            <div className="border-t border-slate-200 px-5 py-4">
              <h2 className="text-sm font-bold text-slate-700">Letter copy</h2>
              <p className="mt-1 text-xs text-slate-400">Optional scanned or digital copy of this letter.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-slate-600">Document type</span>
                  <select value={letterCopyType} onChange={(e) => setLetterCopyType(e.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-xs">
                    {documentTypes.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5 sm:col-span-2">
                  <span className="text-xs font-semibold text-slate-600">Upload letter copy</span>
                  <input type="file" onChange={(e) => setLetterCopyFile(e.target.files?.[0] ?? null)} className="text-xs" />
                </label>
              </div>
            </div>
            <div className="border-t border-slate-200 px-5 py-4">
              <h2 className="text-sm font-bold text-slate-700">Reference letters</h2>
              <p className="mt-1 text-xs text-slate-400">Link existing correspondence as references. After registration you can open each linked letter from the letter detail page.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5 sm:col-span-2">
                  <span className="text-xs font-semibold text-slate-600">Reference letter</span>
                  <select value={refLetterId} onChange={(e) => setRefLetterId(e.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-xs">
                    <option value="">Select letter…</option>
                    {letters.map((l) => <option key={l.id} value={l.id}>{l.number} · {l.subject}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-slate-600">Relationship</span>
                  <select value={refRelationshipType} onChange={(e) => setRefRelationshipType(e.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-xs">
                    {relationTypes.map((t) => <option key={t}>{t}</option>)}
                  </select>
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
            <datalist id="orgs">{organizations.map((org) => <option key={org.name} value={org.name} />)}</datalist>
            {error && <p className="px-5 pb-2 text-xs text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-4">
              <Button variant="outline" disabled={busy} onClick={() => submit('Registered')}>Save as draft</Button>
              <Button disabled={busy} onClick={() => submit('Registered')}>Register letter</Button>
            </div>
          </>
        )}
      </Card>
      {saved && <div className="fixed bottom-5 right-5 rounded-lg bg-[#102a43] px-4 py-3 text-xs font-semibold text-white">Letter saved successfully.</div>}
    </>
  )
}
