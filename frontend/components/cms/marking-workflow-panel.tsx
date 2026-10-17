'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  CornerUpLeft,
  ExternalLink,
  Eye,
  MessageSquare,
  Paperclip,
  Pencil,
  Send,
  Trash2,
  X,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CollapsibleCard } from '@/components/ui/collapsible-card'
import {
  AnimatedProgressStepper,
  type AnimatedProgressStep,
} from '@/components/ui/animated-progress-stepper'
import { Badge } from '@/components/cms/ui'
import { formatDateTime } from '@/lib/datetime'
import type { Letter } from '@/services/letters'
import {
  documentDownloadUrl,
  documentPreviewUrl,
  uploadDocumentVersion,
  uploadLetterDocument,
} from '@/services/documents'
import {
  ACTION_LABELS,
  ATTACHMENT_KINDS,
  MARKING_ACTIONS,
  RESPONSE_TYPES,
  RESPONSE_TYPE_LABELS,
  type AttachmentKind,
  type MarkingAction,
  type ResponseType,
} from '@/services/marking-types'
import {
  addAttachmentsToNote,
  addMarkingNote,
  closeMarkedLetter,
  deleteMarkingAttachment,
  deleteMarkingNote,
  fetchMarkingActions,
  fetchMarkingNotes,
  fetchMarkingTree,
  markAttachmentReplaced,
  markLetter,
  markingActionLabel,
  respondToMarking,
  revokeMarking,
  updateMarkingAttachment,
  updateMarkingNote,
  type CorrespondenceNote,
  type MarkRecipientInput,
  type MarkingNode,
} from '@/services/markings'

type PendingAttachment = {
  id: string
  file: File
  kind: AttachmentKind
}

type WorkflowUser = { name: string; avatarUrl?: string; department?: string }

function flattenMarkings(nodes: MarkingNode[]): MarkingNode[] {
  const out: MarkingNode[] = []
  const walk = (node: MarkingNode) => {
    out.push(node)
    node.children.forEach(walk)
  }
  nodes.forEach(walk)
  return out.sort((a, b) => a.id - b.id)
}

function emptyRecipient(): MarkRecipientInput {
  return { toUser: '', action: 'forward', track: true, remindersEnabled: true }
}

/** Consecutive notes from the same author share one card. */
function groupNotesByAuthor(notes: CorrespondenceNote[]): CorrespondenceNote[][] {
  const groups: CorrespondenceNote[][] = []
  for (const note of notes) {
    const last = groups[groups.length - 1]
    if (last && last[0]?.authorUser === note.authorUser) {
      last.push(note)
    } else {
      groups.push([note])
    }
  }
  return groups
}

