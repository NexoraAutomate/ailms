'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Building2,
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
import { AppTab, AppTabList, AppTabPanel } from '@/components/ui/app-tabs'
import { AssignedToDisplay } from '@/components/cms/assigned-to-display'
import { Badge, Card } from '@/components/cms/ui'
import { CollapsibleCardMotionProvider } from '@/components/ui/collapsible-card'
import { letterDetailOrigin } from '@/lib/cms-nav'
import {
  formatDashDate,
  relativeDueDateInfo,
  relativePastDateInfo,
  type RelativeDateInfo,
} from '@/lib/datetime'
import { normalizeOrgColor, organizationCardStyle } from '@/lib/org-color'
import { cn } from '@/lib/utils'
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
  const searchParams = useSearchParams()
  const { letters, users, me, refresh, applyLetterField, acceptAiAction, departments, organizations } = useAppData()
  const initialTab = (searchParams.get('tab') as LetterTabId | null) || 'details'
  const [tab, setTab] = useState<LetterTabId>(
    LETTER_TABS.some((t) => t.id === initialTab) ? initialTab : 'details',
  )
  const [attachmentsSubTab, setAttachmentsSubTab] = useState<AttachmentsSubTabId>('correspondence')
  const cached = letters.find((item) => item.id === id) ?? null
  const [letter, setLetter] = useState<Letter | null>(cached)
  const [loading, setLoading] = useState(!cached)
  const [denied, setDenied] = useState(false)
  const stickySentinelRef = useRef<HTMLDivElement>(null)
  const [compactHeader, setCompactHeader] = useState(false)

  useEffect(() => {
    const fromQuery = searchParams.get('tab') as LetterTabId | null
    setTab(fromQuery && LETTER_TABS.some((t) => t.id === fromQuery) ? fromQuery : 'details')
    setAttachmentsSubTab('correspondence')
  }, [id, searchParams])

  useEffect(() => {
    const sentinel = stickySentinelRef.current
    if (!sentinel) return
    let root: Element | null = sentinel.parentElement
    while (root) {
      const { overflowY } = getComputedStyle(root)
      if (/(auto|scroll|overlay)/.test(overflowY)) break
      root = root.parentElement
    }
    const observer = new IntersectionObserver(
      ([entry]) => setCompactHeader(!entry.isIntersecting),
      { root, threshold: 0 },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [letter?.id])

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

  const origin = letterDetailOrigin(searchParams)
  const backTarget = origin === 'inbox' ? 'Inbox' : origin === 'sent' ? 'Sent' : 'All Letters'
  const backLabel =
    origin === 'inbox' ? '← Back to Inbox' : origin === 'sent' ? '← Back to Sent' : '← Back to letter database'

  return (
    <>
      <div ref={stickySentinelRef} aria-hidden className="h-px w-full" />
      <div
        className={cn(
          'sticky top-0 z-20 -mx-4 border-b border-slate-200/80 bg-[#f5f8fb]/95 px-4 backdrop-blur-md transition-[padding,box-shadow] duration-200 sm:-mx-7 sm:px-7 dark:border-slate-700/80 dark:bg-[color-mix(in_srgb,var(--background)_95%,transparent)]',
          compactHeader ? 'py-2 shadow-sm shadow-slate-900/5 dark:shadow-black/40' : 'pb-3 pt-0',
        )}
      >
        <Button
          variant="outline"
          size="xs"
          className={cn(compactHeader ? 'mb-1.5 h-6 px-2 text-[10px]' : 'mb-3')}
          onClick={() => go(backTarget)}
        >
          {backLabel}
        </Button>
        <div className={cn('min-w-0', compactHeader ? 'mb-1.5' : 'mb-3')}>
          <h1
            className={cn(
              'truncate font-bold tracking-tight text-[#102a43] transition-[font-size] duration-200',
              compactHeader ? 'text-base' : 'text-2xl',
            )}
            title={letter.subject}
          >
            {letter.subject}
          </h1>
          <div className={cn('flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1', compactHeader ? 'mt-0.5' : 'mt-1')}>
            <p className={cn('font-medium text-slate-600 dark:text-slate-300', compactHeader ? 'text-xs' : 'text-sm')}>{letter.number}</p>
            <div className={cn('flex flex-wrap gap-1.5', compactHeader && 'scale-90 origin-left')}>
              <Badge tone={letter.type === 'Incoming' ? 'blue' : 'violet'}>
                <TypeIcon className="size-3" />
                {letter.type}
              </Badge>
              {letter.department ? (
                <Badge tone="slate">
                  <Building2 className="size-3" />
                  {letter.department}
                </Badge>
              ) : null}
              <Badge tone={priorityTone(letter.priority)}>
                <PriorityIcon className="size-3" />
                {letter.priority}
              </Badge>
              <Badge tone={statusTone(letter.status)}>
                <StatusIcon className="size-3" />
                {letter.status}
              </Badge>
            </div>
          </div>
        </div>

        <AppTabList groupId="letter-detail-tabs" className={cn('mb-0', compactHeader && 'scale-[0.92] origin-left')}>
          {LETTER_TABS.map(({ id: tabId, label, icon: Icon }) => (
            <AppTab
              key={tabId}
              active={tab === tabId}
              onClick={() => setTab(tabId)}
              className={compactHeader ? 'gap-1.5 px-2.5 py-1.5 text-[11px]' : undefined}
            >
              <Icon className={compactHeader ? 'size-3' : 'size-3.5'} />
              {label}
            </AppTab>
          ))}
        </AppTabList>
      </div>

      <div className="pt-4">
        <CollapsibleCardMotionProvider animated={false}>
          <AppTabPanel tabKey={tab}>
            {tab === 'details' && (
              <CorrespondenceDetailsPanel
                letter={letter}
                users={users}
                departments={departments}
                organizations={organizations}
                onSaved={async () => {
                  await refresh()
                  const next = await getLetter(letter.id)
                  setLetter(next)
                }}
              />
            )}

            {tab === 'attachments' && (
              <div>
                <AppTabList groupId="letter-attachment-tabs" className="mb-4">
                  {ATTACHMENTS_SUB_TABS.map(({ id: subId, label, icon: Icon }) => (
                    <AppTab
                      key={subId}
                      active={attachmentsSubTab === subId}
                      onClick={() => setAttachmentsSubTab(subId)}
                    >
                      <Icon className="size-3.5" />
                      {label}
                    </AppTab>
                  ))}
                </AppTabList>
                <AppTabPanel tabKey={attachmentsSubTab}>
                  {attachmentsSubTab === 'correspondence' ? (
                    <DocumentsPanel letter={letter} />
                  ) : (
                    <AIAnalyzeDocument letter={letter} />
                  )}
                </AppTabPanel>
              </div>
            )}

            {tab === 'workflow' && (
              <MarkingWorkflowPanel
                letter={letter}
                users={users}
                onDone={refresh}
                initialAction={searchParams.get('action')}
              />
            )}

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
      </div>
    </>
  )
}

type DetailsPerson = { name: string; department?: string }
type DetailsDept = { name: string }
type DetailsOrg = { name: string; status?: string; color?: string }

function CorrespondenceDetailsPanel({
  letter,
  users,
  departments,
  organizations,
  onSaved,
}: {
  letter: Letter
  users: DetailsPerson[]
  departments: DetailsDept[]
  organizations: DetailsOrg[]
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
  const organizationColors = Object.fromEntries(
    organizations
      .map((org) => [org.name, normalizeOrgColor(org.color)] as const)
      .filter((entry) => entry[0] && entry[1]),
  )
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
        <div className="grid gap-5 lg:grid-cols-3 lg:grid-rows-[auto_repeat(3,minmax(0,auto))] lg:gap-x-5 lg:gap-y-3">
          <LetterPartiesCard
            from={letter.from}
            to={letter.to}
            organizationOptions={organizationOptions}
            organizationColors={organizationColors}
          />
          <LetterDatesCard
            letterDate={letter.letterDate}
            receivedDate={letter.receivedDate}
            dueDate={letter.dueDate}
          />
          <LetterOtherDetailsCard
            department={letter.department}
            assignedTo={letter.assignedTo}
            infoRecipients={letter.markInfoUsers || ''}
            lastAction={letter.lastAction}
            lastActionAt={letter.lastActionAt || ''}
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
        <div className="grid gap-5 lg:grid-cols-3 lg:items-stretch">
          <LetterPartiesCard
            editing
            from={from}
            to={to}
            organizationOptions={organizationOptions}
            organizationColors={organizationColors}
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
            priority={priority}
            department={department}
            assignedTo={letter.assignedTo}
            infoRecipients={letter.markInfoUsers || ''}
            lastAction={letter.lastAction}
            lastActionAt={letter.lastActionAt || ''}
            deptNames={deptNames}
            onPriorityChange={setPriority}
            onDepartmentChange={setDepartment}
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

function formatLastActionLine(action: string, at: string): string {
  const label = (action || '').trim()
  const day = formatDashDate(at)
  if (!label && day === '—') return '—'
  if (!label) return day
  if (day === '—') return label
  return `${label} on ${day}`
}

function LetterOtherDetailsCard({
  department,
  assignedTo,
  infoRecipients = '',
  lastAction,
  lastActionAt = '',
  editing = false,
  priority,
  deptNames = [],
  onPriorityChange,
  onDepartmentChange,
}: {
  department: string
  assignedTo: string
  infoRecipients?: string
  lastAction: string
  lastActionAt?: string
  editing?: boolean
  priority?: Priority
  deptNames?: string[]
  onPriorityChange?: (value: Priority) => void
  onDepartmentChange?: (value: string) => void
}) {
  const lastActionLine = formatLastActionLine(lastAction, lastActionAt)
  const lastActionRelative = relativePastDateInfo(lastActionAt)

  const infoBlock = (
    <div className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2.5 dark:border-violet-800/50 dark:bg-violet-950/30">
      <div className="mb-1 flex items-center gap-1.5">
        <Badge tone="violet">Info</Badge>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Info recipients</p>
      </div>
      <div className="text-xs font-semibold text-slate-700">
        <AssignedToDisplay assignedTo={infoRecipients} />
      </div>
    </div>
  )

  if (editing) {
    return (
      <div className="flex h-full flex-col rounded-lg border border-slate-200 bg-neutral-50 p-4 dark:bg-slate-900/40">
        <div className="mb-3 flex shrink-0 items-center gap-2 border-b border-slate-200/80 pb-2.5">
          <span className="inline-flex size-7 items-center justify-center rounded-md bg-white text-[#1769aa] shadow-sm ring-1 ring-slate-200">
            <ClipboardList className="size-3.5" />
          </span>
          <h3 className="text-sm font-bold text-slate-700">Current Marking Details</h3>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <label className="flex min-h-0 flex-1 flex-col rounded-md border border-slate-200/80 bg-white px-3 py-2.5">
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
          <label className="flex min-h-0 flex-1 flex-col rounded-md border border-slate-200/80 bg-white px-3 py-2.5">
            <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <ClipboardList className="size-3.5 text-[#1769aa]" />
              Department
            </span>
            <AppSelect value={department} onValueChange={(v) => onDepartmentChange?.(v)} options={deptNames} className="mt-0.5 h-9 text-xs" />
          </label>
          <div className="flex min-h-0 flex-1 flex-col rounded-md border border-sky-200 bg-sky-50 px-3 py-2.5 dark:border-blue-800/50 dark:bg-blue-950/30">
            <div className="mb-1 flex items-center gap-1.5">
              <Badge tone="blue">To</Badge>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Assigned to</p>
            </div>
            <div className="text-xs font-semibold text-slate-700">
              <AssignedToDisplay assignedTo={assignedTo} />
            </div>
            <p className="mt-1 text-[10px] text-slate-400">
              Use Assign / Forward to mark to another user (puts the letter in their Inbox).
            </p>
          </div>
          {infoBlock}
            <div className="flex min-h-0 flex-1 flex-col rounded-md border border-slate-200/80 bg-white px-3 py-2.5">
              <div className="mb-1 flex items-center gap-1.5">
                <ClipboardList className="size-3.5 text-[#1769aa]" />
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Last action</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="text-xs font-semibold text-slate-700">{lastActionLine}</p>
                {lastActionRelative ? <DateRelativeBadge info={lastActionRelative} /> : null}
              </div>
            </div>
          </div>
        </div>
      )
  }

  return (
    <div className="grid gap-y-3 rounded-lg border border-slate-200 bg-neutral-50 p-4 dark:bg-slate-900/40 lg:row-span-4 lg:grid-rows-subgrid">
      <div className="flex items-center gap-2 border-b border-slate-200/80 pb-2.5">
        <span className="inline-flex size-7 items-center justify-center rounded-md bg-white text-[#1769aa] shadow-sm ring-1 ring-slate-200">
          <ClipboardList className="size-3.5" />
        </span>
        <h3 className="text-sm font-bold text-slate-700">Current Marking Details</h3>
      </div>
      <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2.5 dark:border-blue-800/50 dark:bg-blue-950/30">
        <div className="mb-1 flex items-center gap-1.5">
          <Badge tone="blue">To</Badge>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Assigned to</p>
        </div>
        <div className="text-xs font-semibold text-slate-700">
          <AssignedToDisplay assignedTo={assignedTo} />
        </div>
      </div>
      {infoBlock}
      <div className="rounded-md border border-slate-200/80 bg-white px-3 py-2.5">
        <div className="mb-1 flex items-center gap-1.5">
          <FileText className="size-3.5 text-[#1769aa]" />
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Last action</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-xs font-semibold text-slate-700">{lastActionLine}</p>
          {lastActionRelative ? <DateRelativeBadge info={lastActionRelative} /> : null}
        </div>
      </div>
    </div>
  )
}

function LetterPartiesCard({
  from,
  to,
  editing = false,
  organizationOptions = [],
  organizationColors = {},
  onFromChange,
  onToChange,
}: {
  from: string
  to: string
  editing?: boolean
  organizationOptions?: string[]
  organizationColors?: Record<string, string>
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
      color: organizationColors[from] || '',
      onChange: onFromChange,
    },
    {
      key: 'to',
      label: 'To',
      icon: ArrowDownLeft,
      value: to,
      color: organizationColors[to] || '',
      onChange: onToChange,
    },
  ]

  if (editing) {
    return (
      <div className="flex h-full flex-col rounded-lg border border-slate-200 bg-neutral-50 p-4 dark:bg-slate-900/40">
        <div className="mb-3 flex shrink-0 items-center gap-2 border-b border-slate-200/80 pb-2.5">
          <span className="inline-flex size-7 items-center justify-center rounded-md bg-white text-[#1769aa] shadow-sm ring-1 ring-slate-200">
            <ArrowLeftRight className="size-3.5" />
          </span>
          <h3 className="text-sm font-bold text-slate-700">Correspondents</h3>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {rows.map(({ key, label, icon: Icon, value, color, onChange }) => (
            <div
              key={key}
              className="flex min-h-0 flex-1 flex-col rounded-md border border-slate-200/80 bg-white px-3 py-2.5"
              style={organizationCardStyle(color)}
            >
              <div className="mb-1 flex items-center gap-1.5">
                <Icon className="size-3.5 text-[#1769aa]" style={color ? { color } : undefined} />
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                {color ? (
                  <span className="ml-auto size-2.5 rounded-full border border-white/80 shadow-sm" style={{ backgroundColor: color }} />
                ) : null}
              </div>
              <AppSelect
                value={value}
                onValueChange={(next) => onChange?.(next)}
                options={orgSelectOptions}
                className="mt-0.5 h-9 text-xs"
              />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-y-3 rounded-lg border border-slate-200 bg-neutral-50 p-4 dark:bg-slate-900/40 lg:row-span-4 lg:grid-rows-subgrid">
      <div className="flex items-center gap-2 border-b border-slate-200/80 pb-2.5">
        <span className="inline-flex size-7 items-center justify-center rounded-md bg-white text-[#1769aa] shadow-sm ring-1 ring-slate-200">
          <ArrowLeftRight className="size-3.5" />
        </span>
        <h3 className="text-sm font-bold text-slate-700">Correspondents</h3>
      </div>
      {rows.map(({ key, label, icon: Icon, value, color }) => (
        <div
          key={key}
          className="rounded-md border border-slate-200/80 bg-white px-3 py-2.5"
          style={organizationCardStyle(color)}
        >
          <div className="mb-1 flex items-center gap-1.5">
            <Icon className="size-3.5 text-[#1769aa]" style={color ? { color } : undefined} />
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
            {color ? (
              <span className="ml-auto size-2.5 rounded-full border border-white/80 shadow-sm" style={{ backgroundColor: color }} />
            ) : null}
          </div>
          <p className="text-xs font-semibold text-slate-700">{value || '—'}</p>
        </div>
      ))}
      {/* Keep a third track so sub-cards line up with Dates / Marking */}
      <div className="hidden lg:block" aria-hidden />
    </div>
  )
}

function DateRelativeBadge({ info }: { info: RelativeDateInfo }) {
  if (info.tone === 'orange' || info.badgeClassName) {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold',
          info.badgeClassName ??
            'border border-orange-200 bg-orange-100 text-orange-900 dark:border-orange-700 dark:bg-orange-950/70 dark:text-orange-200',
        )}
      >
        {info.label}
      </span>
    )
  }
  return (
    <Badge tone={info.tone} className="px-2 py-0.5 text-[10px]">
      {info.label}
    </Badge>
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
    relative: RelativeDateInfo | null
    onChange?: (value: string) => void
  }[] = [
    {
      key: 'letter',
      label: 'Letter Date',
      icon: Calendar,
      inputValue: letterDate,
      displayValue: formatDashDate(letterDate),
      relative: relativePastDateInfo(letterDate),
      onChange: onLetterDateChange,
    },
    {
      key: 'received',
      label: 'Receive Date',
      icon: Inbox,
      inputValue: receivedDate === '—' ? '' : receivedDate,
      displayValue: formatDashDate(receivedDate),
      relative: relativePastDateInfo(receivedDate),
      onChange: onReceivedDateChange,
    },
    {
      key: 'due',
      label: 'Due Date',
      icon: CalendarClock,
      inputValue: dueDate === '—' ? '' : dueDate,
      displayValue: formatDashDate(dueDate),
      relative: relativeDueDateInfo(dueDate),
      onChange: onDueDateChange,
    },
  ]

  if (editing) {
    return (
      <div className="flex h-full flex-col rounded-lg border border-slate-200 bg-neutral-50 p-4 dark:bg-slate-900/40">
        <div className="mb-3 flex shrink-0 items-center gap-2 border-b border-slate-200/80 pb-2.5">
          <span className="inline-flex size-7 items-center justify-center rounded-md bg-white text-[#1769aa] shadow-sm ring-1 ring-slate-200">
            <CalendarDays className="size-3.5" />
          </span>
          <h3 className="text-sm font-bold text-slate-700">Dates</h3>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {rows.map(({ key, label, icon: Icon, inputValue, onChange }) => (
            <div key={key} className="flex min-h-0 flex-1 flex-col rounded-md border border-slate-200/80 bg-white px-3 py-2.5">
              <div className="mb-1 flex items-center gap-1.5">
                <Icon className="size-3.5 text-[#1769aa]" />
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
              </div>
              <input
                type="date"
                value={inputValue}
                onChange={(e) => onChange?.(e.target.value)}
                className="mt-0.5 h-9 w-full rounded-md border border-slate-200 px-2 text-xs font-semibold text-slate-700"
              />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-y-3 rounded-lg border border-slate-200 bg-neutral-50 p-4 dark:bg-slate-900/40 lg:row-span-4 lg:grid-rows-subgrid">
      <div className="flex items-center gap-2 border-b border-slate-200/80 pb-2.5">
        <span className="inline-flex size-7 items-center justify-center rounded-md bg-white text-[#1769aa] shadow-sm ring-1 ring-slate-200">
          <CalendarDays className="size-3.5" />
        </span>
        <h3 className="text-sm font-bold text-slate-700">Dates</h3>
      </div>
      {rows.map(({ key, label, icon: Icon, displayValue, relative }) => (
        <div key={key} className="rounded-md border border-slate-200/80 bg-white px-3 py-2.5">
          <div className="mb-1 flex items-center gap-1.5">
            <Icon className="size-3.5 text-[#1769aa]" />
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-xs font-semibold text-slate-700">{displayValue}</p>
            {relative ? <DateRelativeBadge info={relative} /> : null}
          </div>
        </div>
      ))}
    </div>
  )
}
