'use client'

import { useState } from 'react'
import { MoreHorizontal, Plus, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, Card, PageTitle } from '@/components/cms/ui'

export function FormDialog({ title, fields, onClose, onSubmit }: { title: string; fields: { name: string; label: string; required?: boolean }[]; onClose: () => void; onSubmit: (values: Record<string, string>) => Promise<void> }) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/30 p-4">
      <Card className="w-full max-w-lg p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-700">{title}</h2>
          <button onClick={onClose}><X className="size-4 text-slate-400" /></button>
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
  return (
    <>
      <PageTitle title={title} description={description} action={onAdd && <Button onClick={() => setOpen(true)}><Plus data-icon="inline-start" />Add {title.slice(0, -1).toLowerCase()}</Button>} />
      <div className="mb-4 flex gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${title.toLowerCase()}...`} className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-xs" />
        </div>
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-400">
              <tr>{headers.map((h) => <th className="px-4 py-3" key={h}>{h}</th>)}<th className="px-4 py-3">Actions</th></tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr className="border-t border-slate-100 text-xs" key={i}>
                  {Object.values(r).map((v, j) => (
                    <td className="px-4 py-3 text-slate-600" key={j}>{j === Object.values(r).length - 1 && ['Active', 'Inactive'].includes(String(v)) ? <Badge tone={v === 'Active' ? 'green' : 'slate'}>{String(v)}</Badge> : String(v)}</td>
                  ))}
                  <td className="px-4 py-3"><button className="rounded p-1 text-slate-400 hover:bg-slate-100"><MoreHorizontal className="size-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {open && onAdd && addFields && <FormDialog title={addTitle ?? `Add ${title}`} fields={addFields} onClose={() => setOpen(false)} onSubmit={onAdd} />}
    </>
  )
}
