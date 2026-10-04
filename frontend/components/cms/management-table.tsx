'use client'

import { useMemo, useState } from 'react'
import { MoreHorizontal, Plus, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconActionButton } from '@/components/ui/icon-action-button'
import { Badge, Card, PageTitle } from '@/components/cms/ui'
import { DataTable, TableActions, type DataTableColumn } from '@/components/cms/data-table'

export function FormDialog({
  title,
  fields,
  onClose,
  onSubmit,
  initialValues,
}: {
  title: string
  fields: { name: string; label: string; required?: boolean }[]
  onClose: () => void
  onSubmit: (values: Record<string, string>) => Promise<void>
  initialValues?: Record<string, string>
}) {
  const [values, setValues] = useState<Record<string, string>>(initialValues ?? {})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/30 p-4">
      <Card className="w-full max-w-lg p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-700">{title}</h2>
          <button type="button" onClick={onClose} title="Close" aria-label="Close"><X className="size-4 text-slate-400" /></button>
        </div>
        <div className="grid gap-3">
          {fields.map((field) => (
            <label key={field.name} className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-slate-600">{field.label}</span>
              <input className="h-10 rounded-md border border-slate-200 px-3 text-xs" value={values[field.name] ?? ''} onChange={(e) => setValues((current) => ({ ...current, [field.name]: e.target.value }))} />
            </label>
          ))}
        </div>
        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={async () => {
            setBusy(true)
            setError('')
            try {
              await onSubmit(values)
              onClose()
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Unable to save')
            } finally {
              setBusy(false)
            }
          }}>Save</Button>
        </div>
      </Card>
    </div>
  )
}

export function ManagementTable({ title, description, headers, rows, onAdd, addTitle, addFields }: { title: string; description: string; headers: string[]; rows: Record<string, string | number>[]; onAdd?: (values: Record<string, string>) => Promise<void>; addTitle?: string; addFields?: { name: string; label: string }[] }) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const filtered = rows.filter((r) => Object.values(r).some((v) => String(v).toLowerCase().includes(search.toLowerCase())))
  const keys = useMemo(() => (rows[0] ? Object.keys(rows[0]) : headers.map((_, i) => `col${i}`)), [rows, headers])

  const columns = useMemo<DataTableColumn<Record<string, string | number>>[]>(() => {
    const cols: DataTableColumn<Record<string, string | number>>[] = headers.map((h, i) => {
      const key = keys[i] ?? `col${i}`
      return {
        id: key,
        header: h,
        sortValue: (r) => r[key],
        className: 'text-slate-600',
        cell: (r) => {
          const v = r[key]
          if (['Active', 'Inactive'].includes(String(v))) {
            return <Badge tone={v === 'Active' ? 'green' : 'slate'}>{String(v)}</Badge>
          }
          return String(v ?? '')
        },
      }
    })
    cols.push({
      id: 'actions',
      header: 'Actions',
      hideable: false,
      sortable: false,
      cell: () => (
        <TableActions>
          <IconActionButton label="More" icon={MoreHorizontal} />
        </TableActions>
      ),
    })
    return cols
  }, [headers, keys])

  return (
    <>
      <PageTitle title={title} description={description} action={onAdd && <Button onClick={() => setOpen(true)}><Plus data-icon="inline-start" />Add {title.slice(0, -1).toLowerCase()}</Button>} />
      <div className="mb-4 flex gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${title.toLowerCase()}...`} className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-xs" />
        </div>
      </div>
      <DataTable
        columns={columns}
        data={filtered}
        rowKey={(_, i) => String(i)}
        storageKey={`mgmt-${title}`}
        minWidth="760px"
        title={title}
        description={`${filtered.length} records`}
      />
      {open && onAdd && addFields && <FormDialog title={addTitle ?? `Add ${title}`} fields={addFields} onClose={() => setOpen(false)} onSubmit={onAdd} />}
    </>
  )
}
