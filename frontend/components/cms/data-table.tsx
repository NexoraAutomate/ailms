'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Loader2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/cms/ui'
import { cn } from '@/lib/utils'

export type SortDirection = 'asc' | 'desc'

export type DataTableColumn<T> = {
  id: string
  header: string
  /** Disable sorting for this column (e.g. Actions). Default: true when sortValue provided, else false. */
  sortable?: boolean
  /** Value used for sorting. Prefer numbers/dates for numeric/date columns. */
  sortValue?: (row: T) => string | number | Date | null | undefined
  defaultVisible?: boolean
  /** When false, column cannot be hidden via the picker. Default true. */
  hideable?: boolean
  className?: string
  headerClassName?: string
  cell: (row: T, index: number) => ReactNode
}

type DataTableProps<T> = {
  columns: DataTableColumn<T>[]
  data: T[]
  rowKey: (row: T, index: number) => string
  pageSize?: number
  minWidth?: string
  /** Max height of the scrollable body area (sticky header stays visible). */
  maxHeight?: string
  title?: ReactNode
  description?: ReactNode
  toolbar?: ReactNode
  emptyMessage?: string
  onRowClick?: (row: T) => void
  rowClassName?: (row: T, index: number) => string | undefined
  /** Persist column visibility in localStorage. */
  storageKey?: string
  showColumnPicker?: boolean
  /** Wrap in Card. Default true. */
  bordered?: boolean
  className?: string
  style?: CSSProperties
  footerExtra?: ReactNode
}

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1

  if (a instanceof Date || b instanceof Date) {
    const at = a instanceof Date ? a.getTime() : Date.parse(String(a))
    const bt = b instanceof Date ? b.getTime() : Date.parse(String(b))
    if (!Number.isNaN(at) && !Number.isNaN(bt)) return at - bt
  }

  if (typeof a === 'number' && typeof b === 'number') return a - b

  const as = String(a).trim()
  const bs = String(b).trim()

  const an = Number(as.replace(/,/g, ''))
  const bn = Number(bs.replace(/,/g, ''))
  if (as !== '' && bs !== '' && !Number.isNaN(an) && !Number.isNaN(bn) && /^-?[\d.,]+$/.test(as) && /^-?[\d.,]+$/.test(bs)) {
    return an - bn
  }

  const ad = Date.parse(as)
  const bd = Date.parse(bs)
  if (!Number.isNaN(ad) && !Number.isNaN(bd) && (/\d{4}/.test(as) || /\d{1,2}[/-]\d{1,2}/.test(as))) {
    return ad - bd
  }

  return as.localeCompare(bs, undefined, { numeric: true, sensitivity: 'base' })
}

function loadVisible(storageKey: string | undefined, columns: { id: string; defaultVisible?: boolean }[]) {
  const defaults = Object.fromEntries(columns.map((c) => [c.id, c.defaultVisible !== false]))
  if (!storageKey || typeof window === 'undefined') return defaults
  try {
    const raw = localStorage.getItem(`dt-cols:${storageKey}`)
    if (!raw) return defaults
    const parsed = JSON.parse(raw) as Record<string, boolean>
    return { ...defaults, ...parsed }
  } catch {
    return defaults
  }
}

