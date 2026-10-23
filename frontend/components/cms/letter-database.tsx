'use client'

import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { useAppData } from '@/components/app-provider'
import { AISearchBanner } from '@/components/ai/pages'
import { Button } from '@/components/ui/button'
import { AppSelect } from '@/components/ui/app-select'
import { Card, PageTitle } from '@/components/cms/ui'
import { LetterDeleteDialog } from '@/components/cms/letter-delete-dialog'
import { LetterTable } from '@/components/cms/letter-table'
import type { InterpretedQuery } from '@/services/ai'
import { isAdministrator } from '@/services/letter-actions'
import type { Letter } from '@/services/letters'
import { archiveLetters, restoreLetters, runBulkOperation } from '@/services/data-operations'

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
  const isAdmin = isAdministrator(me.role)
  const isCatalog = page === 'Catalog'
  const isSoftArchive = page === 'Archived'
  const isMyActions = page === 'My Actions'
  const isInboxPage = page === 'Inbox'
  const isSentPage = page === 'Sent'

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
      ? 'Letters currently marked to you, or returned after a Response Required is fulfilled.'
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
      <div className="mb-4 flex flex-wrap gap-2">
        <AppSelect
          value={filter}
          onValueChange={setFilter}
          options={['All', 'Routine', 'Important', 'Urgent']}
          className="min-w-32"
        />
        <Button variant="ghost" size="sm" onClick={() => setFilter('All')}>Clear</Button>
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
      <LetterTable
        data={data}
        onOpen={(id) => go(id)}
        selectable={selectable}
        lockInaccessible={isCatalog}
        selectedIds={selected}
        onToggle={(id) => setSelected((current) => {
          const next = new Set(current)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })}
        onToggleAll={(checked) => {
          const openIds = data.filter((l) => l.accessible !== false).map((l) => l.id)
          setSelected(checked ? new Set(openIds) : new Set())
        }}
        role={me.role}
        users={users}
        departments={departments}
        onChanged={reload}
        onDelete={(letter) => setPendingDelete([letter])}
        showSender={isInboxPage}
      />
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
