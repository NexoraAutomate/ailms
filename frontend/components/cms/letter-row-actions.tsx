'use client'

import { useState } from 'react'
import type { ComponentType } from 'react'
import {
  Archive,
  ArrowUpRight,
  CheckCircle2,
  CornerUpLeft,
  MessageSquare,
  Pencil,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  UserPlus,
  UserRoundCog,
  X,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconActionButton } from '@/components/ui/icon-action-button'
import { Card } from '@/components/cms/ui'
import { ReplyDialog } from '@/components/cms/reply-dialog'
import {
  actionNeedsInput,
  letterActionLabel,
  letterRowActions,
  type LetterRowActionId,
} from '@/services/letter-actions'
import { updateLetter, type Letter, type Priority } from '@/services/letters'
import { executeWorkflow } from '@/services/workflow'

type Person = { name: string; department?: string }
type Dept = { name: string }

const ACTION_ICONS: Record<LetterRowActionId, ComponentType<{ className?: string }>> = {
  edit: Pencil,
  delete: Trash2,
  assign: UserPlus,
  forward: Send,
  reassign: UserRoundCog,
  reply: MessageSquare,
  request_clarification: CornerUpLeft,
  mark_complete: CheckCircle2,
  submit_for_approval: ShieldCheck,
  approve: CheckCircle2,
  reject: XCircle,
  return_for_revision: RefreshCw,
  escalate: ArrowUpRight,
  reopen: RefreshCw,
  close: XCircle,
  archive: Archive,
}

