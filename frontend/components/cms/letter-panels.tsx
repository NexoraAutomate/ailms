'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useAppData } from '@/components/app-provider'
import { Button } from '@/components/ui/button'
import { Badge, Card } from '@/components/cms/ui'
import { formatDateTime } from '@/lib/datetime'
import { statusTone, type Letter, type LetterStatus } from '@/services/letters'
import {
  executeWorkflow,
  fetchWorkflowActions,
  fetchWorkflowHistory,
  workflowActionLabel,
  type WorkflowTransition,
} from '@/services/workflow'
import { getCurrentApproval, listApprovals, type Approval } from '@/services/approvals'
import { listEscalations, resolveEscalation, type Escalation } from '@/services/escalations'
import {
  documentDownloadUrl,
  documentPreviewUrl,
  formatFileSize,
  listDocumentVersions,
  listLetterDocuments,
  uploadDocumentVersion,
  uploadLetterDocument,
  type DocumentVersion,
  type LetterDocument,
} from '@/services/documents'
import { createRelation, fetchCorrespondenceThread, listRelationTypes, type CorrespondenceThread } from '@/services/correspondence'
import { listMeetings, type Meeting } from '@/services/meetings'

export function WorkflowPanel({ letter, users, onDone }: { letter: Letter; users: { name: string }[]; onDone: () => Promise<void> }) {
  const [actions, setActions] = useState<string[]>([])
  const [history, setHistory] = useState<WorkflowTransition[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dialog, setDialog] = useState<{ action: string } | null>(null)
  const [remarks, setRemarks] = useState('')
  const [assignedTo, setAssignedTo] = useState(letter.assignedTo || '')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [available, transitions] = await Promise.all([fetchWorkflowActions(letter.id), fetchWorkflowHistory(letter.id)])
      setActions(available.actions)
      setHistory(transitions)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load workflow')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [letter.id])

  const needsAssign = (action: string) => action === 'assign' || action === 'reassign' || action === 'submit_for_approval'
  const needsEscalation = (action: string) => action === 'escalate'
  const needsRemarks = (action: string) => ['approve', 'reject', 'return_for_revision', 'escalate'].includes(action)
  const [escalationLevel, setEscalationLevel] = useState('Level 1')

  const run = async (action: string) => {
    if (needsAssign(action) && !assignedTo.trim()) {
      setError('Select an assignee before continuing.')
      return
    }
    if (needsRemarks(action) && !remarks.trim()) {
      setError('Remarks are required for this action.')
      return
    }
    setError('')
    await executeWorkflow(letter.id, {
      action,
      remarks,
      assignedTo: needsAssign(action) ? assignedTo : undefined,
      reviewerName: action === 'submit_for_approval' ? assignedTo : undefined,
      escalatedTo: needsEscalation(action) ? assignedTo : undefined,
      escalationLevel: needsEscalation(action) ? escalationLevel : undefined,
    })
    setDialog(null)
    setRemarks('')
    await onDone()
    await load()
  }

  return (
    <Card className="mt-5 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-slate-700">Workflow</h2>
          <p className="text-xs text-slate-400">Authorized transitions from the current status.</p>
        </div>
        <Badge tone={statusTone(letter.status as LetterStatus)}>{letter.status}</Badge>
      </div>
      {loading && <p className="text-xs text-slate-500">Loading workflow…</p>}
      {error && <p className="mb-3 text-xs text-red-600">{error}</p>}
      {!loading && actions.length === 0 && <p className="text-xs text-slate-500">No workflow actions are available for this status.</p>}
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button
            key={action}
            size="sm"
            variant="outline"
            onClick={() => {
              setRemarks('')
              setAssignedTo(letter.assignedTo || '')
              if (needsAssign(action) || needsRemarks(action) || needsEscalation(action)) setDialog({ action })
              else void run(action)
            }}
          >
            {workflowActionLabel(action)}
          </Button>
        ))}
      </div>
      {history.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Transition history</h3>
          <div className="flex flex-col gap-2">
            {history.slice(0, 8).map((item) => (
              <div key={item.id} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
                <p className="font-semibold text-slate-700">{workflowActionLabel(item.action)} · {item.fromStatus} → {item.toStatus}</p>
                <p className="text-slate-500">{item.performedBy} · {formatDateTime(item.createdAt)}</p>
                {item.remarks && <p className="mt-1 text-slate-600">{item.remarks}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
      {dialog && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/30 p-4">
          <Card className="w-full max-w-lg p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-700">{workflowActionLabel(dialog.action)}</h2>
              <button onClick={() => setDialog(null)}><X className="size-4 text-slate-400" /></button>
            </div>
            {(needsAssign(dialog.action) || needsEscalation(dialog.action)) && (
              <label className="mb-3 flex flex-col gap-1">
                <span className="text-xs font-semibold text-slate-600">{needsEscalation(dialog.action) ? 'Escalate to' : dialog.action === 'submit_for_approval' ? 'Reviewer' : 'Assign to'}</span>
                <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-xs">
                  <option value="">Select…</option>
                  {users.map((user) => <option key={user.name} value={user.name}>{user.name}</option>)}
                </select>
              </label>
            )}
            {needsEscalation(dialog.action) && (
              <label className="mb-3 flex flex-col gap-1">
                <span className="text-xs font-semibold text-slate-600">Escalation level</span>
                <select value={escalationLevel} onChange={(e) => setEscalationLevel(e.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-xs">
                  {['Level 1', 'Level 2', 'Level 3'].map((level) => <option key={level}>{level}</option>)}
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-slate-600">{needsRemarks(dialog.action) ? 'Remarks *' : 'Remarks'}</span>
              <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} className="min-h-24 rounded-md border border-slate-200 px-3 py-2 text-xs" />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
              <Button onClick={() => void run(dialog.action)}>{workflowActionLabel(dialog.action)}</Button>
            </div>
          </Card>
        </div>
      )}
    </Card>
  )
}

export function ApprovalEscalationPanel({ letter, onDone }: { letter: Letter; onDone: () => Promise<void> }) {
  const [approval, setApproval] = useState<Approval | null>(null)
  const [history, setHistory] = useState<Approval[]>([])
  const [escalations, setEscalations] = useState<Escalation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [current, approvals, esc] = await Promise.all([
        getCurrentApproval(letter.id),
        listApprovals(letter.id),
        listEscalations(letter.id),
      ])
      setApproval(current)
      setHistory(approvals)
      setEscalations(esc)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load approval/escalation data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [letter.id])

  return (
    <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <Card className="p-5">
        <h2 className="mb-3 text-sm font-bold text-slate-700">Approval tracking</h2>
        {loading && <p className="text-xs text-slate-500">Loading…</p>}
        {error && <p className="text-xs text-red-600">{error}</p>}
        {!loading && !approval && <p className="text-xs text-slate-500">No approval record for this letter yet.</p>}
        {approval && (
          <div className="space-y-2 text-xs">
            <p><span className="text-slate-400">Status:</span> <Badge tone={approval.approvalStatus === 'Pending' ? 'amber' : approval.approvalStatus === 'Approved' ? 'green' : 'red'}>{approval.approvalStatus}</Badge></p>
            <p><span className="text-slate-400">Prepared by:</span> {approval.preparedBy}</p>
            <p><span className="text-slate-400">Reviewer:</span> {approval.reviewer || '—'}</p>
            <p><span className="text-slate-400">Revision:</span> {approval.revisionNumber}</p>
            {approval.reviewerRemarks && <p className="text-slate-600">{approval.reviewerRemarks}</p>}
          </div>
        )}
        {history.length > 1 && (
          <p className="mt-3 text-[11px] text-slate-400">{history.length} approval revision(s) on file.</p>
        )}
      </Card>
      <Card className="p-5">
        <h2 className="mb-3 text-sm font-bold text-slate-700">Escalations</h2>
        {loading && <p className="text-xs text-slate-500">Loading…</p>}
        {!loading && escalations.length === 0 && <p className="text-xs text-slate-500">No escalations recorded.</p>}
        <div className="flex flex-col gap-2">
          {escalations.slice(0, 5).map((item) => (
            <div key={item.id} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
              <p className="font-semibold text-slate-700">{item.escalationLevel} · {item.status}</p>
              <p className="text-slate-500">{item.escalatedBy} → {item.escalatedTo}</p>
              <p className="text-slate-600">{item.reason}</p>
              {item.status === 'Open' && (
                <Button size="sm" variant="outline" className="mt-2" onClick={async () => { await resolveEscalation(item.id, 'Resolved from letter detail'); await onDone(); await load() }}>Mark resolved</Button>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

export function CorrespondenceThreadPanel({ letter, go }: { letter: Letter; go: (p: string) => void }) {
  const { letters } = useAppData()
  const [thread, setThread] = useState<CorrespondenceThread | null>(null)
  const [types, setTypes] = useState<string[]>([])
  const [toLetterId, setToLetterId] = useState('')
  const [relationshipType, setRelationshipType] = useState('Related')
  const [remarks, setRemarks] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [t, relTypes] = await Promise.all([fetchCorrespondenceThread(letter.id), listRelationTypes()])
      setThread(t)
      setTypes(relTypes.types)
      if (relTypes.types.length) setRelationshipType(relTypes.types[0])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load correspondence thread')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [letter.id])

  const addLink = async () => {
    if (!toLetterId) return
    setError('')
    try {
      await createRelation({
        fromLetterId: Number(letter.id),
        toLetterId: Number(toLetterId),
        relationshipType,
        remarks,
      })
      setToLetterId('')
      setRemarks('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create relationship')
    }
  }

  const relationshipFor = (nodeId: string) => {
    if (!thread) return 'Related'
    const edge = thread.edges.find(
      (e) =>
        (e.fromLetterId === letter.id && e.toLetterId === nodeId) ||
        (e.toLetterId === letter.id && e.fromLetterId === nodeId),
    )
    return edge?.relationshipType ?? 'Related'
  }

  const linkedNodes = thread?.nodes.filter((node) => node.id !== letter.id) ?? []

  return (
    <Card className="mt-5 p-5">
      <h2 className="mb-1 text-sm font-bold text-slate-700">Reference & linked letters</h2>
      <p className="mb-3 text-xs text-slate-400">Select a linked letter to open its detail record.</p>
      {loading && <p className="text-xs text-slate-500">Loading thread…</p>}
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      {!loading && thread && (
        <div className="space-y-2">
          {linkedNodes.length === 0 && <p className="text-xs text-slate-500">No reference or linked letters yet.</p>}
          {linkedNodes.map((node) => (
            <button
              key={node.id}
              type="button"
              onClick={() => go(node.id)}
              className="group w-full rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-left text-xs transition-colors hover:border-[#1769aa] hover:bg-white"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-slate-700">{node.number} · {node.subject}</p>
                <Badge tone="blue">{relationshipFor(node.id)}</Badge>
              </div>
              <p className="text-slate-500">{node.letterDate} · {node.type} · {node.status}</p>
              <p className="text-slate-400">{node.from} → {node.to}</p>
              <p className="mt-1 font-semibold text-[#1769aa] group-hover:underline">Open letter →</p>
            </button>
          ))}
        </div>
      )}
      <div className="mt-4 grid gap-2 border-t border-slate-100 pt-4 sm:grid-cols-3">
        <select value={toLetterId} onChange={(e) => setToLetterId(e.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-xs sm:col-span-1">
          <option value="">Link to letter…</option>
          {letters.filter((l) => l.id !== letter.id).map((l) => <option key={l.id} value={l.id}>{l.number}</option>)}
        </select>
        <select value={relationshipType} onChange={(e) => setRelationshipType(e.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-xs">
          {types.map((t) => <option key={t}>{t}</option>)}
        </select>
        <Button size="sm" onClick={() => void addLink()}>Add relationship</Button>
        <input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Remarks (optional)" className="h-10 rounded-md border border-slate-200 px-3 text-xs sm:col-span-3" />
      </div>
    </Card>
  )
}

export function RelatedMeetingsPanel({ letter, go }: { letter: Letter; go: (p: string) => void }) {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listMeetings({ letterId: letter.id })
      .then(setMeetings)
      .finally(() => setLoading(false))
  }, [letter.id])

  return (
    <Card className="mt-5 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-700">Related meetings</h2>
        <Button size="sm" variant="outline" onClick={() => go('Meetings')}>All meetings</Button>
      </div>
      {loading && <p className="text-xs text-slate-500">Loading…</p>}
      {!loading && meetings.length === 0 && <p className="text-xs text-slate-500">No meetings linked to this letter.</p>}
      <div className="flex flex-col gap-2">
        {meetings.map((m) => (
          <button key={m.id} type="button" onClick={() => go(`meeting:${m.id}`)} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-left text-xs hover:bg-white">
            <p className="font-semibold text-slate-700">{m.title}</p>
            <p className="text-slate-500">{m.date} · {m.startTime}–{m.endTime} · {m.status}</p>
          </button>
        ))}
      </div>
    </Card>
  )
}

export function DocumentsPanel({ letter }: { letter: Letter }) {
  const { masterData, refresh } = useAppData()
  const types = masterData['Document Types'] ?? ['Supporting Document', 'Original Letter', 'Draft Response', 'Final Response']
  const [documents, setDocuments] = useState<LetterDocument[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [versions, setVersions] = useState<DocumentVersion[]>([])
  const [documentType, setDocumentType] = useState(types[0] ?? 'Supporting Document')
  const [changeDescription, setChangeDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [previewId, setPreviewId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setDocuments(await listLetterDocuments(letter.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load documents')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [letter.id])

  const loadVersions = async (documentId: string) => {
    setExpanded(documentId)
    setVersions(await listDocumentVersions(documentId))
  }

  const upload = async () => {
    if (!file) {
      setError('Select a file to upload.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await uploadLetterDocument(letter.id, file, documentType, changeDescription)
      setFile(null)
      setChangeDescription('')
      await load()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  const uploadRevision = async (documentId: string, revisionFile: File) => {
    setBusy(true)
    setError('')
    try {
      await uploadDocumentVersion(documentId, revisionFile, changeDescription || 'Revised upload')
      await loadVersions(documentId)
      await load()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to upload new version')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="mt-5 p-5">
      <h2 className="mb-1 text-sm font-bold text-slate-700">Documents & attachments</h2>
      <p className="mb-4 text-xs text-slate-400">Secure uploads stored on server filesystem (metadata in database).</p>
      {loading && <p className="text-xs text-slate-500">Loading documents…</p>}
      {error && <p className="mb-3 text-xs text-red-600">{error}</p>}
      <div className="mb-5 grid gap-3 rounded-md border border-dashed border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-semibold text-slate-600">Document type</span>
          <select value={documentType} onChange={(e) => setDocumentType(e.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3">
            {types.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs sm:col-span-2">
          <span className="font-semibold text-slate-600">Change description</span>
          <input value={changeDescription} onChange={(e) => setChangeDescription(e.target.value)} className="h-10 rounded-md border border-slate-200 px-3" placeholder="Optional notes for this upload" />
        </label>
        <label className="flex flex-col gap-1 text-xs sm:col-span-2">
          <span className="font-semibold text-slate-600">File</span>
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-xs" />
        </label>
        <div className="sm:col-span-2">
          <Button size="sm" disabled={busy} onClick={() => void upload()}>Upload document</Button>
        </div>
      </div>
      {documents.length === 0 && !loading && <p className="text-xs text-slate-500">No documents attached yet.</p>}
      <div className="flex flex-col gap-3">
        {documents.map((doc) => {
          const current = doc.currentVersion
          return (
            <div key={doc.id} className="rounded-md border border-slate-100 bg-white px-3 py-3 text-xs">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-700">{doc.documentType}</p>
                  {current && (
                    <p className="text-slate-500">{current.originalFilename} · v{current.versionNumber} · {formatFileSize(current.fileSize)}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {current && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => window.open(documentDownloadUrl(current.id), '_blank')}>Download</Button>
                      {current.previewable && (
                        <Button size="sm" variant="outline" onClick={() => setPreviewId(current.id)}>Preview</Button>
                      )}
                    </>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => void loadVersions(doc.id)}>Version history</Button>
                </div>
              </div>
              {expanded === doc.id && (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  {versions.map((v) => (
                    <div key={v.id} className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded bg-slate-50 px-2 py-2">
                      <span>v{v.versionNumber} · {v.originalFilename} · {v.status}</span>
                      <div className="flex gap-2">
                        <button type="button" className="text-[#1769aa]" onClick={() => window.open(documentDownloadUrl(v.id), '_blank')}>Download</button>
                        {v.previewable && <button type="button" className="text-[#1769aa]" onClick={() => setPreviewId(v.id)}>Preview</button>}
                      </div>
                    </div>
                  ))}
                  <label className="mt-2 flex flex-col gap-1">
                    <span className="font-semibold text-slate-600">Upload new version</span>
                    <input type="file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadRevision(doc.id, f) }} className="text-xs" />
                  </label>
                </div>
              )}
            </div>
          )
        })}
      </div>
      {previewId !== null && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
          <Card className="flex h-[85vh] w-full max-w-4xl flex-col p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-bold text-slate-700">Document preview</p>
              <button onClick={() => setPreviewId(null)}><X className="size-4 text-slate-400" /></button>
            </div>
            <iframe title="Document preview" src={documentPreviewUrl(previewId)} className="min-h-0 flex-1 rounded border border-slate-200 bg-white" />
          </Card>
        </div>
      )}
    </Card>
  )
}
