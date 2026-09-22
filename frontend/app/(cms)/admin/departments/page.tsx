'use client'

import { useAppData } from '@/components/app-provider'
import { ManagementTable } from '@/components/cms/management-table'

export default function DepartmentsRoute() {
  const { departments, addDepartment } = useAppData()
  return (
    <ManagementTable
      title="Departments"
      description="Manage organizational departments and workload ownership."
      headers={['Code', 'Department Name', 'Head / Responsible Officer', 'Active Users', 'Pending Letters', 'Status']}
      rows={departments}
      onAdd={(v) => addDepartment({ code: v.code, name: v.name, head: v.head })}
      addFields={[{ name: 'code', label: 'Code' }, { name: 'name', label: 'Department name' }, { name: 'head', label: 'Head / responsible officer' }]}
    />
  )
}
