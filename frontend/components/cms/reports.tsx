'use client'

import { useMemo, useState } from 'react'
import { Download, Printer } from 'lucide-react'
import { useAppData } from '@/components/app-provider'
import { Button } from '@/components/ui/button'
import { Badge, Card, Filters, PageTitle } from '@/components/cms/ui'
import { priorityTone, statusTone } from '@/services/letters'

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
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
              <div>
                <h2 className="text-sm font-bold text-slate-700">{report}</h2>
                <p className="text-xs text-slate-400">{rows.length} records ready</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => window.print()}><Printer data-icon="inline-start" />Print</Button>
                <Button size="sm" variant="outline" onClick={exportCsv}><Download data-icon="inline-start" />Export CSV</Button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left">
                <thead className="bg-slate-50 text-[10px] uppercase text-slate-400">
                  <tr>{['Letter No.', 'Date', 'Subject', 'Department', 'Assigned To', 'Status', 'Priority', 'Due Date', 'Completion Date'].map((h) => <th className="px-3 py-3" key={h}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr className="border-t border-slate-100 text-xs" key={r.id}>
                      <td className="px-3 py-3 font-semibold text-[#1769aa]">{r.number}</td>
                      <td className="px-3 py-3">{r.letterDate}</td>
                      <td className="max-w-[190px] truncate px-3 py-3 text-slate-700">{r.subject}</td>
                      <td className="px-3 py-3">{r.department}</td>
                      <td className="px-3 py-3">{r.assignedTo}</td>
                      <td className="px-3 py-3"><Badge tone={statusTone(r.status)}>{r.status}</Badge></td>
                      <td className="px-3 py-3"><Badge tone={priorityTone(r.priority)}>{r.priority}</Badge></td>
                      <td className="px-3 py-3">{r.dueDate}</td>
                      <td className="px-3 py-3">{r.completionDate ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}