export function DataTable<T>({
  columns,
  data,
  rowKey,
  pageSize = 10,
  minWidth = '760px',
  maxHeight = 'min(420px, 55vh)',
  title,
  description,
  toolbar,
  emptyMessage = 'No records found.',
  onRowClick,
  rowClassName,
  storageKey,
  showColumnPicker = true,
  bordered = true,
  className,
  style,
  footerExtra,
}: DataTableProps<T>) {
  const [sortId, setSortId] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDirection>('asc')
  const [page, setPage] = useState(1)
  const [pageLoading, setPageLoading] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [visible, setVisible] = useState<Record<string, boolean>>(() => loadVisible(storageKey, columns))

  const columnIds = columns.map((c) => c.id).join('|')
  useEffect(() => {
    setVisible(loadVisible(storageKey, columns))
    // Re-sync when column set identity changes, not on every render of cell closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- columnIds captures structural changes
  }, [storageKey, columnIds])

  useEffect(() => {
    setPage(1)
  }, [data, sortId, sortDir, pageSize])

  const toggleSort = useCallback((column: DataTableColumn<T>) => {
    const canSort = column.sortable ?? !!column.sortValue
    if (!canSort || !column.sortValue) return
    if (sortId === column.id) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortId(column.id)
      setSortDir('asc')
    }
  }, [sortId])

  const sorted = useMemo(() => {
    if (!sortId) return data
    const col = columns.find((c) => c.id === sortId)
    if (!col?.sortValue) return data
    const copy = [...data]
    copy.sort((ra, rb) => {
      const cmp = compareValues(col.sortValue!(ra), col.sortValue!(rb))
      return sortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [columns, data, sortDir, sortId])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, totalPages)

  const pageRows = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return sorted.slice(start, start + pageSize)
  }, [pageSize, safePage, sorted])

  const goToPage = useCallback((next: number) => {
    const clamped = Math.min(Math.max(1, next), totalPages)
    if (clamped === safePage) return
    setPageLoading(true)
    // Lazy-render next page slice (keeps DOM to ≤ pageSize rows).
    window.setTimeout(() => {
      setPage(clamped)
      setPageLoading(false)
    }, 120)
  }, [safePage, totalPages])

  const visibleColumns = columns.filter((c) => visible[c.id] !== false)

  const setColumnVisible = (id: string, next: boolean) => {
    const col = columns.find((c) => c.id === id)
    if (col?.hideable === false) return
    setVisible((prev) => {
      const updated = { ...prev, [id]: next }
      if (storageKey && typeof window !== 'undefined') {
        localStorage.setItem(`dt-cols:${storageKey}`, JSON.stringify(updated))
      }
      return updated
    })
  }

  const showHeader = title != null || description != null || toolbar != null || showColumnPicker

  const body = (
    <>
      {showHeader && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            {title != null && (typeof title === 'string' ? <h2 className="text-sm font-bold text-slate-700">{title}</h2> : title)}
            {description != null && (
              typeof description === 'string'
                ? <p className="text-xs text-slate-400">{description}</p>
                : description
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {toolbar}
            {showColumnPicker && (
              <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                <Columns3 data-icon="inline-start" />
                Columns
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="relative overflow-x-auto">
        <div className="overflow-y-auto" style={{ maxHeight }}>
          <table className="w-full text-left" style={{ minWidth }}>
            <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-400 shadow-[inset_0_-1px_0_0_rgb(241_245_249)]">
              <tr>
                {visibleColumns.map((col) => {
                  const canSort = col.sortable ?? !!col.sortValue
                  const active = sortId === col.id
                  return (
                    <th
                      key={col.id}
                      className={cn('px-3 py-3 whitespace-nowrap', col.headerClassName)}
                      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : canSort ? 'none' : undefined}
                    >
                      {canSort ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(col)}
                          className="inline-flex items-center gap-1 text-left uppercase tracking-wide text-slate-400 transition hover:text-slate-600"
                        >
                          <span>{col.header}</span>
                          {active ? (
                            sortDir === 'asc' ? <ArrowUp className="size-3.5 shrink-0" /> : <ArrowDown className="size-3.5 shrink-0" />
                          ) : (
                            <ArrowUpDown className="size-3.5 shrink-0 opacity-50" />
                          )}
                        </button>
                      ) : (
                        col.header
                      )}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody className="relative">
              {pageLoading && (
                <tr>
                  <td colSpan={Math.max(visibleColumns.length, 1)} className="px-4 py-10 text-center text-xs text-slate-400">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin" />
                      Loading page…
                    </span>
                  </td>
                </tr>
              )}
              {!pageLoading && pageRows.length === 0 && (
                <tr>
                  <td colSpan={Math.max(visibleColumns.length, 1)} className="px-4 py-8 text-center text-xs text-slate-400">
                    {emptyMessage}
                  </td>
                </tr>
              )}
              {!pageLoading && pageRows.map((row, i) => {
                const absoluteIndex = (safePage - 1) * pageSize + i
                return (
                  <tr
                    key={rowKey(row, absoluteIndex)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(
                      'border-t border-slate-100 text-xs',
                      onRowClick && 'cursor-pointer',
                      rowClassName?.(row, absoluteIndex),
                    )}
                  >
                    {visibleColumns.map((col) => (
                      <td key={col.id} className={cn('px-3 py-3', col.className)}>
                        {col.cell(row, absoluteIndex)}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-400">
        <span>
          Showing {sorted.length === 0 ? 0 : (safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, sorted.length)} of {sorted.length}
          {footerExtra ? <> · {footerExtra}</> : null}
        </span>
        <div className="flex items-center gap-1">
          <Button type="button" variant="outline" size="sm" disabled={safePage <= 1 || pageLoading} onClick={() => goToPage(safePage - 1)}>
            <ChevronLeft data-icon="inline-start" />
            Prev
          </Button>
          <span className="min-w-[4.5rem] px-2 text-center tabular-nums text-slate-500">
            {safePage} / {totalPages}
          </span>
          <Button type="button" variant="outline" size="sm" disabled={safePage >= totalPages || pageLoading} onClick={() => goToPage(safePage + 1)}>
            Next
            <ChevronRight data-icon="inline-end" />
          </Button>
        </div>
      </div>

      {pickerOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/30 p-4">
          <Card className="w-full max-w-sm p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-700">Visible columns</h2>
              <button type="button" onClick={() => setPickerOpen(false)} title="Close" aria-label="Close">
                <X className="size-4 text-slate-400" />
              </button>
            </div>
            <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
              {columns.map((col) => {
                const locked = col.hideable === false
                return (
                  <li key={col.id}>
                    <label className={cn('flex items-center gap-2 text-xs text-slate-700', locked && 'opacity-60')}>
                      <input
                        type="checkbox"
                        checked={visible[col.id] !== false}
                        disabled={locked}
                        onChange={(e) => setColumnVisible(col.id, e.target.checked)}
                      />
                      <span>{col.header}</span>
                      {locked ? <span className="text-[10px] uppercase text-slate-400">Required</span> : null}
                    </label>
                  </li>
                )
              })}
            </ul>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const next = Object.fromEntries(columns.map((c) => [c.id, true]))
                  setVisible(next)
                  if (storageKey) localStorage.setItem(`dt-cols:${storageKey}`, JSON.stringify(next))
                }}
              >
                Show all
              </Button>
              <Button type="button" size="sm" onClick={() => setPickerOpen(false)}>Done</Button>
            </div>
          </Card>
        </div>
      )}
    </>
  )

  if (!bordered) {
    return <div className={className} style={style}>{body}</div>
  }

  return <Card className={className} style={style}>{body}</Card>
}

/** Dense flex wrapper for Action-column icon buttons. */
export function TableActions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex items-center gap-0', className)}>{children}</div>
}
