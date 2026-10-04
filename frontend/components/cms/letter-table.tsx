'use client'

import { useMemo, type CSSProperties } from 'react'
import { Lock } from 'lucide-react'
import { Badge } from '@/components/cms/ui'
import { DataTable, type DataTableColumn } from '@/components/cms/data-table'
import { LetterRowActions } from '@/components/cms/letter-row-actions'
import { priorityTone, statusTone, type Letter } from '@/services/letters'

function parseSortDate(value: string | undefined) {
  if (!value || value === '—') return 0
  const t = Date.parse(value)
  if (!Number.isNaN(t)) return t
  const m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (!m) return 0
  return Date.parse(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`)
}

const PRIORITY_RANK: Record<string, number> = { Urgent: 3, Important: 2, Routine: 1 }

export function LetterTable({
  data,
  onOpen,
  selectable,
  lockInaccessible,
  highlightId,
  onRowFocus,
  selectedIds,
  onToggle,
  onToggleAll,
  role,
  users,
  departments,
  onChanged,
  onDelete,
  className,
  style,
}: {
  data: Letter[]
  onOpen: (id: string) => void
  selectable?: boolean
  lockInaccessible?: boolean
  highlightId?: string | null
  onRowFocus?: (id: string) => void
  selectedIds?: Set<string>
  onToggle?: (id: string) => void
  onToggleAll?: (checked: boolean) => void
  role: string
  users: { name: string; department?: string }[]
  departments: { name: string }[]
  onChanged: () => Promise<void>
  onDelete: (letter: Letter) => void
  className?: string
  style?: CSSProperties
}) {
  const openRows = data.filter((l) => !lockInaccessible || l.accessible !== false)
  const allSelected = selectable && openRows.length > 0 && openRows.every((l) => selectedIds?.has(l.id))

  const columns = useMemo<DataTableColumn<Letter>[]>(() => {
    const cols: DataTableColumn<Letter>[] = []

    if (selectable) {
      cols.push({
        id: 'select',
        header: '',
        hideable: false,
        sortable: false,
        className: 'w-10',
        headerClassName: 'w-10',
        cell: (l) => {
          const locked = !!lockInaccessible && l.accessible === false
          return (
            <span onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                disabled={locked}
                checked={selectedIds?.has(l.id) ?? false}
                onChange={() => onToggle?.(l.id)}
                aria-label={`Select ${l.number}`}
              />
            </span>
          )
        },
      })
    }

    cols.push(
      {
        id: 'number',
        header: 'Letter no.',
        sortValue: (l) => l.number,
        cell: (l) => {
          const locked = !!lockInaccessible && l.accessible === false
          return (
            <>
              {locked ? (
                <div className="flex items-center gap-1.5">
                  <Lock className="size-3.5 shrink-0 text-slate-400" aria-hidden />
                  <span className="text-xs font-bold text-slate-400">{l.number}</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpen(l.id)
                  }}
                  className="text-left text-xs font-bold text-[#1769aa] hover:underline"
                >
                  {l.number}
                </button>
              )}
              <p className="mt-1 text-[11px] text-slate-400">{l.letterDate}</p>
            </>
          )
        },
      },
      {
        id: 'subject',
        header: 'Subject / source',
        sortValue: (l) => l.subject,
        className: 'max-w-[250px]',
        cell: (l) => {
          const locked = !!lockInaccessible && l.accessible === false
          return (
            <>
              {locked ? (
                <p className="line-clamp-2 text-xs font-semibold text-slate-400">{l.subject}</p>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpen(l.id)
                  }}
                  className="line-clamp-2 text-left text-xs font-semibold text-slate-700"
                >
                  {l.subject}
                </button>
              )}
              <p className="mt-1 text-[11px] text-slate-400">{l.from}</p>
              {locked && (
                <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                  Locked · not assigned to you
                </p>
              )}
            </>
          )
        },
      },
      {
        id: 'department',
        header: 'Department',
        sortValue: (l) => l.department,
        className: 'text-slate-600',
        cell: (l) => l.department,
      },
      {
        id: 'priority',
        header: 'Priority',
        sortValue: (l) => PRIORITY_RANK[l.priority] ?? 0,
        cell: (l) => <Badge tone={priorityTone(l.priority)}>{l.priority}</Badge>,
      },
      {
        id: 'status',
        header: 'Status',
        sortValue: (l) => l.status,
        cell: (l) => <Badge tone={statusTone(l.status)}>{l.status}</Badge>,
      },
      {
        id: 'dueDate',
        header: 'Due date',
        sortValue: (l) => parseSortDate(l.dueDate),
        className: 'text-slate-600',
        cell: (l) => l.dueDate,
      },
      {
        id: 'assignedTo',
        header: 'Assigned to',
        sortValue: (l) => l.assignedTo,
        className: 'text-slate-600',
        cell: (l) => l.assignedTo,
      },
      {
        id: 'actions',
        header: 'Actions',
        hideable: false,
        sortable: false,
        cell: (l) => {
          const locked = !!lockInaccessible && l.accessible === false
          return (
            <span onClick={(e) => e.stopPropagation()}>
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
            </span>
          )
        },
      },
    )

    return cols
  }, [
    selectable,
    lockInaccessible,
    selectedIds,
    onToggle,
    onOpen,
    role,
    users,
    departments,
    onChanged,
    onDelete,
  ])

  return (
    <DataTable
      columns={columns}
      data={data}
      rowKey={(l) => l.id}
      storageKey="letter-register"
      minWidth="1100px"
      maxHeight="min(480px, 58vh)"
      className={className}
      style={style}
      title="Correspondence register"
      description={`${data.length} records`}
      toolbar={
        selectable ? (
          <label className="mr-1 inline-flex items-center gap-1.5 text-xs text-slate-500">
            <input
              type="checkbox"
              checked={!!allSelected}
              onChange={(e) => onToggleAll?.(e.target.checked)}
              aria-label="Select all visible"
            />
            Select page
          </label>
        ) : undefined
      }
      onRowClick={(l) => {
        const locked = !!lockInaccessible && l.accessible === false
        if (!locked) onRowFocus?.(l.id)
      }}
      rowClassName={(l) => {
        const locked = !!lockInaccessible && l.accessible === false
        const highlighted = highlightId === l.id
        if (locked) return 'bg-slate-50/80 text-slate-400'
        if (highlighted) return 'bg-blue-50/80 ring-1 ring-inset ring-blue-100'
        return 'hover:bg-slate-50'
      }}
      emptyMessage="No letters found."
    />
  )
}
