'use client'

import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { useAppData } from '@/components/app-provider'
import { AISearchBanner } from '@/components/ai/pages'
import { Button } from '@/components/ui/button'
import { Card, PageTitle } from '@/components/cms/ui'
import { LetterTable } from '@/components/cms/letter-table'
import type { InterpretedQuery } from '@/services/ai'
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

  useEffect(() => {
    if (page !== 'Archive') return
    import('@/services/letters').then(({ listLetters }) => listLetters({ view: 'archived' }).then(setArchivedLetters))
  }, [page, letters])

  const source = page === 'Archive' ? archivedLetters : aiSearch ? aiSearch.letters : letters
  const data = source.filter((l) => {
    const q = aiSearch || !query || Object.values(l).some((v) => String(v).toLowerCase().includes(query.toLowerCase()))
    const archiveOk = page === 'Archive' ? !!l.isArchived : !l.isArchived
    const matchesPage =
      page === 'All Letters' ||
      (page === 'Incoming' && l.type === 'Incoming') ||
      (page === 'Outgoing' && l.type === 'Outgoing') ||
      (page === 'Overdue' && l.status === 'Overdue') ||
      (page === 'Closed' && l.status === 'Closed') ||
      (page === 'Archive' && l.isArchived) ||
      (page === 'Pending' && !['Closed', 'Completed', 'Archived'].includes(l.status)) ||
      (page === 'My Actions' && l.assignedTo === me.name) ||
      (page === 'Monitoring' && (l.status === 'Overdue' || l.daysPending >= 7 || !['Closed', 'Completed', 'Archived'].includes(l.status)))
    return q && archiveOk && matchesPage && (filter === 'All' || l.priority === filter)
  })
  const title = page === 'All Letters' ? 'Letter database' : page
  const selectedIds = [...selected].filter((id) => data.some((l) => l.id === id))
  const numericIds = selectedIds.map((id) => Number(id))

  const runBulk = async () => {
    setBulkMsg('')
    if (!numericIds.length) return
    try {
      if (bulkOp === 'archive') {
        if (page === 'Archive') {
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
      await refresh()
      if (page === 'Archive') {
        const { listLetters } = await import('@/services/letters')
        setArchivedLetters(await listLetters({ view: 'archived' }))
      }
    } catch (err) {
      setBulkMsg(err instanceof Error ? err.message : 'Bulk operation failed')
    }
  }

  return (
    <>
      <PageTitle title={title} description="Search, filter and manage all registered correspondence." action={<Button onClick={() => go('Register Letter')}><Plus data-icon="inline-start" />Register letter</Button>} />
      <AISearchBanner result={aiSearch} onClear={onClearAi} go={go} />
      <div className="mb-4 flex flex-wrap gap-2">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-xs">
          <option>All</option><option>Routine</option><option>Important</option><option>Urgent</option>
        </select>
        <Button variant="ghost" size="sm" onClick={() => setFilter('All')}>Clear</Button>
      </div>
      {selectedIds.length > 0 && (
        <Card className="mb-4 flex flex-wrap items-center gap-2 p-3">
          <span className="text-xs font-semibold text-slate-600">{selectedIds.length} selected</span>
          <select value={bulkOp} onChange={(e) => { setBulkOp(e.target.value); setBulkValue('') }} className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs">
            <option value="assign">Assign</option>
            <option value="reassign">Reassign</option>
            <option value="change_department">Change department</option>
            <option value="change_priority">Change priority</option>
            <option value="change_status">Change status</option>
            <option value="archive">{page === 'Archive' ? 'Restore from archive' : 'Archive'}</option>
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
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear selection</Button>
          {bulkMsg && <span className="text-xs text-slate-500">{bulkMsg}</span>}
        </Card>
      )}
      <LetterTable
        data={data}
        onOpen={(id) => go(id)}
        selectable
        selectedIds={selected}
        onToggle={(id) => setSelected((current) => {
          const next = new Set(current)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })}
        onToggleAll={(checked) => setSelected(checked ? new Set(data.map((l) => l.id)) : new Set())}
      />
    </>
  )
}
