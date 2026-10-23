'use client'

import { useEffect, useState } from 'react'
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Calendar,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  ClipboardList,
  FileText,
  GitBranch,
  Inbox,
  Link2,
  Lock,
  Paperclip,
  Pencil,
  Send,
  Sparkles,
} from 'lucide-react'
import { useAppData } from '@/components/app-provider'
import { AIAnalyzeDocument, AIIntelligencePanel } from '@/components/ai/letter-tools'
import { Button } from '@/components/ui/button'
import { AppSelect } from '@/components/ui/app-select'
import { AppTabList, AppTabPanel, appTabClass } from '@/components/ui/app-tabs'
import { AssignedToDisplay } from '@/components/cms/assigned-to-display'
import { Badge, Card, PageTitle } from '@/components/cms/ui'
import { CollapsibleCardMotionProvider } from '@/components/ui/collapsible-card'
import { getLetter, priorityTone, statusTone, updateLetter, type Letter, type Priority } from '@/services/letters'
import {
  CorrespondenceThreadPanel,
  DocumentsPanel,
  RelatedMeetingsPanel,
} from '@/components/cms/letter-panels'
import { MarkingWorkflowPanel } from '@/components/cms/marking-workflow-panel'

type LetterTabId = 'details' | 'attachments' | 'workflow' | 'meetings' | 'references' | 'ai'
type AttachmentsSubTabId = 'correspondence' | 'analysis'

const LETTER_TABS: {
  id: LetterTabId
  label: string
  icon: React.ComponentType<{ className?: string }>
}[] = [
  { id: 'details', label: 'Correspondence Details', icon: FileText },
  { id: 'attachments', label: 'Attachments', icon: Paperclip },
  { id: 'workflow', label: 'Workflow', icon: GitBranch },
  { id: 'meetings', label: 'Related Meetings', icon: CalendarDays },
  { id: 'references', label: 'Reference & Linked Letters', icon: Link2 },
  { id: 'ai', label: 'AI Intelligence Panel', icon: Sparkles },
]

const ATTACHMENTS_SUB_TABS: {
  id: AttachmentsSubTabId
  label: string
  icon: React.ComponentType<{ className?: string }>
}[] = [
  { id: 'correspondence', label: 'Correspondence Attachments', icon: Paperclip },
  { id: 'analysis', label: 'Attachment Analysis', icon: Sparkles },
]

