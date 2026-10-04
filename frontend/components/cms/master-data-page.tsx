'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ComponentType } from 'react'
import {
  Archive,
  Building2,
  CheckCircle2,
  CircleDot,
  FileText,
  Flag,
  Forward,
  Inbox,
  Lock,
  Mail,
  Pencil,
  Plus,
  Send,
  Shield,
  Tag,
  Trash2,
} from 'lucide-react'
import { useAppData } from '@/components/app-provider'
import { Button } from '@/components/ui/button'
import { IconActionButton } from '@/components/ui/icon-action-button'
import { Badge, Card, PageTitle } from '@/components/cms/ui'
import { DataTable, TableActions, type DataTableColumn } from '@/components/cms/data-table'
import { FormDialog } from '@/components/cms/management-table'
import { fetchMasterItems, type MasterValueItem } from '@/services/management'

export const MASTER_CATEGORIES = [
  'Letter Types',
  'Priorities',
  'Statuses',
  'Confidentiality Levels',
  'Action Types',
  'Organization Types',
  'Document Types',
] as const

const CATEGORY_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  'Letter Types': Mail,
  Priorities: Flag,
  Statuses: CircleDot,
  'Confidentiality Levels': Lock,
  'Action Types': CheckCircle2,
  'Organization Types': Building2,
  'Document Types': FileText,
}

const VALUE_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  Incoming: Inbox,
  Outgoing: Send,
  'Internal Memo': Mail,
  Routine: Flag,
  Important: Flag,
  Urgent: Flag,
  Normal: Shield,
  Confidential: Lock,
  Restricted: Lock,
  Review: CircleDot,
  'Prepare response': Pencil,
  Forward: Forward,
  Approve: CheckCircle2,
  Archive: Archive,
  Government: Building2,
  Defence: Shield,
  Research: Tag,
  Commercial: Building2,
  'Foreign Organization': Building2,
  'Internal Department': Building2,
  'Original Letter': Mail,
  'Scanned Letter': FileText,
  'Draft Response': Pencil,
  'Final Response': CheckCircle2,
  'Supporting Document': FileText,
  'Technical Document': FileText,
  'Financial Document': FileText,
  'Reference Document': FileText,
  Other: Tag,
}

function StatusToggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={checked ? 'Active' : 'Inactive'}
      title={checked ? 'Active' : 'Inactive'}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition disabled:opacity-50 ${checked ? 'bg-emerald-500' : 'bg-slate-300'}`}
    >
      <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition ${checked ? 'left-5' : 'left-0.5'}`} />
    </button>
  )
}

function valueIcon(category: string, value: string) {
  return VALUE_ICONS[value] ?? CATEGORY_ICONS[category] ?? Tag
}

