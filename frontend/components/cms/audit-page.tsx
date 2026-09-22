'use client'

import { useAppData } from '@/components/app-provider'
import { Badge, Card, Filters, PageTitle } from '@/components/cms/ui'

export function Audit() {
  const { auditRecords, aiAudit } = useAppData()
  const rows = [...aiAudit.map((item) => ({ date: item.date, user: item.user, module: item.module, action: item.action, record: item.record, description: item.description, source: item.source })), ...auditRecords]
  return (
    <>
      <PageTitle title="Audit Log" description="Read-only record of system activity and administrative changes." />
      <Filters />
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-400">
              <tr>{['Date / Time', 'User', 'Module', 'Action', 'Record', 'Description', 'IP / Source'].map((h) => <th className="px-4 py-3" key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((a, index) => (
                <tr className="border-t border-slate-100 text-xs" key={`${a.date}-${a.record}-${a.action}-${index}`}>
                  <td className="px-4 py-3 text-slate-500">{a.date}</td>
                  <td className="px-4 py-3 font-semibold">{a.user}</td>
                  <td className="px-4 py-3"><Badge tone={a.module === 'AI Intelligence' ? 'violet' : 'blue'}>{a.module}</Badge></td>
                  <td className="px-4 py-3">{a.action}</td>
                  <td className="px-4 py-3 text-[#1769aa]">{a.record}</td>
                  <td className="px-4 py-3 text-slate-600">{a.description}</td>
                  <td className="px-4 py-3 text-slate-400">{a.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