export function Details({ id, go }: { id: string; go: (p: string) => void }) {
  const { letters, users, me, refresh, applyLetterField, acceptAiAction, departments, organizations, masterData } = useAppData()
  const [tab, setTab] = useState<LetterTabId>('details')
  const [attachmentsSubTab, setAttachmentsSubTab] = useState<AttachmentsSubTabId>('correspondence')
  const cached = letters.find((item) => item.id === id) ?? null
  const [letter, setLetter] = useState<Letter | null>(cached)
  const [loading, setLoading] = useState(!cached)
  const [denied, setDenied] = useState(false)

  useEffect(() => {
    setTab('details')
    setAttachmentsSubTab('correspondence')
  }, [id])

  useEffect(() => {
    const fromCache = letters.find((item) => item.id === id) ?? null
    if (fromCache) {
      setLetter(fromCache)
      setLoading(false)
      setDenied(false)
    } else {
      setLoading(true)
      setDenied(false)
    }

    let cancelled = false
    // Always load the letter endpoint so canEditDetails / body are authoritative
    // (bootstrap list omits body and previously omitted edit flags).
    getLetter(id)
      .then((row) => {
        if (!cancelled) {
          setLetter(row)
          setLoading(false)
          setDenied(false)
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (fromCache) {
          setLoading(false)
          return
        }
        const message = err instanceof Error ? err.message : String(err)
        setDenied(/403|access|forbidden/i.test(message))
        setLetter(null)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id, letters])

  if (loading) return <p className="text-sm text-slate-500">Loading letter…</p>
  if (denied) {
    return (
      <Card className="flex flex-col items-start gap-3 p-8">
        <div className="flex items-center gap-2 text-slate-600">
          <Lock className="size-5" />
          <h2 className="text-sm font-bold">Letter locked</h2>
        </div>
        <p className="text-sm text-slate-500">This correspondence is not marked to you, so detail access is restricted.</p>
        <Button variant="outline" onClick={() => go('Catalog')}>Back to Catalog</Button>
      </Card>
    )
  }
  if (!letter) return <p className="text-sm text-slate-500">Letter not found.</p>

  const TypeIcon = letter.type === 'Incoming' ? Inbox : Send
  const PriorityIcon = letter.priority === 'Urgent' ? CircleAlert : letter.priority === 'Important' ? ClipboardList : CheckCircle2
  const StatusIcon =
    letter.status === 'Overdue'
      ? CircleAlert
      : letter.status === 'Closed' || letter.status === 'Completed' || letter.status === 'Archived'
        ? CheckCircle2
        : ClipboardList

  return (
    <>
      <Button variant="outline" size="xs" className="mb-4" onClick={() => go('All Letters')}>← Back to letter database</Button>
      <PageTitle
        title={letter.subject}
        description={
          <>
            <p className="font-medium text-slate-600">{letter.number}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge tone={letter.type === 'Incoming' ? 'blue' : 'violet'}>
                <TypeIcon className="size-3" />
                {letter.type}
              </Badge>
              <Badge tone={priorityTone(letter.priority)}>
                <PriorityIcon className="size-3" />
                {letter.priority}
              </Badge>
              <Badge tone={statusTone(letter.status)}>
                <StatusIcon className="size-3" />
                {letter.status}
              </Badge>
            </div>
          </>
        }
      />

      <AppTabList>
        {LETTER_TABS.map(({ id: tabId, label, icon: Icon }) => (
          <button
            key={tabId}
            type="button"
            onClick={() => setTab(tabId)}
            className={appTabClass(tab === tabId)}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </AppTabList>

      <CollapsibleCardMotionProvider animated={false}>
        <AppTabPanel tabKey={tab}>
          {tab === 'details' && (
            <CorrespondenceDetailsPanel
              letter={letter}
              users={users}
              departments={departments}
              organizations={organizations}
              letterTypes={masterData['Letter Types'] ?? ['Incoming', 'Outgoing']}
              onSaved={async () => {
                await refresh()
                const next = await getLetter(letter.id)
                setLetter(next)
              }}
            />
          )}

          {tab === 'attachments' && (
            <div>
              <div className="mb-4 flex flex-wrap gap-2">
                {ATTACHMENTS_SUB_TABS.map(({ id: subId, label, icon: Icon }) => (
                  <button
                    key={subId}
                    type="button"
                    onClick={() => setAttachmentsSubTab(subId)}
                    className={appTabClass(attachmentsSubTab === subId)}
                  >
                    <Icon className="size-3.5" />
                    {label}
                  </button>
                ))}
              </div>
              <AppTabPanel tabKey={attachmentsSubTab}>
                {attachmentsSubTab === 'correspondence' ? (
                  <DocumentsPanel letter={letter} />
                ) : (
                  <AIAnalyzeDocument letter={letter} />
                )}
              </AppTabPanel>
            </div>
          )}

          {tab === 'workflow' && <MarkingWorkflowPanel letter={letter} users={users} onDone={refresh} />}

          {tab === 'meetings' && <RelatedMeetingsPanel letter={letter} go={go} />}

          {tab === 'references' && (
            <CorrespondenceThreadPanel letter={letter} go={go} />
          )}

          {tab === 'ai' && (
            <AIIntelligencePanel
              letter={letter}
              letters={letters}
              onApplyField={(field, value, decision) => applyLetterField(letter.id, field, value, decision)}
              onAcceptAction={(next, decision) => acceptAiAction(letter.id, next, decision)}
            />
          )}
        </AppTabPanel>
      </CollapsibleCardMotionProvider>
    </>
  )
}

type DetailsPerson = { name: string; department?: string }
type DetailsDept = { name: string }
type DetailsOrg = { name: string; status?: string }

function CorrespondenceDetailsPanel({
  letter,
  users,
  departments,
  organizations,
  letterTypes,
  onSaved,
}: {
  letter: Letter
  users: DetailsPerson[]
  departments: DetailsDept[]
  organizations: DetailsOrg[]
  letterTypes: string[]
  onSaved: () => Promise<void>
}) {
  const canEdit = letter.canEditDetails === true
  const [editing, setEditing] = useState(false)
  const [number, setNumber] = useState(letter.number)
  const [subject, setSubject] = useState(letter.subject)
  const [letterDate, setLetterDate] = useState(letter.letterDate)
  const [receivedDate, setReceivedDate] = useState(letter.receivedDate === '—' ? '' : letter.receivedDate)
  const [type, setType] = useState(letter.type)
  const [from, setFrom] = useState(letter.from)
  const [to, setTo] = useState(letter.to)
  const [department, setDepartment] = useState(letter.department)
  const [assignedTo, setAssignedTo] = useState(letter.assignedTo)
  const [dueDate, setDueDate] = useState(letter.dueDate === '—' ? '' : letter.dueDate)
  const [priority, setPriority] = useState<Priority>(letter.priority)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const syncFromLetter = () => {
    setNumber(letter.number)
    setSubject(letter.subject)
    setLetterDate(letter.letterDate)
    setReceivedDate(letter.receivedDate === '—' ? '' : letter.receivedDate)
    setType(letter.type)
    setFrom(letter.from)
    setTo(letter.to)
    setDepartment(letter.department)
    setAssignedTo(letter.assignedTo)
    setDueDate(letter.dueDate === '—' ? '' : letter.dueDate)
    setPriority(letter.priority)
    setError('')
  }

  useEffect(() => {
    syncFromLetter()
    if (!canEdit) setEditing(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset form when letter payload changes
  }, [letter, canEdit])

  const startEditing = () => {
    syncFromLetter()
    setEditing(true)
  }

  const cancelEditing = () => {
    syncFromLetter()
    setEditing(false)
  }

  const deptNames = [...new Set([letter.department, ...departments.map((item) => item.name)].filter(Boolean))]
  const typeOptions = [...new Set([letter.type, ...letterTypes].filter(Boolean))]
  const organizationOptions = [
    ...new Set([
      ...organizations
        .filter((org) => !org.status || org.status === 'Active')
        .map((org) => org.name),
      letter.from,
      letter.to,
      from,
      to,
    ].filter(Boolean)),
  ]

  const save = async () => {
    if (!number.trim()) {
      setError('Letter number is required.')
      return
    }
    if (!subject.trim()) {
      setError('Subject is required.')
      return
    }
    if (!letterDate) {
      setError('Letter date is required.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await updateLetter(letter.id, {
        number: number.trim(),
        subject: subject.trim(),
        letterDate,
        receivedDate: receivedDate || undefined,
        type,
        from,
        to,
        department,
        assignedTo,
        dueDate: dueDate || undefined,
        priority,
      })
      await onSaved()
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save correspondence details')
    } finally {
      setBusy(false)
    }
  }

  if (!editing) {
    return (
      <Card className="p-5">
        {canEdit ? (
          <div className="mb-4 flex items-start justify-end">
            <Button type="button" variant="outline" size="sm" onClick={startEditing}>
              <Pencil data-icon="inline-start" />
              Edit Details
            </Button>
          </div>
        ) : null}
        <div className="grid gap-5 lg:grid-cols-3 lg:items-start">
          <LetterPartiesCard from={letter.from} to={letter.to} organizationOptions={organizationOptions} />
          <LetterDatesCard
            letterDate={letter.letterDate}
            receivedDate={letter.receivedDate}
            dueDate={letter.dueDate}
          />
          <LetterOtherDetailsCard
            type={letter.type}
            department={letter.department}
            assignedTo={letter.assignedTo}
            lastAction={letter.lastAction}
          />
        </div>
        {!canEdit ? (
          <p className="mt-4 text-[11px] text-slate-400">
            Only the registrant can edit these details, and only until the correspondence is marked to another user.
          </p>
        ) : null}
      </Card>
    )
  }

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={cancelEditing} disabled={busy}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={() => void save()} disabled={busy}>
          {busy ? 'Saving…' : 'Save details'}
        </Button>
      </div>
      {error ? <p className="mb-3 text-xs text-red-600">{error}</p> : null}
      <div className="space-y-5">
        <LetterIdentityCard
          number={number}
          subject={subject}
          onNumberChange={setNumber}
          onSubjectChange={setSubject}
        />
        <div className="grid gap-5 lg:grid-cols-3 lg:items-start">
          <LetterPartiesCard
            editing
            from={from}
            to={to}
            organizationOptions={organizationOptions}
            onFromChange={setFrom}
            onToChange={setTo}
          />
          <LetterDatesCard
            editing
            letterDate={letterDate}
            receivedDate={receivedDate}
            dueDate={dueDate}
            onLetterDateChange={setLetterDate}
            onReceivedDateChange={setReceivedDate}
            onDueDateChange={setDueDate}
          />
          <LetterOtherDetailsCard
            editing
            type={type}
            priority={priority}
            department={department}
            assignedTo={assignedTo}
            lastAction={letter.lastAction}
            typeOptions={typeOptions}
            deptNames={deptNames}
            users={users}
            onTypeChange={setType}
            onPriorityChange={setPriority}
            onDepartmentChange={setDepartment}
            onAssignedToChange={setAssignedTo}
          />
        </div>
      </div>
    </Card>
  )
}

function LetterIdentityCard({
  number,
  subject,
  onNumberChange,
  onSubjectChange,
}: {
  number: string
  subject: string
  onNumberChange: (value: string) => void
  onSubjectChange: (value: string) => void
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-100 p-4 dark:bg-slate-900/40">
      <div className="mb-3 flex items-center gap-2 border-b border-slate-200/80 pb-2.5">
        <span className="inline-flex size-7 items-center justify-center rounded-md bg-white text-[#1769aa] shadow-sm ring-1 ring-slate-200">
          <FileText className="size-3.5" />
        </span>
        <h3 className="text-sm font-bold text-slate-700">Letter Identity</h3>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block rounded-md border border-slate-200/80 bg-white px-3 py-2.5">
          <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <FileText className="size-3.5 text-[#1769aa]" />
            Letter No.
          </span>
          <input
            value={number}
            onChange={(e) => onNumberChange(e.target.value)}
            className="mt-0.5 h-9 w-full rounded-md border border-slate-200 px-2 text-xs font-semibold text-slate-700"
          />
        </label>
        <label className="block rounded-md border border-slate-200/80 bg-white px-3 py-2.5 sm:col-span-1">
          <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <FileText className="size-3.5 text-[#1769aa]" />
            Subject
          </span>
          <input
            value={subject}
            onChange={(e) => onSubjectChange(e.target.value)}
            className="mt-0.5 h-9 w-full rounded-md border border-slate-200 px-2 text-xs font-semibold text-slate-700"
          />
        </label>
      </div>
    </div>
  )
}

function LetterOtherDetailsCard({
  type,
  department,
  assignedTo,
  lastAction,
  editing = false,
  priority,
  typeOptions = [],
  deptNames = [],
  users = [],
  onTypeChange,
  onPriorityChange,
  onDepartmentChange,
  onAssignedToChange,
}: {
  type: string
  department: string
  assignedTo: string
  lastAction: string
  editing?: boolean
  priority?: Priority
  typeOptions?: string[]
  deptNames?: string[]
  users?: DetailsPerson[]
  onTypeChange?: (value: string) => void
  onPriorityChange?: (value: Priority) => void
  onDepartmentChange?: (value: string) => void
  onAssignedToChange?: (value: string) => void
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-100 p-4 dark:bg-slate-900/40">
      <div className="mb-3 flex items-center gap-2 border-b border-slate-200/80 pb-2.5">
        <span className="inline-flex size-7 items-center justify-center rounded-md bg-white text-[#1769aa] shadow-sm ring-1 ring-slate-200">
          <ClipboardList className="size-3.5" />
        </span>
        <h3 className="text-sm font-bold text-slate-700">Other Details</h3>
      </div>
      <div className="space-y-3">
        {editing ? (
          <>
            <label className="block rounded-md border border-slate-200/80 bg-white px-3 py-2.5">
              <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <Send className="size-3.5 text-[#1769aa]" />
                Type
              </span>
              <AppSelect value={type} onValueChange={(v) => onTypeChange?.(v)} options={typeOptions} className="mt-0.5 h-9 text-xs" />
            </label>
            <label className="block rounded-md border border-slate-200/80 bg-white px-3 py-2.5">
              <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <CircleAlert className="size-3.5 text-[#1769aa]" />
                Priority
              </span>
              <AppSelect
                value={priority ?? 'Routine'}
                onValueChange={(v) => onPriorityChange?.(v as Priority)}
                options={['Routine', 'Important', 'Urgent']}
                className="mt-0.5 h-9 text-xs"
              />
            </label>
            <label className="block rounded-md border border-slate-200/80 bg-white px-3 py-2.5">
              <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <ClipboardList className="size-3.5 text-[#1769aa]" />
                Department
              </span>
              <AppSelect value={department} onValueChange={(v) => onDepartmentChange?.(v)} options={deptNames} className="mt-0.5 h-9 text-xs" />
            </label>
            <label className="block rounded-md border border-slate-200/80 bg-white px-3 py-2.5">
              <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <CheckCircle2 className="size-3.5 text-[#1769aa]" />
                Assigned to
              </span>
              <AppSelect
                value={assignedTo}
                onValueChange={(v) => onAssignedToChange?.(v)}
                options={[
                  { value: '', label: 'Unassigned' },
                  ...users.map((user) => ({
                    value: user.name,
                    label: user.name + (user.department ? ` · ${user.department}` : ''),
                  })),
                ]}
                className="mt-0.5 h-9 text-xs"
              />
            </label>
            <div className="rounded-md border border-slate-200/80 bg-white px-3 py-2.5">
              <div className="mb-1 flex items-center gap-1.5">
                <ClipboardList className="size-3.5 text-[#1769aa]" />
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Last action</p>
              </div>
              <p className="text-xs font-semibold text-slate-700">{lastAction || '—'}</p>
            </div>
          </>
        ) : (
          [
            { key: 'type', label: 'Type', icon: Send, value: type, assigned: false },
            { key: 'department', label: 'Department', icon: ClipboardList, value: department, assigned: false },
            { key: 'assigned', label: 'Assigned to', icon: CheckCircle2, value: assignedTo, assigned: true },
            { key: 'last', label: 'Last action', icon: FileText, value: lastAction, assigned: false },
          ].map(({ key, label, icon: Icon, value, assigned }) => (
            <div key={key} className="rounded-md border border-slate-200/80 bg-white px-3 py-2.5">
              <div className="mb-1 flex items-center gap-1.5">
                <Icon className="size-3.5 text-[#1769aa]" />
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
              </div>
              {assigned ? (
                <div className="text-xs font-semibold text-slate-700">
                  <AssignedToDisplay assignedTo={value} />
                </div>
              ) : (
                <p className="text-xs font-semibold text-slate-700">{value || '—'}</p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function LetterPartiesCard({
  from,
  to,
  editing = false,
  organizationOptions = [],
  onFromChange,
  onToChange,
}: {
  from: string
  to: string
  editing?: boolean
  organizationOptions?: string[]
  onFromChange?: (value: string) => void
  onToChange?: (value: string) => void
}) {
  const orgSelectOptions = [
    { value: '', label: 'Select organization…' },
    ...organizationOptions.map((name) => ({ value: name, label: name })),
  ]
  const rows = [
    {
      key: 'from',
      label: 'From',
      icon: ArrowUpRight,
      value: from,
      onChange: onFromChange,
    },
    {
      key: 'to',
      label: 'To',
      icon: ArrowDownLeft,
      value: to,
      onChange: onToChange,
    },
  ]

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-100 p-4 dark:bg-slate-900/40">
      <div className="mb-3 flex items-center gap-2 border-b border-slate-200/80 pb-2.5">
        <span className="inline-flex size-7 items-center justify-center rounded-md bg-white text-[#1769aa] shadow-sm ring-1 ring-slate-200">
          <ArrowLeftRight className="size-3.5" />
        </span>
        <h3 className="text-sm font-bold text-slate-700">Correspondents</h3>
      </div>
      <div className="space-y-3">
        {rows.map(({ key, label, icon: Icon, value, onChange }) => (
          <div key={key} className="rounded-md border border-slate-200/80 bg-white px-3 py-2.5">
            <div className="mb-1 flex items-center gap-1.5">
              <Icon className="size-3.5 text-[#1769aa]" />
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
            </div>
            {editing ? (
              <AppSelect
                value={value}
                onValueChange={(next) => onChange?.(next)}
                options={orgSelectOptions}
                className="mt-0.5 h-9 text-xs"
              />
            ) : (
              <p className="text-xs font-semibold text-slate-700">{value || '—'}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function LetterDatesCard({
  letterDate,
  receivedDate,
  dueDate,
  editing = false,
  onLetterDateChange,
  onReceivedDateChange,
  onDueDateChange,
}: {
  letterDate: string
  receivedDate: string
  dueDate: string
  editing?: boolean
  onLetterDateChange?: (value: string) => void
  onReceivedDateChange?: (value: string) => void
  onDueDateChange?: (value: string) => void
}) {
  const rows: {
    key: string
    label: string
    icon: typeof Calendar
    inputValue: string
    displayValue: string
    onChange?: (value: string) => void
  }[] = [
    {
      key: 'letter',
      label: 'Letter Date',
      icon: Calendar,
      inputValue: letterDate,
      displayValue: letterDate,
      onChange: onLetterDateChange,
    },
    {
      key: 'received',
      label: 'Receive Date',
      icon: Inbox,
      inputValue: receivedDate === '—' ? '' : receivedDate,
      displayValue: receivedDate,
      onChange: onReceivedDateChange,
    },
    {
      key: 'due',
      label: 'Due Date',
      icon: CalendarClock,
      inputValue: dueDate === '—' ? '' : dueDate,
      displayValue: dueDate,
      onChange: onDueDateChange,
    },
  ]

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-100 p-4 dark:bg-slate-900/40">
      <div className="mb-3 flex items-center gap-2 border-b border-slate-200/80 pb-2.5">
        <span className="inline-flex size-7 items-center justify-center rounded-md bg-white text-[#1769aa] shadow-sm ring-1 ring-slate-200">
          <CalendarDays className="size-3.5" />
        </span>
        <h3 className="text-sm font-bold text-slate-700">Dates</h3>
      </div>
      <div className="space-y-3">
        {rows.map(({ key, label, icon: Icon, inputValue, displayValue, onChange }) => (
          <div key={key} className="rounded-md border border-slate-200/80 bg-white px-3 py-2.5">
            <div className="mb-1 flex items-center gap-1.5">
              <Icon className="size-3.5 text-[#1769aa]" />
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
            </div>
            {editing ? (
              <input
                type="date"
                value={inputValue}
                onChange={(e) => onChange?.(e.target.value)}
                className="mt-0.5 h-9 w-full rounded-md border border-slate-200 px-2 text-xs font-semibold text-slate-700"
              />
            ) : (
              <p className="text-xs font-semibold text-slate-700">{displayValue || '—'}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
