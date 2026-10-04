'use client'

import { useMemo, useState } from 'react'
import { Download, Printer } from 'lucide-react'
import { useAppData } from '@/components/app-provider'
import { Button } from '@/components/ui/button'
import { Badge, Card, Filters, PageTitle } from '@/components/cms/ui'
import { DataTable, type DataTableColumn } from '@/components/cms/data-table'
import { priorityTone, statusTone, type Letter } from '@/services/letters'

function parseSortDate(value: string | undefined) {
  if (!value || value === '—') return 0
  const t = Date.parse(value)
  return Number.isNaN(t) ? 0 : t
}

const PRIORITY_RANK: Record<string, number> = { Urgent: 3, Important: 2, Routine: 1 }

export function Reports() {
  const { letters } = useAppData()
  const [report, setReport] = useState('Incoming Letters Report')
  const rows = useMemo(() => {
    if (report === 'Outgoing Letters Report') return letters.filter((r) => r.type === 'Outgoing')
    if (report === 'Pending Letters Report') return letters.filter((r) => !['Closed', 'Completed'].includes(r.status))
    if (report === 'Overdue Letters Report') return letters.filter((r) => r.status === 'Overdue')
    if (report === 'Closed Letters Report') return letters.filter((r) => r.status === 'Closed')
    if (report === 'Incoming Letters Report') return letters.filter((r) => r.type === 'Incoming')
    return letters
  }, [letters, report])

  const exportCsv = () => {
    const header = ['Letter No.', 'Date', 'Subject', 'Department', 'Assigned To', 'Status', 'Priority', 'Due Date', 'Completion Date']
    const lines = rows.map((r) => [r.number, r.letterDate, r.subject, r.department, r.assignedTo, r.status, r.priority, r.dueDate, r.completionDate ?? '—'].map((v) => `"${String(v).replaceAll('"', '""')}"`).join(','))
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${report.replaceAll(' ', '-').toLowerCase()}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const columns = useMemo<DataTableColumn<Letter>[]>(
    () => [
      { id: 'number', header: 'Letter No.', sortValue: (r) => r.number, className: 'font-semibold text-[#1769aa]', cell: (r) => r.number },
      { id: 'date', header: 'Date', sortValue: (r) => parseSortDate(r.letterDate), cell: (r) => r.letterDate },
      { id: 'subject', header: 'Subject', sortValue: (r) => r.subject, className: 'max-w-[190px] truncate text-slate-700', cell: (r) => r.subject },
      { id: 'department', header: 'Department', sortValue: (r) => r.department, cell: (r) => r.department },
      { id: 'assignedTo', header: 'Assigned To', sortValue: (r) => r.assignedTo, cell: (r) => r.assignedTo },
      { id: 'status', header: 'Status', sortValue: (r) => r.status, cell: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
      { id: 'priority', header: 'Priority', sortValue: (r) => PRIORITY_RANK[r.priority] ?? 0, cell: (r) => <Badge tone={priorityTone(r.priority)}>{r.priority}</Badge> },
      { id: 'dueDate', header: 'Due Date', sortValue: (r) => parseSortDate(r.dueDate), cell: (r) => r.dueDate },
      { id: 'completionDate', header: 'Completion Date', sortValue: (r) => parseSortDate(r.completionDate), cell: (r) => r.completionDate ?? '—' },
    ],
    [],
  )

  return (
    <>
      <PageTitle title="Reports" description="Generate operational reports from the correspondence register." />
      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-bold text-slate-700">Predefined reports</h2>
          <div className="flex flex-col gap-1">
            {['Incoming Letters Report', 'Outgoing Letters Report', 'Pending Letters Report', 'Overdue Letters Report', 'Closed Letters Report', 'Department Workload Report', 'Response Performance Report'].map((r) => (
              <button key={r} onClick={() => setReport(r)} className={`rounded-md px-3 py-2 text-left text-xs ${report === r ? 'bg-blue-50 font-semibold text-[#1769aa]' : 'text-slate-600 hover:bg-slate-50'}`}>{r}</button>
            ))}
          </div>
        </Card>
        <div>
          <Filters />
          <DataTable
            columns={columns}
            data={rows}
            rowKey={(r) => r.id}
            storageKey={`report-${report}`}
            minWidth="900px"
            title={report}
            description={`${rows.length} records ready`}
            toolbar={
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => window.print()}><Printer data-icon="inline-start" />Print</Button>
                <Button size="sm" variant="outline" onClick={exportCsv}><Download data-icon="inline-start" />Export CSV</Button>
              </div>
            }
          />
        </div>
      </div>
    </>
  )
}
