'use client'

import { useMemo } from 'react'
import { useAppData } from '@/components/app-provider'
import { Badge, Filters, PageTitle } from '@/components/cms/ui'
import { DataTable, type DataTableColumn } from '@/components/cms/data-table'

type AuditRow = {
  date: string
  user: string
  module: string
  action: string
  record: string
  description: string
  source: string
}

export function Audit() {
  const { auditRecords, aiAudit } = useAppData()
  const rows = useMemo<AuditRow[]>(
    () => [
      ...aiAudit.map((item) => ({
        date: item.date,
        user: item.user,
        module: item.module,
        action: item.action,
        record: item.record,
        description: item.description,
        source: item.source,
      })),
      ...auditRecords,
    ],
    [aiAudit, auditRecords],
  )

  const columns = useMemo<DataTableColumn<AuditRow>[]>(
    () => [
      { id: 'date', header: 'Date / Time', sortValue: (a) => a.date, className: 'text-slate-500', cell: (a) => a.date },
      { id: 'user', header: 'User', sortValue: (a) => a.user, className: 'font-semibold', cell: (a) => a.user },
      {
        id: 'module',
        header: 'Module',
        sortValue: (a) => a.module,
        cell: (a) => <Badge tone={a.module === 'AI Intelligence' ? 'violet' : 'blue'}>{a.module}</Badge>,
      },
      { id: 'action', header: 'Action', sortValue: (a) => a.action, cell: (a) => a.action },
      { id: 'record', header: 'Record', sortValue: (a) => a.record, className: 'text-[#1769aa]', cell: (a) => a.record },
      { id: 'description', header: 'Description', sortValue: (a) => a.description, className: 'text-slate-600', cell: (a) => a.description },
      { id: 'source', header: 'IP / Source', sortValue: (a) => a.source, className: 'text-slate-400', cell: (a) => a.source },
    ],
    [],
  )

  return (
    <>
      <PageTitle title="Audit Log" description="Read-only record of system activity and administrative changes." />
      <Filters />
      <DataTable
        columns={columns}
        data={rows}
        rowKey={(a, i) => `${a.date}-${a.record}-${a.action}-${i}`}
        storageKey="audit-log"
        minWidth="920px"
        title="Audit trail"
        description={`${rows.length} events`}
      />
    </>
  )
}
