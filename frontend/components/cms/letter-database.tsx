'use client'

import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { useAppData } from '@/components/app-provider'
import { AISearchBanner } from '@/components/ai/pages'
import { Button } from '@/components/ui/button'
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
  const [pendingDelete, setPendingDelete] = useState<Letter[] | null>(null)
  const isAdmin = isAdministrator(me.role)
  const isCatalog = page === 'Catalog'
  const isSoftArchive = page === 'Archived'

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

  const source = isCatalog
    ? catalogLetters
    : isSoftArchive
      ? archivedLetters
      : aiSearch
        ? aiSearch.letters
        : letters

  const data = source.filter((l) => {
    const q = aiSearch || !query || Object.values(l).some((v) => String(v).toLowerCase().includes(query.toLowerCase()))
    const archiveOk = isSoftArchive ? !!l.isArchived : isCatalog ? true : !l.isArchived
    const isInbox =
      l.assignedTo === me.name && (l.assignedBy || '') !== me.name
    const isSent = l.createdBy === me.name || l.assignedBy === me.name
    const matchesPage =
      page === 'All Letters' ||
      page === 'Catalog' ||
      (page === 'Inbox' && isInbox) ||
      (page === 'Sent' && isSent) ||
      (page === 'Incoming' && l.type === 'Incoming') ||
      (page === 'Outgoing' && l.type === 'Outgoing') ||
      (page === 'Overdue' && l.status === 'Overdue') ||
      (page === 'Closed' && l.status === 'Closed') ||
      (page === 'Archived' && l.isArchived) ||
      (page === 'Pending' && !['Closed', 'Completed', 'Archived'].includes(l.status)) ||
      (page === 'My Actions' && l.assignedTo === me.name) ||
      (page === 'Monitoring' && (l.status === 'Overdue' || l.daysPending >= 7 || !['Closed', 'Completed', 'Archived'].includes(l.status)))
    return q && archiveOk && matchesPage && (filter === 'All' || l.priority === filter)
  })

  const title = page === 'All Letters' ? 'Letter database' : page
  const description = isCatalog
    ? 'Search the full correspondence register. Letters not marked to you are locked.'
    : page === 'Inbox'
      ? 'Letters marked to you from any tier that still need your response.'
      : page === 'Sent'
        ? 'Letters you registered, replied to, or marked onward.'
        : 'Search, filter and manage correspondence assigned or created by you.'
  const selectedIds = [...selected].filter((id) => {
    const row = data.find((l) => l.id === id)
    return row && (row.accessible !== false)
  })
  const numericIds = selectedIds.map((id) => Number(id))
  const selectable = !isCatalog || isAdmin

  const reload = async () => {
    await refresh()
    if (isSoftArchive) {
      const { listLetters } = await import('@/services/letters')
      setArchivedLetters(await listLetters({ view: 'archived' }))
    }
    if (isCatalog) {
      const { listLetters } = await import('@/services/letters')
      setCatalogLetters(await listLetters({ scope: 'catalog' }))
    }
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
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-xs">
          <option>All</option><option>Routine</option><option>Important</option><option>Urgent</option>
        </select>
        <Button variant="ghost" size="sm" onClick={() => setFilter('All')}>Clear</Button>
      </div>
      {selectable && selectedIds.length > 0 && (
        <Card className="mb-4 flex flex-wrap items-center gap-2 p-3">
          <span className="text-xs font-semibold text-slate-600">{selectedIds.length} selected</span>
          <select value={bulkOp} onChange={(e) => { setBulkOp(e.target.value); setBulkValue('') }} className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs">
            <option value="assign">Assign</option>
            <option value="reassign">Reassign</option>
            <option value="change_department">Change department</option>
            <option value="change_priority">Change priority</option>
            <option value="change_status">Change status</option>
            <option value="archive">{isSoftArchive ? 'Restore from archive' : 'Archive'}</option>
          </select>
          {['assign', 'reassign'].includes(bulkOp) && (
            <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs">
              <option value="">User…</option>
              {users.map((u) => <option key={u.username} value={u.name}>{u.name}</option>)}
            </select>
          )}
          {bulkOp === 'change_department' && (
            <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs">
              <option value="">Department…</option>
              {departments.map((d) => <option key={d.code} value={d.name}>{d.name}</option>)}
            </select>
          )}
          {bulkOp === 'change_priority' && (
            <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs">
              <option value="">Priority…</option>
              {(masterData.Priorities ?? ['Routine', 'Important', 'Urgent']).map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
          {bulkOp === 'change_status' && (
            <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs">
              <option value="">Status…</option>
              {(masterData.Statuses ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
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
