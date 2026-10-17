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
  Replace,
  Send,
  Trash2,
  X,
  XCircle,
} from 'lucide-react'
import { AppSelect } from '@/components/ui/app-select'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CollapsibleCard } from '@/components/ui/collapsible-card'
import {
  AnimatedProgressStepper,
  type AnimatedProgressStep,
} from '@/components/ui/animated-progress-stepper'
import { useAppData } from '@/components/app-provider'
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
  addAttachmentsToMarking,
  addMarkingNote,
  closeMarkedLetter,
  deleteMarkingAttachment,
  deleteMarkingNote,
  fetchMarkingActions,
  fetchMarkingAttachments,
  fetchMarkingNotes,
  fetchMarkingTree,
  markAttachmentReplaced,
  markLetter,
  markingActionLabel,
  respondToMarking,
  revokeMarking,
  updateMarkingAttachment,
  updateMarkingNote,
  type CorrespondenceAttachment,
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

type MarkingIncidentKey = number | 'root'

function markingKey(id: number | null | undefined): MarkingIncidentKey {
  return id == null ? 'root' : id
}

/** Group notes + attachments by the marking incident they belong to. */
function groupByMarkingIncident(
  notes: CorrespondenceNote[],
  attachments: CorrespondenceAttachment[],
): { key: MarkingIncidentKey; notes: CorrespondenceNote[]; attachments: CorrespondenceAttachment[] }[] {
  const order: MarkingIncidentKey[] = []
  const map = new Map<MarkingIncidentKey, { notes: CorrespondenceNote[]; attachments: CorrespondenceAttachment[] }>()
  const ensure = (key: MarkingIncidentKey) => {
    if (!map.has(key)) {
      map.set(key, { notes: [], attachments: [] })
      order.push(key)
    }
    return map.get(key)!
  }
  for (const note of notes) ensure(markingKey(note.markingId)).notes.push(note)
  for (const att of attachments) ensure(markingKey(att.markingId)).attachments.push(att)
  return order.map((key) => ({ key, ...map.get(key)! }))
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
  const { me } = useAppData()
  const [actions, setActions] = useState<string[]>([])
  const [tree, setTree] = useState<MarkingNode[]>([])
  const [notes, setNotes] = useState<CorrespondenceNote[]>([])
  const [attachments, setAttachments] = useState<CorrespondenceAttachment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dialog, setDialog] = useState<'mark' | 'note' | 'respond' | 'attach' | 'close' | null>(null)
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

  const canAddAttachment = actions.includes('add_note')

  const flatMarkings = useMemo(() => flattenMarkings(tree), [tree])
  const markingById = useMemo(() => {
    const map = new Map<number, MarkingNode>()
    for (const m of flatMarkings) map.set(m.id, m)
    return map
  }, [flatMarkings])

  const incidentGroups = useMemo(
    () => groupByMarkingIncident(notes, attachments),
    [notes, attachments],
  )

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
      const [available, markingTree, noteRows, attachmentRows] = await Promise.all([
        fetchMarkingActions(letter.id),
        fetchMarkingTree(letter.id),
        fetchMarkingNotes(letter.id),
        fetchMarkingAttachments(letter.id),
      ])
      setActions(available.actions)
      setTree(markingTree)
      setNotes(noteRows)
      setAttachments(attachmentRows)
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

  // Only the last marker can revoke: their own active outbound with no children.
  const revokableMarkings = useMemo(() => {
    if (!actions.includes('revoke')) return []
    const meName = (me.name || '').trim()
    if (!meName) return []
    return allMarkings.filter(
      (m) =>
        m.status === 'active' &&
        m.fromUser === meName &&
        m.children.length === 0,
    )
  }, [actions, allMarkings, me.name])

  return (
    <CollapsibleCard collapsible={false}>
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
          {revokableMarkings.map((m) => (
            <Button
              key={m.id}
              type="button"
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await revokeMarking(m.id)
                })
              }
            >
              <CornerUpLeft className="mr-1 h-3.5 w-3.5" />
              Revoke mark to {m.toUser}
            </Button>
          ))}
          {canAddAttachment && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setPendingFiles([])
                setDialog('attach')
              }}
            >
              <Paperclip className="mr-1 h-3.5 w-3.5" /> Add attachment
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
        {incidentGroups.length === 0 && (
          <p className="text-xs text-slate-500">No notes or attachments yet.</p>
        )}
        <ul className="space-y-4">
          {incidentGroups.map((incident) => {
            const marking = incident.key === 'root' ? null : markingById.get(incident.key) ?? null
            const title = marking
              ? `${marking.fromUser} → ${marking.toUser}`
              : 'Initiator hold'
            const subtitle = marking ? markingActionLabel(marking.action) : 'Before first mark'
            return (
              <li
                key={`incident-${incident.key}`}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
              >
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
                  <p className="text-sm font-semibold text-slate-800">{title}</p>
                  <Badge>{subtitle}</Badge>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3">
                  <div className="divide-y divide-slate-100 px-4 py-1 md:col-span-2 md:border-r md:border-slate-100">
                    <p className="pt-3 text-[10px] font-bold uppercase tracking-wide text-slate-500">Notes</p>
                    {incident.notes.length === 0 ? (
                      <p className="pb-3 text-xs text-slate-400">None</p>
                    ) : (
                      groupNotesByAuthor(incident.notes).map((group) => {
                        const author = group[0]?.authorUser ?? ''
                        const hasResponse = group.some((n) => n.isResponse)
                        const groupEditable = group.some((n) => n.editable)
                        return (
                          <div key={`note-group-${group[0]?.id ?? author}`} className="py-2">
                            <div className="mb-1 flex items-center gap-2">
                              <p className="text-xs font-semibold text-slate-700">{author}</p>
                              {hasResponse && <Badge>Response</Badge>}
                              {!groupEditable && (
                                <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                                  Locked
                                </span>
                              )}
                            </div>
                            {group.map((note) => (
                              <div key={note.id} className="border-t border-slate-50 py-2.5 first:border-t-0">
                                <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                                  <span>{note.createdAt ? formatDateTime(note.createdAt) : ''}</span>
                                  {note.clientIp ? <span>IP {note.clientIp}</span> : null}
                                  {note.isResponse ? (
                                    <span className="font-medium text-slate-600">Response</span>
                                  ) : null}
                                  {note.editable && (
                                    <span className="ml-auto flex flex-wrap gap-1.5">
                                      <Button
                                        type="button"
                                        size="xs"
                                        variant="outline"
                                        onClick={() => {
                                          setEditingNoteId(note.id)
                                          setEditingNoteBody(note.bodyText)
                                        }}
                                      >
                                        <Pencil data-icon="inline-start" /> Edit
                                      </Button>
                                      <Button
                                        type="button"
                                        size="xs"
                                        variant="destructive"
                                        disabled={busy}
                                        onClick={() =>
                                          void run(async () => {
                                            await deleteMarkingNote(note.id)
                                          })
                                        }
                                      >
                                        <Trash2 data-icon="inline-start" /> Delete
                                      </Button>
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
                              </div>
                            ))}
                          </div>
                        )
                      })
                    )}
                  </div>
                  <div className="border-t border-slate-100 bg-slate-50/80 px-3 py-3 md:col-span-1 md:border-t-0">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      Attachments
                    </p>
                    {incident.attachments.length === 0 ? (
                      <p className="text-xs text-slate-400">None</p>
                    ) : (
                      <ul className="space-y-2">
                        {incident.attachments.map((a) => (
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
                                {a.createdBy ? (
                                  <p className="mt-0.5 text-[10px] text-slate-500">{a.createdBy}</p>
                                ) : null}
                                {a.editable ? (
                                  <AppSelect
                                    value={a.attachmentKind}
                                    disabled={busy}
                                    onValueChange={(v) =>
                                      void run(async () => {
                                        await updateMarkingAttachment(a.id, {
                                          attachmentKind: v,
                                        })
                                      })
                                    }
                                    options={ATTACHMENT_KINDS.map((kind) => kind)}
                                    size="sm"
                                    className="mt-1 w-full text-[10px]"
                                  />
                                ) : (
                                  <p className="mt-0.5 text-[10px] font-medium text-slate-500">
                                    {a.attachmentKind}
                                  </p>
                                )}
                                {a.clientIp ? (
                                  <p className="mt-0.5 text-[10px] text-slate-400">IP {a.clientIp}</p>
                                ) : null}
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                  {a.versionId && a.previewable ? (
                                    <Button
                                      type="button"
                                      size="xs"
                                      variant="outline"
                                      onClick={() => setPreviewVersionId(a.versionId)}
                                    >
                                      <Eye data-icon="inline-start" /> Preview
                                    </Button>
                                  ) : null}
                                  {a.versionId ? (
                                    <a
                                      href={documentDownloadUrl(a.versionId)}
                                      target="_blank"
                                      rel="noreferrer"
                                      className={cn(buttonVariants({ size: 'xs', variant: 'outline' }))}
                                    >
                                      <ExternalLink data-icon="inline-start" className="size-3" /> Open
                                    </a>
                                  ) : null}
                                  {a.editable && a.documentId ? (
                                    <label
                                      className={cn(
                                        buttonVariants({ size: 'xs', variant: 'outline' }),
                                        'cursor-pointer',
                                      )}
                                    >
                                      <Replace data-icon="inline-start" className="size-3" /> Replace
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
                                  {a.editable ? (
                                    <Button
                                      type="button"
                                      size="xs"
                                      variant="destructive"
                                      disabled={busy}
                                      onClick={() =>
                                        void run(async () => {
                                          await deleteMarkingAttachment(a.id)
                                        })
                                      }
                                    >
                                      <Trash2 data-icon="inline-start" /> Delete
                                    </Button>
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
                  className={cn(buttonVariants({ size: 'sm', variant: 'outline' }))}
                >
                  <ExternalLink data-icon="inline-start" className="size-3.5" /> Open / download
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
                  <AppSelect
                    value={row.toUser}
                    onValueChange={(v) => {
                      const next = [...recipients]
                      next[idx] = { ...row, toUser: v }
                      setRecipients(next)
                    }}
                    options={[
                      { value: '', label: 'Select user…' },
                      ...users.map((u) => ({ value: u.name, label: u.name })),
                    ]}
                    className="mt-1 w-full text-sm"
                  />
                  <label className="mt-2 block text-xs font-medium text-slate-600">Action</label>
                  <AppSelect
                    value={row.action}
                    onValueChange={(v) => {
                      const next = [...recipients]
                      next[idx] = { ...row, action: v as MarkingAction }
                      setRecipients(next)
                    }}
                    options={MARKING_ACTIONS.map((a) => ({ value: a, label: ACTION_LABELS[a] }))}
                    className="mt-1 w-full text-sm"
                  />
                  {row.action === 'response_required' && (
                    <>
                      <label className="mt-2 block text-xs font-medium text-slate-600">Response type</label>
                      <AppSelect
                        value={row.responseType || 'draft_letter'}
                        onValueChange={(v) => {
                          const next = [...recipients]
                          next[idx] = { ...row, responseType: v as ResponseType }
                          setRecipients(next)
                        }}
                        options={RESPONSE_TYPES.map((t) => ({ value: t, label: RESPONSE_TYPE_LABELS[t] }))}
                        className="mt-1 w-full text-sm"
                      />
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
            <Button
              type="button"
              size="xs"
              variant="outline"
              className="mt-2"
              onClick={() => setRecipients([...recipients, emptyRecipient()])}
            >
              + Add recipient
            </Button>
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
          <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl">
            <h2 className="text-sm font-bold">{dialog === 'note' ? 'Add note' : 'Submit response'}</h2>
            <textarea
              className="mt-2 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
              rows={4}
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              placeholder={dialog === 'note' ? 'Your input…' : 'Your response…'}
            />
            <p className="mt-2 text-[11px] text-slate-400">
              Use <span className="font-medium">Add attachment</span> to attach files separately.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setDialog(null)
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
                      await addMarkingNote(letter.id, { bodyText: noteBody })
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
                      await respondToMarking(respondMarkingId, { bodyText: noteBody })
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

      {dialog === 'attach' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-4 shadow-xl">
            <h2 className="text-sm font-bold">Add attachment</h2>
            <p className="mt-1 text-xs text-slate-500">
              Files are linked to your current marking hold, not to individual notes.
            </p>
            <div className="mt-3 rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[8rem] flex-1">
                  <label className="block text-[11px] font-medium text-slate-500">Type</label>
                  <AppSelect
                    value={defaultKind}
                    onValueChange={(v) => setDefaultKind(v as AttachmentKind)}
                    options={ATTACHMENT_KINDS.map((kind) => kind)}
                    className="mt-1 w-full text-sm"
                  />
                </div>
                <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                  <Paperclip className="h-3.5 w-3.5" />
                  Choose files
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
                      <AppSelect
                        value={item.kind}
                        onValueChange={(v) => {
                          const kind = v as AttachmentKind
                          setPendingFiles((prev) =>
                            prev.map((row) => (row.id === item.id ? { ...row, kind } : row)),
                          )
                        }}
                        options={ATTACHMENT_KINDS.map((kind) => kind)}
                        size="sm"
                        className="min-w-24"
                      />
                      <span className="min-w-0 flex-1 truncate">{item.file.name}</span>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        onClick={() =>
                          setPendingFiles((prev) => prev.filter((row) => row.id !== item.id))
                        }
                        aria-label="Remove file"
                      >
                        <X />
                      </Button>
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
                }}
              >
                Cancel
              </Button>
              <Button
                disabled={busy || !canAddAttachment || pendingFiles.length === 0}
                onClick={() =>
                  void run(async () => {
                    if (!pendingFiles.length) throw new Error('Choose at least one file')
                    const uploaded = await uploadPendingAttachments()
                    await addAttachmentsToMarking(letter.id, uploaded)
                  })
                }
              >
                Upload
              </Button>
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
