'use client'

import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, PageTitle } from '@/components/cms/ui'
import { DataTable, type DataTableColumn } from '@/components/cms/data-table'
import {
  confirmLetterImport,
  downloadExport,
  validateLetterImport,
  type ImportJobResult,
} from '@/services/data-operations'

type ImportErrorRow = ImportJobResult['errors'][number]

export function ImportCenterPage({ refresh }: { refresh: () => Promise<void> }) {
  const [job, setJob] = useState<ImportJobResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const errorColumns = useMemo<DataTableColumn<ImportErrorRow>[]>(
    () => [
      { id: 'row', header: 'Row', sortValue: (e) => e.rowNumber, cell: (e) => e.rowNumber },
      { id: 'field', header: 'Field', sortValue: (e) => e.field, cell: (e) => e.field },
      { id: 'message', header: 'Message', sortValue: (e) => e.message, cell: (e) => e.message },
    ],
    [],
  )

  const onFile = async (file: File | null) => {
    if (!file) return
    setBusy(true)
    setMessage('')
    try {
      setJob(await validateLetterImport(file))
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Validation failed')
      setJob(null)
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (!job) return
    setBusy(true)
    setMessage('')
    try {
      const result = await confirmLetterImport(job.id)
      setJob(result)
      setMessage(`Imported ${result.importedRows} letter(s).`)
      await refresh()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageTitle title="Import Center" description="Upload CSV correspondence files, review validation results, then confirm import." />
      <Card className="max-w-3xl p-5">
        <p className="text-xs text-slate-500">Required columns: number, letterDate, subject. Optional: type, priority, status, department, assignedTo, from, to, receivedDate, dueDate, actionRequired, remarks.</p>
        <input type="file" accept=".csv,text/csv" className="mt-4 block text-xs" onChange={(e) => onFile(e.target.files?.[0] ?? null)} disabled={busy} />
        {message && <p className="mt-3 text-xs text-slate-600">{message}</p>}
        {job && (
          <div className="mt-5 space-y-3 text-xs">
            <p><strong>{job.filename}</strong> · {job.status} · {job.validRows} valid / {job.totalRows} total · {job.errorRows} errors</p>
            {job.errors.length > 0 && (
              <DataTable
                columns={errorColumns}
                data={job.errors}
                rowKey={(e, i) => `${e.rowNumber}-${e.field}-${i}`}
                storageKey="import-errors"
                minWidth="420px"
                maxHeight="12rem"
                title="Validation errors"
                description={`${job.errors.length} issues`}
              />
            )}
            {job.status === 'ready' && (
              <Button onClick={confirm} disabled={busy}>Confirm import ({job.validRows} rows)</Button>
            )}
          </div>
        )}
      </Card>
    </>
  )
}

export function ExportCenterPage() {
  const [message, setMessage] = useState('')
  const run = async (entity: 'letters' | 'departments' | 'organizations' | 'audit' | 'meetings' | 'notifications', includeArchived = false) => {
    setMessage('')
    try {
      await downloadExport(entity, includeArchived)
      setMessage(`Downloaded ${entity}.csv`)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Export failed')
    }
  }
  const items: { label: string; entity: 'letters' | 'departments' | 'organizations' | 'audit' | 'meetings' | 'notifications'; archived?: boolean }[] = [
    { label: 'Letters (active register)', entity: 'letters' },
    { label: 'Letters (include archived)', entity: 'letters', archived: true },
    { label: 'Departments', entity: 'departments' },
    { label: 'Organizations', entity: 'organizations' },
    { label: 'Audit log', entity: 'audit' },
    { label: 'Meetings', entity: 'meetings' },
    { label: 'My notifications', entity: 'notifications' },
  ]
  return (
    <>
      <PageTitle title="Export Center" description="Download CSV extracts from the live PostgreSQL register." />
      <Card className="max-w-xl p-5">
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <Button key={item.label} variant="outline" className="justify-start" onClick={() => run(item.entity, item.archived)}>
              <Download data-icon="inline-start" />
              {item.label}
            </Button>
          ))}
        </div>
        {message && <p className="mt-4 text-xs text-slate-600">{message}</p>}
      </Card>
    </>
  )
}
