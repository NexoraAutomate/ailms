'use client'

import { Lock, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, Card } from '@/components/cms/ui'
import { LetterRowActions } from '@/components/cms/letter-row-actions'
import { priorityTone, statusTone, type Letter } from '@/services/letters'

export function LetterTable({
  data,
  onOpen,
  selectable,
  lockInaccessible,
  selectedIds,
  onToggle,
  onToggleAll,
  role,
  users,
  departments,
  onChanged,
  onDelete,
}: {
  data: Letter[]
  onOpen: (id: string) => void
  selectable?: boolean
  lockInaccessible?: boolean
  selectedIds?: Set<string>
  onToggle?: (id: string) => void
  onToggleAll?: (checked: boolean) => void
  role: string
  users: { name: string; department?: string }[]
  departments: { name: string }[]
  onChanged: () => Promise<void>
  onDelete: (letter: Letter) => void
}) {
  const openRows = data.filter((l) => !lockInaccessible || l.accessible !== false)
  const allSelected = selectable && openRows.length > 0 && openRows.every((l) => selectedIds?.has(l.id))
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-bold text-slate-700">Correspondence register</h2>
          <p className="text-xs text-slate-400">{data.length} records shown</p>
        </div>
        <Button variant="outline" size="sm">
          <SlidersHorizontal data-icon="inline-start" />
          Columns
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-left">
          <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-400">
            <tr>
              {selectable && (
                <th className="px-4 py-3">
                  <input type="checkbox" checked={!!allSelected} onChange={(e) => onToggleAll?.(e.target.checked)} aria-label="Select all" />
                </th>
              )}
              {['Letter no.', 'Subject / source', 'Department', 'Priority', 'Status', 'Due date', 'Assigned to', 'Actions'].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.map((l) => {
              const locked = !!lockInaccessible && l.accessible === false
              return (
                <tr key={l.id} className={`border-t border-slate-100 ${locked ? 'bg-slate-50/80 text-slate-400' : 'hover:bg-slate-50'}`}>
                  {selectable && (
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        disabled={locked}
                        checked={selectedIds?.has(l.id) ?? false}
                        onChange={() => onToggle?.(l.id)}
                        aria-label={`Select ${l.number}`}
                      />
                    </td>
                  )}
                  <td className="px-4 py-3">
                    {locked ? (
                      <div className="flex items-center gap-1.5">
                        <Lock className="size-3.5 shrink-0 text-slate-400" aria-hidden />
                        <span className="text-xs font-bold text-slate-400">{l.number}</span>
                      </div>
                    ) : (
                      <button onClick={() => onOpen(l.id)} className="text-left text-xs font-bold text-[#1769aa] hover:underline">{l.number}</button>
                    )}
                    <p className="mt-1 text-[11px] text-slate-400">{l.letterDate}</p>
                  </td>
                  <td className="max-w-[250px] px-4 py-3">
                    {locked ? (
                      <p className="line-clamp-2 text-xs font-semibold text-slate-400">{l.subject}</p>
                    ) : (
                      <button onClick={() => onOpen(l.id)} className="line-clamp-2 text-left text-xs font-semibold text-slate-700">{l.subject}</button>
                    )}
                    <p className="mt-1 text-[11px] text-slate-400">{l.from}</p>
                    {locked && <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">Locked · not assigned to you</p>}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">{l.department}</td>
                  <td className="px-4 py-3"><Badge tone={priorityTone(l.priority)}>{l.priority}</Badge></td>
                  <td className="px-4 py-3"><Badge tone={statusTone(l.status)}>{l.status}</Badge></td>
                  <td className="px-4 py-3 text-xs text-slate-600">{l.dueDate}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">{l.assignedTo}</td>
                  <td className="px-4 py-3">
                    {locked ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400">
                        <Lock className="size-3.5" /> Locked
                      </span>
                    ) : (
                      <LetterRowActions
                        letter={l}
                        role={role}
                        users={users}
                        departments={departments}
                        onChanged={onChanged}
                        onDelete={() => onDelete(l)}
                      />
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-400">
        <span>Showing {data.length} letters</span>
      </div>
    </Card>
  )
}
