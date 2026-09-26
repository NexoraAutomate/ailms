'use client'

import { useMemo, useState } from 'react'
import { Building2, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { useAppData } from '@/components/app-provider'
import { Badge, Card, PageTitle } from '@/components/cms/ui'
import { FormDialog } from '@/components/cms/management-table'
import { Button } from '@/components/ui/button'
import { IconActionButton } from '@/components/ui/icon-action-button'
import type { Organization } from '@/services/management'

const ORG_FIELDS = [
  { name: 'name', label: 'Organization' },
  { name: 'short', label: 'Short name' },
  { name: 'type', label: 'Type' },
  { name: 'contact', label: 'Contact person' },
  { name: 'email', label: 'Email' },
  { name: 'phone', label: 'Phone' },
]

function StatusToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={checked ? 'Active' : 'Inactive'}
      title={checked ? 'Active' : 'Inactive'}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition ${checked ? 'bg-emerald-500' : 'bg-slate-300'}`}
    >
      <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition ${checked ? 'left-5' : 'left-0.5'}`} />
    </button>
  )
}

export function OrganizationsManager({ embedded = false }: { embedded?: boolean }) {
  const { organizations, masterData, addOrganization, editOrganization, removeOrganization } = useAppData()
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Organization | null>(null)
  const [error, setError] = useState('')

  const orgTypes = masterData['Organization Types'] ?? ['Government', 'Defence', 'Research', 'Commercial', 'Other']

  const filtered = useMemo(
    () =>
      organizations.filter((org) =>
        [org.name, org.short, org.type, org.contact, org.email, org.phone, org.status]
          .join(' ')
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [organizations, search],
  )

  const fieldsWithTypes = ORG_FIELDS

  return (
    <>
      {!embedded ? (
        <PageTitle
          title="Organizations"
          description="Manage internal and external correspondence sources."
          action={
            <Button onClick={() => setAdding(true)}>
              <Plus data-icon="inline-start" />
              Add organization
            </Button>
          }
        />
      ) : (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-700">Organizations</h3>
            <p className="text-xs text-slate-500">Internal and external correspondence sources.</p>
          </div>
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus data-icon="inline-start" />
            Add organization
          </Button>
        </div>
      )}
      {error && <p className="mb-3 text-xs text-red-600">{error}</p>}
      <div className="mb-4 flex gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search organizations..."
            className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-xs"
          />
        </div>
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-400">
              <tr>
                {['Organization', 'Short Name', 'Type', 'Contact Person', 'Email', 'Phone', 'Status', 'Actions'].map((h) => (
                  <th className="px-4 py-3" key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((org, index) => (
                <tr className="border-t border-slate-100 text-xs" key={org.id ?? `${org.name}-${index}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 font-semibold text-slate-700">
                      <span className="inline-flex size-7 items-center justify-center rounded-md bg-slate-50 text-[#1769aa]">
                        <Building2 className="size-3.5" />
                      </span>
                      {org.name}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{org.short}</td>
                  <td className="px-4 py-3 text-slate-600">{org.type}</td>
                  <td className="px-4 py-3 text-slate-600">{org.contact}</td>
                  <td className="px-4 py-3 text-slate-600">{org.email}</td>
                  <td className="px-4 py-3 text-slate-600">{org.phone}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <StatusToggle
                        checked={org.status === 'Active'}
                        onChange={async (v) => {
                          if (!org.id) {
                            setError('Organization id missing. Restart the API server and refresh.')
                            return
                          }
                          setError('')
                          try {
                            await editOrganization(org.id, { status: v ? 'Active' : 'Inactive' })
                          } catch (err) {
                            setError(err instanceof Error ? err.message : 'Unable to update status')
                          }
                        }}
                      />
                      <Badge tone={org.status === 'Active' ? 'green' : 'slate'}>{org.status}</Badge>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-0.5">
                      <IconActionButton label="Edit" icon={Pencil} onClick={() => setEditing(org)} />
                      <IconActionButton
                        label="Delete"
                        icon={Trash2}
                        tone="danger"
                        onClick={async () => {
                          if (!org.id) {
                            setError('Organization id missing. Restart the API server and refresh.')
                            return
                          }
                          if (!confirm(`Delete organization “${org.name}”?`)) return
                          setError('')
                          try {
                            await removeOrganization(org.id)
                          } catch (err) {
                            setError(err instanceof Error ? err.message : 'Unable to delete')
                          }
                        }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-xs text-slate-400">No organizations found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      {adding && (
        <FormDialog
          title="Add organization"
          fields={fieldsWithTypes}
          onClose={() => setAdding(false)}
          onSubmit={async (v) => {
            await addOrganization({
              name: v.name,
              short: v.short,
              type: v.type || orgTypes[0],
              contact: v.contact,
              email: v.email,
              phone: v.phone,
            })
          }}
        />
      )}
      {editing && (
        <FormDialog
          title="Edit organization"
          fields={fieldsWithTypes}
          initialValues={{
            name: editing.name,
            short: editing.short,
            type: editing.type,
            contact: editing.contact,
            email: editing.email,
            phone: editing.phone,
          }}
          onClose={() => setEditing(null)}
          onSubmit={async (v) => {
            if (!editing.id) {
              setError('Organization id missing. Restart the API server and refresh.')
              return
            }
            await editOrganization(editing.id, {
              name: v.name,
              short: v.short,
              type: v.type,
              contact: v.contact,
              email: v.email,
              phone: v.phone,
            })
            setEditing(null)
          }}
        />
      )}
    </>
  )
}