export function MasterData({ embedded = false }: { embedded?: boolean }) {
  const { addMasterValue, editMasterValue, removeMasterValue } = useAppData()
  const [items, setItems] = useState<MasterValueItem[]>([])
  const [tab, setTab] = useState<string>(MASTER_CATEGORIES[0])
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<MasterValueItem | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const rows = await fetchMasterItems()
    setItems(rows)
  }, [])

  useEffect(() => {
    load().catch((err: Error) => setError(err.message || 'Unable to load master data'))
  }, [load])

  const current = useMemo(() => items.filter((item) => item.category === tab), [items, tab])

  const toggleStatus = async (item: MasterValueItem) => {
    setBusyId(item.id)
    setError('')
    try {
      await editMasterValue(item.id, { status: item.status === 'Active' ? 'Inactive' : 'Active' })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update status')
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (item: MasterValueItem) => {
    if (!confirm(`Delete “${item.value}” from ${item.category}?`)) return
    setBusyId(item.id)
    setError('')
    try {
      await removeMasterValue(item.id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete value')
    } finally {
      setBusyId(null)
    }
  }

  const CategoryIcon = CATEGORY_ICONS[tab] ?? Tag

  const columns = useMemo<DataTableColumn<MasterValueItem>[]>(
    () => [
      {
        id: 'value',
        header: 'Value',
        sortValue: (item) => item.value,
        cell: (item) => {
          const Icon = valueIcon(item.category, item.value)
          return (
            <div className="flex items-center gap-2 font-semibold text-slate-700">
              <span className="inline-flex size-7 items-center justify-center rounded-md bg-slate-50 text-[#1769aa]">
                <Icon className="size-3.5" />
              </span>
              {item.value}
            </div>
          )
        },
      },
      {
        id: 'status',
        header: 'Status',
        sortValue: (item) => item.status,
        cell: (item) => (
          <div className="flex items-center gap-2">
            <StatusToggle
              checked={item.status === 'Active'}
              disabled={busyId === item.id}
              onChange={() => void toggleStatus(item)}
            />
            <Badge tone={item.status === 'Active' ? 'green' : 'slate'}>{item.status}</Badge>
          </div>
        ),
      },
      {
        id: 'actions',
        header: 'Actions',
        hideable: false,
        sortable: false,
        headerClassName: 'text-right',
        className: 'text-right',
        cell: (item) => (
          <TableActions className="justify-end">
            <IconActionButton label="Edit" icon={Pencil} disabled={busyId === item.id} onClick={() => setEditing(item)} />
            <IconActionButton label="Delete" icon={Trash2} tone="danger" disabled={busyId === item.id} onClick={() => void remove(item)} />
          </TableActions>
        ),
      },
    ],
    [busyId],
  )

  return (
    <>
      {!embedded && (
        <PageTitle
          title="Master Data"
          description="Manage reusable reference values used across the system."
          action={
            <Button onClick={() => setOpen(true)}>
              <Plus data-icon="inline-start" />
              Add value
            </Button>
          }
        />
      )}
      {embedded && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-700">Master data</h3>
            <p className="text-xs text-slate-500">Letter types, priorities, statuses, and other reference values.</p>
          </div>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus data-icon="inline-start" />
            Add value
          </Button>
        </div>
      )}
      {error && <p className="mb-3 text-xs text-red-600">{error}</p>}
      <Card>
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200 p-3">
          {MASTER_CATEGORIES.map((t) => {
            const Icon = CATEGORY_ICONS[t] ?? Tag
            return (
              <button
                type="button"
                onClick={() => setTab(t)}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-2 text-xs ${tab === t ? 'bg-blue-50 font-semibold text-[#1769aa]' : 'text-slate-500 hover:bg-slate-50'}`}
                key={t}
              >
                <Icon className="size-3.5" />
                {t}
              </button>
            )
          })}
        </div>
        <DataTable
          bordered={false}
          columns={columns}
          data={current}
          rowKey={(item) => String(item.id)}
          storageKey={`master-data-${tab}`}
          minWidth="480px"
          maxHeight="min(360px, 50vh)"
          title={tab}
          description={`${current.length} values`}
          emptyMessage={`No values yet. Add one for ${tab}.`}
        />
      </Card>
      {open && (
        <FormDialog
          title={`Add ${tab} value`}
          fields={[{ name: 'value', label: 'Value' }]}
          onClose={() => setOpen(false)}
          onSubmit={async (values) => {
            await addMasterValue(tab, values.value)
            await load()
          }}
        />
      )}
      {editing && (
        <FormDialog
          title={`Edit ${editing.category}`}
          fields={[{ name: 'value', label: 'Value' }]}
          initialValues={{ value: editing.value }}
          onClose={() => setEditing(null)}
          onSubmit={async (values) => {
            await editMasterValue(editing.id, { value: values.value })
            setEditing(null)
            await load()
          }}
        />
      )}
      {!embedded && (
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400">
          <CategoryIcon className="size-3.5" />
          {current.length} {tab.toLowerCase()}
        </p>
      )}
    </>
  )
}
