'use client'

import { useAppData } from '@/components/app-provider'
import { ManagementTable } from '@/components/cms/management-table'

export default function OrganizationsRoute() {
  const { organizations, addOrganization } = useAppData()
  return (
    <ManagementTable
      title="Organizations"
      description="Manage internal and external correspondence sources."
      headers={['Organization', 'Short Name', 'Type', 'Contact Person', 'Email', 'Phone', 'Status']}
      rows={organizations}
      onAdd={(v) => addOrganization({ name: v.name, short: v.short, type: v.type, contact: v.contact, email: v.email, phone: v.phone })}
      addFields={[{ name: 'name', label: 'Organization' }, { name: 'short', label: 'Short name' }, { name: 'type', label: 'Type' }, { name: 'contact', label: 'Contact person' }, { name: 'email', label: 'Email' }, { name: 'phone', label: 'Phone' }]}
    />
  )
}