export function LetterRowActions({
  letter,
  role,
  users,
  departments,
  onChanged,
  onDelete,
}: {
  letter: Letter
  role: string
  users: Person[]
  departments: Dept[]
  onChanged: () => Promise<void>
  onDelete: () => void
}) {
  const actions = letterRowActions(letter, role)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<LetterRowActionId | null>(null)
  const [editing, setEditing] = useState(false)
  const [replyOpen, setReplyOpen] = useState(false)
  const [remarks, setRemarks] = useState('')
  const [assignedTo, setAssignedTo] = useState(letter.assignedTo || '')
  const [level, setLevel] = useState('Level 1')

  const runWorkflow = async (action: LetterRowActionId, input?: { remarks: string; assignedTo: string; level: string }) => {
    if (action === 'edit' || action === 'delete' || action === 'reply') return
    const note = input?.remarks ?? ''
    const person = input?.assignedTo ?? ''
    if ((action === 'assign' || action === 'reassign' || action === 'submit_for_approval') && !person.trim()) {
      setError('Select a person before continuing.')
      return
    }
    if ((action === 'approve' || action === 'reject' || action === 'return_for_revision' || action === 'escalate') && !note.trim()) {
      setError('Remarks are required for this action.')
      return
    }
    if (action === 'escalate' && !person.trim()) {
      setError('Select who to escalate to.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await executeWorkflow(letter.id, {
        action,
        remarks: note,
        assignedTo: person.trim() ? person : undefined,
        reviewerName: action === 'submit_for_approval' ? person : undefined,
        escalatedTo: action === 'escalate' ? person : undefined,
        escalationLevel: action === 'escalate' ? input?.level : undefined,
      })
      setPending(null)
      setRemarks('')
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  const start = (action: LetterRowActionId) => {
    setError('')
    if (action === 'delete') {
      onDelete()
      return
    }
    if (action === 'edit') {
      setEditing(true)
      return
    }
    if (action === 'reply') {
      setReplyOpen(true)
      return
    }
    if (actionNeedsInput(action)) {
      setRemarks('')
      setAssignedTo(letter.assignedTo || '')
      setLevel('Level 1')
      setPending(action)
      return
    }
    void runWorkflow(action)
  }

  if (actions.length === 0) return <span className="text-[11px] text-slate-300">—</span>

  return (
    <div className="flex max-w-[280px] flex-wrap gap-0">
      {actions.map((action) => (
        <IconActionButton
          key={action}
          label={letterActionLabel[action]}
          icon={ACTION_ICONS[action]}
          tone={action === 'delete' || action === 'reject' ? 'danger' : 'default'}
          disabled={busy}
          onClick={() => start(action)}
        />
      ))}
      {error && !pending && !editing && !replyOpen && <p className="basis-full text-[11px] text-red-600">{error}</p>}
      {editing && (
        <EditLetterDialog
          letter={letter}
          users={users}
          departments={departments}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false)
            await onChanged()
          }}
        />
      )}
      {replyOpen && (
        <ReplyDialog
          letter={letter}
          users={users}
          role={role}
          onClose={() => setReplyOpen(false)}
          onDone={onChanged}
        />
      )}
      {pending && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/30 p-4">
          <Card className="w-full max-w-lg p-5" role="dialog" aria-modal="true" aria-labelledby="letter-action-title">
            <div className="mb-4 flex items-center justify-between">
              <h2 id="letter-action-title" className="text-sm font-bold text-slate-700">{letterActionLabel[pending]} · {letter.number}</h2>
              <IconActionButton label="Close" icon={X} onClick={() => setPending(null)} />
            </div>
            {error && <p className="mb-3 text-xs text-red-600">{error}</p>}
            {(pending === 'assign' || pending === 'reassign' || pending === 'submit_for_approval' || pending === 'escalate' || pending === 'forward') && (
              <label className="mb-3 flex flex-col gap-1">
                <span className="text-xs font-semibold text-slate-600">
                  {pending === 'escalate' ? 'Escalate to' : pending === 'submit_for_approval' ? 'Reviewer' : pending === 'forward' ? 'Forward to' : 'Assign to'}
                </span>
                <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-xs">
                  <option value="">{pending === 'forward' ? 'Keep current assignee' : 'Select…'}</option>
                  {users.map((user) => (
                    <option key={user.name} value={user.name}>
                      {user.name}{user.department ? ` · ${user.department}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {pending === 'escalate' && (
              <label className="mb-3 flex flex-col gap-1">
                <span className="text-xs font-semibold text-slate-600">Escalation level</span>
                <select value={level} onChange={(e) => setLevel(e.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-xs">
                  {['Level 1', 'Level 2', 'Level 3'].map((item) => <option key={item}>{item}</option>)}
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-slate-600">Remarks</span>
              <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} className="min-h-24 rounded-md border border-slate-200 px-3 py-2 text-xs" />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setPending(null)} disabled={busy}>Cancel</Button>
              <Button type="button" onClick={() => void runWorkflow(pending, { remarks, assignedTo, level })} disabled={busy}>
                {letterActionLabel[pending]}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

function EditLetterDialog({
  letter,
  users,
  departments,
  onClose,
  onSaved,
}: {
  letter: Letter
  users: Person[]
  departments: Dept[]
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [subject, setSubject] = useState(letter.subject)
  const [from, setFrom] = useState(letter.from)
  const [to, setTo] = useState(letter.to)
  const [department, setDepartment] = useState(letter.department)
  const [priority, setPriority] = useState<Priority>(letter.priority)
  const [assignedTo, setAssignedTo] = useState(letter.assignedTo)
  const [dueDate, setDueDate] = useState(letter.dueDate)
  const [actionRequired, setActionRequired] = useState(letter.actionRequired ?? '')
  const [remarks, setRemarks] = useState(letter.remarks ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const deptNames = [...new Set([letter.department, ...departments.map((item) => item.name)].filter(Boolean))]

  const save = async () => {
    if (!subject.trim()) {
      setError('Subject is required.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await updateLetter(letter.id, {
        subject: subject.trim(),
        from,
        to,
        department,
        priority,
        assignedTo,
        dueDate: dueDate || undefined,
        actionRequired,
        remarks,
      })
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save letter')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/30 p-4">
      <Card className="w-full max-w-2xl p-5" role="dialog" aria-modal="true" aria-labelledby="edit-letter-title">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="edit-letter-title" className="text-sm font-bold text-slate-700">Edit {letter.number}</h2>
          <IconActionButton label="Close" icon={X} onClick={onClose} />
        </div>
        {error && <p className="mb-3 text-xs text-red-600">{error}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 sm:col-span-2"><span className="text-xs font-semibold text-slate-600">Subject</span><input value={subject} onChange={(e) => setSubject(e.target.value)} className="h-10 rounded-md border border-slate-200 px-3 text-xs" /></label>
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-slate-600">From</span><input value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 rounded-md border border-slate-200 px-3 text-xs" /></label>
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-slate-600">To</span><input value={to} onChange={(e) => setTo(e.target.value)} className="h-10 rounded-md border border-slate-200 px-3 text-xs" /></label>
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-slate-600">Department</span>
            <select value={department} onChange={(e) => setDepartment(e.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-xs">
              {deptNames.map((name) => <option key={name}>{name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-slate-600">Priority</span>
            <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-xs">
              {['Routine', 'Important', 'Urgent'].map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-slate-600">Assigned to</span>
            <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-xs">
              <option value="">Unassigned</option>
              {users.map((user) => (
                <option key={user.name} value={user.name}>
                  {user.name}{user.department ? ` · ${user.department}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-slate-600">Due date</span><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-10 rounded-md border border-slate-200 px-3 text-xs" /></label>
          <label className="flex flex-col gap-1 sm:col-span-2"><span className="text-xs font-semibold text-slate-600">Action required</span><input value={actionRequired} onChange={(e) => setActionRequired(e.target.value)} className="h-10 rounded-md border border-slate-200 px-3 text-xs" /></label>
          <label className="flex flex-col gap-1 sm:col-span-2"><span className="text-xs font-semibold text-slate-600">Remarks</span><textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} className="min-h-20 rounded-md border border-slate-200 px-3 py-2 text-xs" /></label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="button" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </Card>
    </div>
  )
}
