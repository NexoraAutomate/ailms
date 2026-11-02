'use client'

import { useEffect, useState } from 'react'
import { Columns2, LayoutList, Plus, Rows3 } from 'lucide-react'
import { useAppData } from '@/components/app-provider'
import { AISearchBanner } from '@/components/ai/pages'
import { Button } from '@/components/ui/button'
import { AppSelect } from '@/components/ui/app-select'
import { AppTab, AppTabList, AppTabPanel } from '@/components/ui/app-tabs'
import { Badge, Card, PageTitle } from '@/components/cms/ui'
import { LetterDeleteDialog } from '@/components/cms/letter-delete-dialog'
import { LetterTable } from '@/components/cms/letter-table'
import type { InterpretedQuery } from '@/services/ai'
import { isAdministrator } from '@/services/letter-actions'
import type { Letter } from '@/services/letters'
import { archiveLetters, restoreLetters, runBulkOperation } from '@/services/data-operations'
import { cn } from '@/lib/utils'

const INBOX_LAYOUT_KEY = 'ailms.inbox.layout'

type InboxLayoutMode = 'cards' | 'tabs' | 'list'

const INBOX_LAYOUT_OPTIONS: {
  id: InboxLayoutMode
  label: string
  icon: typeof Columns2
}[] = [
  { id: 'cards', label: 'Separate cards', icon: Columns2 },
  { id: 'tabs', label: 'Tabs', icon: Rows3 },
  { id: 'list', label: 'Color-coded list', icon: LayoutList },
]

function readInboxLayout(): InboxLayoutMode {
  if (typeof window === 'undefined') return 'cards'
  try {
    const raw = localStorage.getItem(INBOX_LAYOUT_KEY)
    if (raw === 'cards' || raw === 'tabs' || raw === 'list') return raw
  } catch {
    /* ignore */
  }
  return 'cards'
}

function writeInboxLayout(mode: InboxLayoutMode) {
  try {
    localStorage.setItem(INBOX_LAYOUT_KEY, mode)
  } catch {
    /* ignore */
  }
}