export function MarkingWorkflowPanel({
  letter,
  users,
  onDone,
}: {
  letter: Letter
  users: WorkflowUser[]
  onDone: () => Promise<void>
}) {
  const [actions, setActions] = useState<string[]>([])
  const [tree, setTree] = useState<MarkingNode[]>([])
  const [notes, setNotes] = useState<CorrespondenceNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dialog, setDialog] = useState<'mark' | 'note' | 'respond' | 'close' | null>(null)
  const [remarks, setRemarks] = useState('')
  const [pathwayNotify, setPathwayNotify] = useState(false)
  const [recipients, setRecipients] = useState<MarkRecipientInput[]>([emptyRecipient()])
  const [noteBody, setNoteBody] = useState('')
  const [pendingFiles, setPendingFiles] = useState<PendingAttachment[]>([])
  const [defaultKind, setDefaultKind] = useState<AttachmentKind>('Supporting Doc')
  const [forceClose, setForceClose] = useState(false)
  const [respondMarkingId, setRespondMarkingId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [previewVersionId, setPreviewVersionId] = useState<number | null>(null)
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null)
  const [editingNoteBody, setEditingNoteBody] = useState('')

  const resetComposer = () => {
    setRemarks('')
    setNoteBody('')
    setPendingFiles([])
    setForceClose(false)
    setRecipients([emptyRecipient()])
    setPathwayNotify(false)
  }

  const uploadPendingAttachments = async () => {
    const uploaded: { attachmentKind: string; documentId: number; originalFilename: string }[] = []
    for (const item of pendingFiles) {
      const doc = await uploadLetterDocument(letter.id, item.file, item.kind, `Workflow attachment (${item.kind})`)
      uploaded.push({
        attachmentKind: item.kind,
        documentId: Number(doc.id),
        originalFilename: item.file.name,
      })
    }
    return uploaded
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [available, markingTree, noteRows] = await Promise.all([
        fetchMarkingActions(letter.id),
        fetchMarkingTree(letter.id),
        fetchMarkingNotes(letter.id),
      ])
      setActions(available.actions)
      setTree(markingTree)
      setNotes(noteRows)
      const rr = markingTree
        .flatMap(function walk(n: MarkingNode): MarkingNode[] {
          return [n, ...n.children.flatMap(walk)]
        })
        .find((n) => n.status === 'active' && n.action === 'response_required')
      setRespondMarkingId(rr?.id ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load marking workflow')
    } finally {
      setLoading(false)
    }
  }, [letter.id])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      setDialog(null)
      resetComposer()
      await onDone()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  const findActiveRrForMe = (nodes: MarkingNode[]): number | null => {
    for (const n of nodes) {
      if (n.status === 'active' && n.action === 'response_required') return n.id
      const child = findActiveRrForMe(n.children)
      if (child) return child
    }
    return null
  }

  const allMarkings = useMemo(() => flattenMarkings(tree), [tree])
  const recentMarkings = useMemo(() => allMarkings.slice(-3), [allMarkings])
  const priorCount = Math.max(0, allMarkings.length - recentMarkings.length)

  const { steps, currentStep } = useMemo(() => {
    const byName = new Map(users.map((u) => [u.name, u]))
    const built: AnimatedProgressStep[] = recentMarkings.map((marking) => {
      const profile = byName.get(marking.toUser)
      return {
        id: String(marking.id),
        title: marking.toUser,
        department: profile?.department || markingActionLabel(marking.action),
        task: markingActionLabel(marking.action),
        taskDetail: {
          action: marking.action,
          actionLabel: markingActionLabel(marking.action),
          fromStatus: marking.fromUser,
          toStatus: marking.toUser,
          remarks: marking.instructions,
          performedBy: marking.fromUser,
          assignedTo: marking.toUser,
          createdAt: marking.createdAt,
        },
        avatarUrl: profile?.avatarUrl || '',
        initials: marking.toUser
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((part) => part[0]?.toUpperCase() ?? '')
          .join(''),
      }
    })
    const activeIdx = recentMarkings.findIndex((m) => m.status === 'active')
    const current =
      activeIdx >= 0 ? activeIdx : built.length > 0 ? built.length - 1 : 0
    return { steps: built, currentStep: current }
  }, [recentMarkings, users])

  const revokableRecent = actions.includes('revoke')
    ? recentMarkings.filter((m) => m.status === 'active')
    : []

  return (
    <CollapsibleCard title="Marking workflow" defaultOpen>
      {loading && <p className="text-xs text-slate-500">Loading workflow…</p>}
      {error && <p className="mb-2 text-xs text-rose-600">{error}</p>}

      {!loading && (
        <div className="mb-5">
          <AnimatedProgressStepper
            steps={steps}
            currentStep={currentStep}
            priorCount={priorCount}
            footerLabel={steps.length ? 'Current' : undefined}
          />
          {revokableRecent.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {revokableRecent.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="text-xs font-medium text-rose-600 hover:underline"
                  onClick={() =>
                    void run(async () => {
                      await revokeMarking(m.id)
                    })
                  }
                >
                  Revoke mark to {m.toUser}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!loading && (
        <div className="mb-4 flex flex-wrap gap-2">
          {actions.includes('mark') && (
            <Button size="sm" onClick={() => setDialog('mark')}>
              <Send className="mr-1 h-3.5 w-3.5" /> Mark
            </Button>
          )}
          {actions.includes('add_note') && (
            <Button size="sm" variant="outline" onClick={() => setDialog('note')}>
              <MessageSquare className="mr-1 h-3.5 w-3.5" /> Add note
            </Button>
          )}
          {actions.includes('respond') && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setRespondMarkingId(findActiveRrForMe(tree) ?? respondMarkingId)
                setDialog('respond')
              }}
            >
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Respond
            </Button>
          )}
          {actions.includes('close') && (
            <Button size="sm" variant="outline" onClick={() => setDialog('close')}>
              <XCircle className="mr-1 h-3.5 w-3.5" /> Close
            </Button>
          )}
        </div>
      )}

      <div>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Notes & attachments</h3>
        {notes.length === 0 && <p className="text-xs text-slate-500">No notes yet.</p>}
        <ul className="space-y-3">
          {groupNotesByAuthor(notes).map((group) => {
            const author = group[0]?.authorUser ?? ''
            const hasResponse = group.some((n) => n.isResponse)
            const groupEditable = group.some((n) => n.editable)
            const attachments = group.flatMap((n) =>
              n.attachments.map((a) => ({ ...a, noteId: n.id, noteEditable: n.editable })),
            )
            return (
              <li
                key={`note-group-${group[0]?.id ?? author}`}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
              >
                <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
                  <p className="text-sm font-semibold text-slate-800">{author}</p>
                  {hasResponse && <Badge>Response</Badge>}
                  {!groupEditable && (
                    <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                      Locked
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3">
                  <div className="divide-y divide-slate-100 px-4 py-1 md:col-span-2 md:border-r md:border-slate-100">
                    {group.map((note) => (
                      <div key={note.id} className="py-3">
                        <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                          <span>{note.createdAt ? formatDateTime(note.createdAt) : ''}</span>
                          {note.clientIp ? <span>IP {note.clientIp}</span> : null}
                          {note.isResponse ? <span className="font-medium text-slate-600">Response</span> : null}
                          {note.editable && (
                            <span className="ml-auto flex gap-2">
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 font-medium text-[#1769aa] hover:underline"
                                onClick={() => {
                                  setEditingNoteId(note.id)
                                  setEditingNoteBody(note.bodyText)
                                }}
                              >
                                <Pencil className="h-3 w-3" /> Edit
                              </button>
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 font-medium text-rose-600 hover:underline"
                                disabled={busy}
                                onClick={() =>
                                  void run(async () => {
                                    await deleteMarkingNote(note.id)
                                  })
                                }
                              >
                                <Trash2 className="h-3 w-3" /> Delete
                              </button>
                            </span>
                          )}
                        </div>
                        {editingNoteId === note.id ? (
                          <div className="space-y-2">
                            <textarea
                              className="w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
                              rows={3}
                              value={editingNoteBody}
                              onChange={(e) => setEditingNoteBody(e.target.value)}
                            />
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                disabled={busy}
                                onClick={() =>
                                  void run(async () => {
                                    await updateMarkingNote(note.id, editingNoteBody)
                                    setEditingNoteId(null)
                                  })
                                }
                              >
                                Save
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setEditingNoteId(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                            {note.bodyText}
                          </p>
                        )}
                        {note.editable && (
                          <label className="mt-2 inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-[#1769aa] hover:underline">
                            <Paperclip className="h-3 w-3" /> Add files
                            <input
                              type="file"
                              multiple
                              className="hidden"
                              onChange={(e) => {
                                const files = Array.from(e.target.files || [])
                                e.target.value = ''
                                if (!files.length) return
                                void run(async () => {
                                  const uploaded: {
                                    attachmentKind: string
                                    documentId: number
                                    originalFilename: string
                                  }[] = []
                                  for (const file of files) {
                                    const doc = await uploadLetterDocument(
                                      letter.id,
                                      file,
                                      defaultKind,
                                      `Workflow attachment (${defaultKind})`,
                                    )
                                    uploaded.push({
                                      attachmentKind: defaultKind,
                                      documentId: Number(doc.id),
                                      originalFilename: file.name,
                                    })
                                  }
                                  await addAttachmentsToNote(note.id, uploaded)
                                })
                              }}
                            />
                          </label>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-slate-100 bg-slate-50/80 px-3 py-3 md:col-span-1 md:border-t-0">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">Attachments</p>
                    {attachments.length === 0 ? (
                      <p className="text-xs text-slate-400">None</p>
                    ) : (
                      <ul className="space-y-2">
                        {attachments.map((a) => (
                          <li
                            key={a.id}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 shadow-sm"
                          >
                            <div className="flex items-start gap-2">
                              <Paperclip className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-semibold text-slate-800">
                                  {a.originalFilename ||
                                    a.storageKey ||
                                    (a.documentId ? `Document #${a.documentId}` : 'File')}
                                </p>
                                {a.noteEditable ? (
                                  <select
                                    className="mt-1 w-full rounded border border-slate-200 px-1 py-0.5 text-[10px]"
                                    value={a.attachmentKind}
                                    disabled={busy}
                                    onChange={(e) =>
                                      void run(async () => {
                                        await updateMarkingAttachment(a.id, {
                                          attachmentKind: e.target.value,
                                        })
                                      })
                                    }
                                  >
                                    {ATTACHMENT_KINDS.map((kind) => (
                                      <option key={kind} value={kind}>
                                        {kind}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <p className="mt-0.5 text-[10px] font-medium text-slate-500">
                                    {a.attachmentKind}
                                  </p>
                                )}
                                {a.clientIp ? (
                                  <p className="mt-0.5 text-[10px] text-slate-400">IP {a.clientIp}</p>
                                ) : null}
                                <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-[10px] font-medium">
                                  {a.versionId && a.previewable ? (
                                    <button
                                      type="button"
                                      className="inline-flex items-center gap-0.5 text-[#1769aa] hover:underline"
                                      onClick={() => setPreviewVersionId(a.versionId)}
                                    >
                                      <Eye className="h-3 w-3" /> Preview
                                    </button>
                                  ) : null}
                                  {a.versionId ? (
                                    <a
                                      href={documentDownloadUrl(a.versionId)}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-0.5 text-[#1769aa] hover:underline"
                                    >
                                      <ExternalLink className="h-3 w-3" /> Open
                                    </a>
                                  ) : null}
                                  {a.noteEditable && a.documentId ? (
                                    <label className="inline-flex cursor-pointer items-center gap-0.5 text-[#1769aa] hover:underline">
                                      Replace
                                      <input
                                        type="file"
                                        className="hidden"
                                        onChange={(e) => {
                                          const file = e.target.files?.[0]
                                          e.target.value = ''
                                          if (!file || !a.documentId) return
                                          void run(async () => {
                                            await uploadDocumentVersion(
                                              String(a.documentId),
                                              file,
                                              'Replaced from workflow',
                                            )
                                            await markAttachmentReplaced(a.id, file.name)
                                          })
                                        }}
                                      />
                                    </label>
                                  ) : null}
                                  {a.noteEditable ? (
                                    <button
                                      type="button"
                                      className="inline-flex items-center gap-0.5 text-rose-600 hover:underline"
                                      disabled={busy}
                                      onClick={() =>
                                        void run(async () => {
                                          await deleteMarkingAttachment(a.id)
                                        })
                                      }
                                    >
                                      <Trash2 className="h-3 w-3" /> Delete
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      {previewVersionId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="flex h-[85vh] w-full max-w-4xl flex-col rounded-xl bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-slate-700">Document preview</p>
              <div className="flex gap-2">
                <a
                  href={documentDownloadUrl(previewVersionId)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-medium text-[#1769aa] hover:underline"
                >
                  Open / download
                </a>
                <Button size="sm" variant="outline" onClick={() => setPreviewVersionId(null)}>
                  Close
                </Button>
              </div>
            </div>
            <iframe
              title="Document preview"
              src={documentPreviewUrl(previewVersionId)}
              className="min-h-0 flex-1 rounded border border-slate-200 bg-white"
            />
          </div>
        </div>
      )}

      {dialog === 'mark' && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-4 shadow-xl">
            <h2 className="text-sm font-bold text-slate-800">Mark correspondence</h2>
            <p className="mt-1 text-xs text-slate-500">Assign each recipient an action. Track is on by default.</p>
            <div className="mt-3 space-y-3">
              {recipients.map((row, idx) => (
                <div key={idx} className="rounded-lg border border-slate-200 p-3">
                  <label className="block text-xs font-medium text-slate-600">User</label>
                  <select
                    className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
                    value={row.toUser}
                    onChange={(e) => {
                      const next = [...recipients]
                      next[idx] = { ...row, toUser: e.target.value }
                      setRecipients(next)
                    }}
                  >
                    <option value="">Select user…</option>
                    {users.map((u) => (
                      <option key={u.name} value={u.name}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                  <label className="mt-2 block text-xs font-medium text-slate-600">Action</label>
                  <select
                    className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
                    value={row.action}
                    onChange={(e) => {
                      const next = [...recipients]
                      next[idx] = { ...row, action: e.target.value as MarkingAction }
                      setRecipients(next)
                    }}
                  >
                    {MARKING_ACTIONS.map((a) => (
                      <option key={a} value={a}>
                        {ACTION_LABELS[a]}
                      </option>
                    ))}
                  </select>
                  {row.action === 'response_required' && (
                    <>
                      <label className="mt-2 block text-xs font-medium text-slate-600">Response type</label>
                      <select
                        className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
                        value={row.responseType || 'draft_letter'}
                        onChange={(e) => {
                          const next = [...recipients]
                          next[idx] = { ...row, responseType: e.target.value as ResponseType }
                          setRecipients(next)
                        }}
                      >
                        {RESPONSE_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {RESPONSE_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                      <label className="mt-2 block text-xs font-medium text-slate-600">Due date</label>
                      <input
                        type="date"
                        className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
                        value={row.dueAt || ''}
                        onChange={(e) => {
                          const next = [...recipients]
                          next[idx] = { ...row, dueAt: e.target.value }
                          setRecipients(next)
                        }}
                      />
                    </>
                  )}
                  <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={row.track !== false}
                      onChange={(e) => {
                        const next = [...recipients]
                        next[idx] = { ...row, track: e.target.checked }
                        setRecipients(next)
                      }}
                    />
                    Track this marking
                  </label>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="mt-2 text-xs font-medium text-sky-700"
              onClick={() => setRecipients([...recipients, emptyRecipient()])}
            >
              + Add recipient
            </button>
            <label className="mt-3 block text-xs font-medium text-slate-600">Remarks</label>
            <textarea
              className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
              rows={2}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
            <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={pathwayNotify} onChange={(e) => setPathwayNotify(e.target.checked)} />
              Notify me of the pathway (further marks / responses)
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" disabled={busy} onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const cleaned = recipients.filter((r) => r.toUser.trim())
                    if (!cleaned.length) throw new Error('Select at least one recipient')
                    await markLetter(letter.id, {
                      recipients: cleaned.map((r) => ({
                        ...r,
                        responseType: r.action === 'response_required' ? r.responseType || 'draft_letter' : undefined,
                        remindersEnabled: r.action === 'response_required' ? r.track !== false : false,
                      })),
                      remarks,
                      pathwayNotify,
                    })
                  })
                }
              >
                Mark
              </Button>
            </div>
          </div>
        </div>
      )}

      {(dialog === 'note' || dialog === 'respond') && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-4 shadow-xl">
            <h2 className="text-sm font-bold">{dialog === 'note' ? 'Add note' : 'Submit response'}</h2>
            <textarea
              className="mt-2 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
              rows={4}
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              placeholder={dialog === 'note' ? 'Your input…' : 'Your response…'}
            />

            <div className="mt-3 rounded-lg border border-slate-200 p-3">
              <p className="text-xs font-semibold text-slate-700">Attachments</p>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <div className="min-w-[8rem] flex-1">
                  <label className="block text-[11px] font-medium text-slate-500">Type</label>
                  <select
                    className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
                    value={defaultKind}
                    onChange={(e) => setDefaultKind(e.target.value as AttachmentKind)}
                  >
                    {ATTACHMENT_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {kind}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                  <Paperclip className="h-3.5 w-3.5" />
                  Add files
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files || [])
                      if (!files.length) return
                      setPendingFiles((prev) => [
                        ...prev,
                        ...files.map((file) => ({
                          id: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
                          file,
                          kind: defaultKind,
                        })),
                      ])
                      e.target.value = ''
                    }}
                  />
                </label>
              </div>
              {pendingFiles.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {pendingFiles.map((item) => (
                    <li key={item.id} className="flex items-center gap-2 text-xs text-slate-700">
                      <select
                        className="rounded border border-slate-200 px-1.5 py-1"
                        value={item.kind}
                        onChange={(e) => {
                          const kind = e.target.value as AttachmentKind
                          setPendingFiles((prev) =>
                            prev.map((row) => (row.id === item.id ? { ...row, kind } : row)),
                          )
                        }}
                      >
                        {ATTACHMENT_KINDS.map((kind) => (
                          <option key={kind} value={kind}>
                            {kind}
                          </option>
                        ))}
                      </select>
                      <span className="min-w-0 flex-1 truncate">{item.file.name}</span>
                      <button
                        type="button"
                        className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                        onClick={() => setPendingFiles((prev) => prev.filter((row) => row.id !== item.id))}
                        aria-label="Remove file"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-3 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setDialog(null)
                  setPendingFiles([])
                  setNoteBody('')
                }}
              >
                Cancel
              </Button>
              {dialog === 'note' ? (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      if (!noteBody.trim()) throw new Error('Note text is required')
                      const attachments = await uploadPendingAttachments()
                      await addMarkingNote(letter.id, { bodyText: noteBody, attachments })
                    })
                  }
                >
                  Save note
                </Button>
              ) : (
                <Button
                  disabled={busy || !respondMarkingId}
                  onClick={() =>
                    void run(async () => {
                      if (!respondMarkingId) throw new Error('No open Response Required marking')
                      if (!noteBody.trim()) throw new Error('Response text is required')
                      const attachments = await uploadPendingAttachments()
                      await respondToMarking(respondMarkingId, { bodyText: noteBody, attachments })
                    })
                  }
                >
                  <CornerUpLeft className="mr-1 h-3.5 w-3.5" /> Submit
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {dialog === 'close' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl">
            <h2 className="text-sm font-bold">Close correspondence</h2>
            <textarea
              className="mt-2 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
              rows={2}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Close remarks"
            />
            <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={forceClose} onChange={(e) => setForceClose(e.target.checked)} />
              Force close even if Response Required markings are still open
            </label>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await closeMarkedLetter(letter.id, { remarks, force: forceClose })
                  })
                }
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </CollapsibleCard>
  )
}
