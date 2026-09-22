'use client'

import { MoreHorizontal, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, Card } from '@/components/cms/ui'
import { priorityTone, statusTone, type Letter } from '@/services/letters'

export function LetterTable({
  data,
  onOpen,
  selectable,
  selectedIds,
  onToggle,
  onToggleAll,
}: {
  data: Letter[]
  onOpen: (id: string) => void
  selectable?: boolean
  selectedIds?: Set<string>
  onToggle?: (id: string) => void
  onToggleAll?: (checked: boolean) => void
}) {
  const allSelected = selectable && data.length > 0 && data.every((l) => selectedIds?.has(l.id))
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
        <table className="w-full min-w-[850px] text-left">
          <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-400">
            <tr>
              {selectable && (
                <th className="px-4 py-3">
                  <input type="checkbox" checked={!!allSelected} onChange={(e) => onToggleAll?.(e.target.checked)} aria-label="Select all" />
                </th>
              )}
              {['Letter no.', 'Subject / source', 'Department', 'Priority', 'Status', 'Due date', 'Assigned to', ''].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.map((l) => (
              <tr key={l.id} className="border-t border-slate-100 hover:bg-slate-50">
                {selectable && (
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selectedIds?.has(l.id) ?? false} onChange={() => onToggle?.(l.id)} aria-label={`Select ${l.number}`} />
                  </td>
                )}
                <td className="px-4 py-3">
                  <button onClick={() => onOpen(l.id)} className="text-left text-xs font-bold text-[#1769aa] hover:underline">{l.number}</button>
                  <p className="mt-1 text-[11px] text-slate-400">{l.letterDate}</p>
                </td>
                <td className="max-w-[250px] px-4 py-3">
                  <button onClick={() => onOpen(l.id)} className="line-clamp-2 text-left text-xs font-semibold text-slate-700">{l.subject}</button>
                  <p className="mt-1 text-[11px] text-slate-400">{l.from}</p>
                </td>
                <td className="px-4 py-3 text-xs text-slate-600">{l.department}</td>
                <td className="px-4 py-3"><Badge tone={priorityTone(l.priority)}>{l.priority}</Badge></td>
                <td className="px-4 py-3"><Badge tone={statusTone(l.status)}>{l.status}</Badge></td>
                <td className="px-4 py-3 text-xs text-slate-600">{l.dueDate}</td>
                <td className="px-4 py-3 text-xs text-slate-600">{l.assignedTo}</td>
                <td className="px-4 py-3"><MoreHorizontal className="size-4 text-slate-400" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-400">
        <span>Showing {data.length} letters</span>
      </div>
    </Card>
  )
}