export function Database({ page, query, go, aiSearch, onClearAi, refresh }: { page: string; query: string; go: (p: string) => void; aiSearch: InterpretedQuery | null; onClearAi: () => void; refresh: () => Promise<void> }) {
  const { letters, me, users, departments, masterData } = useAppData()
  const [filter, setFilter] = useState('All')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkOp, setBulkOp] = useState('assign')
  const [bulkValue, setBulkValue] = useState('')
  const [bulkMsg, setBulkMsg] = useState('')
  const [archivedLetters, setArchivedLetters] = useState<Letter[]>([])
  const [catalogLetters, setCatalogLetters] = useState<Letter[]>([])
  const [myActionLetters, setMyActionLetters] = useState<Letter[]>([])
  const [inboxLetters, setInboxLetters] = useState<Letter[]>([])
  const [sentLetters, setSentLetters] = useState<Letter[]>([])
  const [pendingDelete, setPendingDelete] = useState<Letter[] | null>(null)
  const [inboxLayout, setInboxLayout] = useState<InboxLayoutMode>('cards')
  const [inboxTab, setInboxTab] = useState<'to' | 'info'>('to')
  const isAdmin = isAdministrator(me.role)
  const isCatalog = page === 'Catalog'
  const isSoftArchive = page === 'Archived'
  const isMyActions = page === 'My Actions'
  const isInboxPage = page === 'Inbox'
  const isSentPage = page === 'Sent'

  useEffect(() => {
    if (!isInboxPage) return
    setInboxLayout(readInboxLayout())
  }, [isInboxPage])

  useEffect(() => {
    if (isSoftArchive) {
      import('@/services/letters').then(({ listLetters }) => listLetters({ view: 'archived' }).then(setArchivedLetters))
    }
  }, [isSoftArchive, letters])

  useEffect(() => {
    if (!isCatalog) return
    import('@/services/letters').then(({ listLetters }) =>
      listLetters({ scope: 'catalog' }).then(setCatalogLetters),
    )
  }, [isCatalog, letters])

  useEffect(() => {
    if (!isMyActions) return
    import('@/services/letters').then(({ listLetters }) =>
      listLetters({ view: 'mine' }).then(setMyActionLetters),
    )
  }, [isMyActions, letters])

  useEffect(() => {
    if (!isInboxPage) return
    import('@/services/letters').then(({ listLetters }) =>
      listLetters({ view: 'inbox' }).then(setInboxLetters),
    )
  }, [isInboxPage, letters])

  useEffect(() => {
    if (!isSentPage) return
    import('@/services/letters').then(({ listLetters }) =>
      listLetters({ view: 'sent' }).then(setSentLetters),
    )
  }, [isSentPage, letters])

  const source = isCatalog
    ? catalogLetters
    : isSoftArchive
      ? archivedLetters
      : isMyActions
        ? myActionLetters
        : isInboxPage
          ? inboxLetters
          : isSentPage
            ? sentLetters
            : aiSearch
              ? aiSearch.letters
              : letters

  const data = source.filter((l) => {
    const q = aiSearch || !query || Object.values(l).some((v) => String(v).toLowerCase().includes(query.toLowerCase()))
    const archiveOk = isSoftArchive ? !!l.isArchived : isCatalog ? true : !l.isArchived
    const matchesPage =
      page === 'All Letters' ||
      page === 'Catalog' ||
      page === 'Inbox' ||
      page === 'Sent' ||
      (page === 'Incoming' && l.type === 'Incoming') ||
      (page === 'Outgoing' && l.type === 'Outgoing') ||
      (page === 'Overdue' && l.status === 'Overdue') ||
      (page === 'Closed' && l.status === 'Closed') ||
      (page === 'Archived' && l.isArchived) ||
      (page === 'Pending' && !['Closed', 'Completed', 'Archived', 'Information Delivered', 'Dispatched'].includes(l.status)) ||
      (page === 'My Actions' && true) ||
      (page === 'Monitoring' && (l.status === 'Overdue' || l.daysPending >= 7 || !['Closed', 'Completed', 'Archived', 'Information Delivered'].includes(l.status)))
    return q && archiveOk && matchesPage && (filter === 'All' || l.priority === filter)
  })

  const title = page === 'All Letters' ? 'Letter database' : page
  const description = isCatalog
    ? 'Search the full correspondence register. Letters not marked to you are locked.'
    : page === 'Inbox'
      ? 'Letters marked to you as To (actionable) or Info, including returns after Response Required.'
      : page === 'Sent'
        ? 'One row per outstanding Forward or Response Required you sent. For Information items appear under Track only.'
        : page === 'My Actions'
          ? 'Open action items and FYI routes addressed to you.'
        : 'Search, filter and manage correspondence assigned or created by you.'
  const selectedIds = [...selected].filter((id) => {
    const row = data.find((l) => l.id === id)
    return row && (row.accessible !== false)
  })
  const numericIds = selectedIds.map((id) => Number(id))
  const selectable = !isCatalog || isAdmin

  const reload = async () => {
    await refresh()
    const { listLetters } = await import('@/services/letters')
    if (isSoftArchive) setArchivedLetters(await listLetters({ view: 'archived' }))
    if (isCatalog) setCatalogLetters(await listLetters({ scope: 'catalog' }))
    if (isMyActions) setMyActionLetters(await listLetters({ view: 'mine' }))
    if (isInboxPage) setInboxLetters(await listLetters({ view: 'inbox' }))
    if (isSentPage) setSentLetters(await listLetters({ view: 'sent' }))
  }

  const runBulk = async () => {
    setBulkMsg('')
    if (!numericIds.length) return
    try {
      if (bulkOp === 'archive') {
        if (isSoftArchive) {
          await restoreLetters(numericIds)
          setBulkMsg('Restored selected letters.')
        } else {
          await archiveLetters(numericIds)
          setBulkMsg('Archived selected letters.')
        }
      } else {
        const payload: Record<string, string> = {}
        if (bulkOp === 'assign' || bulkOp === 'reassign') payload.assignedTo = bulkValue
        if (bulkOp === 'change_department') payload.department = bulkValue
        if (bulkOp === 'change_priority') payload.priority = bulkValue
        if (bulkOp === 'change_status') payload.status = bulkValue
        const result = await runBulkOperation(bulkOp, numericIds, payload)
        setBulkMsg(`${result.succeeded} succeeded, ${result.failed} failed.`)
      }
      setSelected(new Set())
      await reload()
    } catch (err) {
      setBulkMsg(err instanceof Error ? err.message : 'Bulk operation failed')
    }
  }

  return (
    <>
      <PageTitle
        title={title}
        description={description}
        action={
          !isCatalog ? (
            <Button onClick={() => go('Register Letter')}>
              <Plus data-icon="inline-start" />
              Register letter
            </Button>
          ) : undefined
        }
      />
      {!isCatalog && <AISearchBanner result={aiSearch} onClear={onClearAi} go={go} />}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <AppSelect
          value={filter}
          onValueChange={setFilter}
          options={['All', 'Routine', 'Important', 'Urgent']}
          className="min-w-32"
        />
        <Button variant="ghost" size="sm" onClick={() => setFilter('All')}>Clear</Button>
        {isInboxPage ? (
          <div
            role="group"
            aria-label="Inbox layout"
            className="ml-auto inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm dark:border-neutral-700 dark:bg-neutral-900"
          >
            {INBOX_LAYOUT_OPTIONS.map(({ id, label, icon: Icon }) => {
              const active = inboxLayout === id
              return (
                <button
                  key={id}
                  type="button"
                  title={label}
                  aria-label={label}
                  aria-pressed={active}
                  onClick={() => {
                    setInboxLayout(id)
                    writeInboxLayout(id)
                  }}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition-colors',
                    active
                      ? 'bg-[#0d3763] text-white shadow-sm dark:bg-sky-700'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-[#0d3763] dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-sky-200',
                  )}
                >
                  <Icon className="size-3.5 shrink-0" />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              )
            })}
          </div>
        ) : null}
      </div>
      {selectable && selectedIds.length > 0 && (
        <Card className="mb-4 flex flex-wrap items-center gap-2 p-3">
          <span className="text-xs font-semibold text-slate-600">{selectedIds.length} selected</span>
          <AppSelect
            value={bulkOp}
            onValueChange={(v) => { setBulkOp(v); setBulkValue('') }}
            options={[
              { value: 'assign', label: 'Assign' },
              { value: 'reassign', label: 'Reassign' },
              { value: 'change_department', label: 'Change department' },
              { value: 'change_priority', label: 'Change priority' },
              { value: 'change_status', label: 'Change status' },
              { value: 'archive', label: isSoftArchive ? 'Restore from archive' : 'Archive' },
            ]}
            size="sm"
            className="min-w-36"
          />
          {['assign', 'reassign'].includes(bulkOp) && (
            <AppSelect
              value={bulkValue}
              onValueChange={setBulkValue}
              options={[
                { value: '', label: 'User…' },
                ...users.map((u) => ({ value: u.name, label: u.name })),
              ]}
              size="sm"
              className="min-w-32"
            />
          )}
          {bulkOp === 'change_department' && (
            <AppSelect
              value={bulkValue}
              onValueChange={setBulkValue}
              options={[
                { value: '', label: 'Department…' },
                ...departments.map((d) => ({ value: d.name, label: d.name })),
              ]}
              size="sm"
              className="min-w-32"
            />
          )}
          {bulkOp === 'change_priority' && (
            <AppSelect
              value={bulkValue}
              onValueChange={setBulkValue}
              options={[
                { value: '', label: 'Priority…' },
                ...(masterData.Priorities ?? ['Routine', 'Important', 'Urgent']).map((p) => ({ value: p, label: p })),
              ]}
              size="sm"
              className="min-w-32"
            />
          )}
          {bulkOp === 'change_status' && (
            <AppSelect
              value={bulkValue}
              onValueChange={setBulkValue}
              options={[
                { value: '', label: 'Status…' },
                ...(masterData.Statuses ?? []).map((s) => ({ value: s, label: s })),
              ]}
              size="sm"
              className="min-w-32"
            />
          )}
          <Button size="sm" onClick={runBulk}>Apply</Button>
          {isAdmin && (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setPendingDelete(data.filter((letter) => selectedIds.includes(letter.id)))}
            >
              Delete
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear selection</Button>
        </Card>
      )}
      {bulkMsg && <p className="mb-3 text-xs text-slate-600">{bulkMsg}</p>}
      {(() => {
        const openLetter = (id: string) => {
          if (isInboxPage) go(`/letters/${id}?from=inbox`)
          else if (isSentPage) go(`/letters/${id}?from=sent`)
          else go(id)
        }
        const onToggle = (id: string) =>
          setSelected((current) => {
            const next = new Set(current)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
          })
        const tableProps = {
          selectable,
          lockInaccessible: isCatalog,
          selectedIds: selected,
          onToggle,
          role: me.role,
          users,
          departments,
          onChanged: reload,
          onDelete: (letter: Letter) => setPendingDelete([letter]),
          showSender: isInboxPage,
          navFrom: isInboxPage ? ('inbox' as const) : isSentPage ? ('sent' as const) : undefined,
        }
        const toggleIds = (rows: Letter[], checked: boolean) => {
          const openIds = rows.filter((l) => l.accessible !== false).map((l) => l.id)
          setSelected((current) => {
            if (!isInboxPage) return checked ? new Set(openIds) : new Set()
            const next = new Set(current)
            if (checked) openIds.forEach((id) => next.add(id))
            else openIds.forEach((id) => next.delete(id))
            return next
          })
        }

        if (isInboxPage) {
          const toLetters = data.filter((l) => (l.inboxRole || 'to') !== 'info')
          const infoLetters = data.filter((l) => l.inboxRole === 'info')

          const renderInboxTable = (
            rows: Letter[],
            opts: {
              title: string
              description: string
              storageKey: string
              colorCode?: boolean
            },
          ) => (
            <LetterTable
              {...tableProps}
              data={rows}
              onOpen={openLetter}
              onToggleAll={(checked) => toggleIds(rows, checked)}
              title={opts.title}
              description={opts.description}
              storageKey={opts.storageKey}
              colorCodeInboxRoles={opts.colorCode}
            />
          )

          if (inboxLayout === 'list') {
            return renderInboxTable(data, {
              title: 'Inbox',
              description: `${toLetters.length} To · ${infoLetters.length} Info`,
              storageKey: 'letter-register-inbox-list',
              colorCode: true,
            })
          }

          if (inboxLayout === 'tabs') {
            const activeRows = inboxTab === 'to' ? toLetters : infoLetters
            return (
              <div>
                <AppTabList groupId="inbox-role-tabs" className="mb-4">
                  <AppTab active={inboxTab === 'to'} onClick={() => setInboxTab('to')}>
                    <Badge tone="blue">To</Badge>
                    Marked to you
                    <span className="tabular-nums opacity-80">({toLetters.length})</span>
                  </AppTab>
                  <AppTab active={inboxTab === 'info'} onClick={() => setInboxTab('info')}>
                    <Badge tone="violet">Info</Badge>
                    For information
                    <span className="tabular-nums opacity-80">({infoLetters.length})</span>
                  </AppTab>
                </AppTabList>
                <AppTabPanel tabKey={inboxTab}>
                  {renderInboxTable(activeRows, {
                    title: inboxTab === 'to' ? 'To' : 'Info',
                    description:
                      inboxTab === 'to'
                        ? `${toLetters.length} actionable mark${toLetters.length === 1 ? '' : 's'}`
                        : `${infoLetters.length} information mark${infoLetters.length === 1 ? '' : 's'}`,
                    storageKey:
                      inboxTab === 'to' ? 'letter-register-inbox-to' : 'letter-register-inbox-info',
                  })}
                </AppTabPanel>
              </div>
            )
          }

          return (
            <div className="space-y-5">
              <section className="overflow-hidden rounded-lg border border-blue-200/80 bg-blue-50/40 shadow-sm dark:border-blue-800/50 dark:bg-blue-950/20">
                <div className="flex flex-wrap items-center gap-2 border-b border-blue-200/70 px-3 py-2.5 dark:border-blue-800/40">
                  <Badge tone="blue">To</Badge>
                  <h2 className="text-sm font-bold text-blue-900 dark:text-blue-100">Marked to you</h2>
                  <span className="text-xs text-blue-700/80 dark:text-blue-300/80">
                    {toLetters.length} letter{toLetters.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="p-2 sm:p-3">
                  {renderInboxTable(toLetters, {
                    title: 'To',
                    description: `${toLetters.length} actionable mark${toLetters.length === 1 ? '' : 's'}`,
                    storageKey: 'letter-register-inbox-to',
                  })}
                </div>
              </section>
              <section className="overflow-hidden rounded-lg border border-violet-200/80 bg-violet-50/40 shadow-sm dark:border-violet-800/50 dark:bg-violet-950/20">
                <div className="flex flex-wrap items-center gap-2 border-b border-violet-200/70 px-3 py-2.5 dark:border-violet-800/40">
                  <Badge tone="violet">Info</Badge>
                  <h2 className="text-sm font-bold text-violet-900 dark:text-violet-100">For information</h2>
                  <span className="text-xs text-violet-700/80 dark:text-violet-300/80">
                    {infoLetters.length} letter{infoLetters.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="p-2 sm:p-3">
                  {renderInboxTable(infoLetters, {
                    title: 'Info',
                    description: `${infoLetters.length} information mark${infoLetters.length === 1 ? '' : 's'}`,
                    storageKey: 'letter-register-inbox-info',
                  })}
                </div>
              </section>
            </div>
          )
        }

        return (
          <LetterTable
            {...tableProps}
            data={data}
            onOpen={openLetter}
            onToggleAll={(checked) => toggleIds(data, checked)}
          />
        )
      })()}
      {pendingDelete && pendingDelete.length > 0 && (
        <LetterDeleteDialog
          letters={pendingDelete}
          onClose={() => setPendingDelete(null)}
          onDeleted={async () => {
            setPendingDelete(null)
            setSelected(new Set())
            setBulkMsg(pendingDelete.length === 1 ? 'Letter deleted.' : `${pendingDelete.length} letters deleted.`)
            await reload()
          }}
        />
      )}
    </>
  )
}
