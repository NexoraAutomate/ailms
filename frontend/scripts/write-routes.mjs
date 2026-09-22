import fs from 'fs'
import path from 'path'

function write(rel, content) {
  const full = path.join('frontend', rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content.trim() + '\n')
  console.log('wrote', rel)
}

const client = (imports, body) => `'use client'\n\n${imports}\n\n${body}\n`

write(
  'app/(cms)/page.tsx',
  client(
    `import { Dashboard } from '@/components/cms/dashboard'\nimport { useGo } from '@/hooks/use-go'`,
    `export default function DashboardPage() {\n  const go = useGo()\n  return <Dashboard go={go} />\n}`,
  ),
)

const letterViews = [
  ['letters/page.tsx', 'All Letters'],
  ['letters/incoming/page.tsx', 'Incoming'],
  ['letters/outgoing/page.tsx', 'Outgoing'],
  ['letters/pending/page.tsx', 'Pending'],
  ['letters/overdue/page.tsx', 'Overdue'],
  ['letters/closed/page.tsx', 'Closed'],
  ['letters/archive/page.tsx', 'Archive'],
  ['letters/my-actions/page.tsx', 'My Actions'],
  ['letters/monitoring/page.tsx', 'Monitoring'],
]
for (const [rel, page] of letterViews) {
  write(
    `app/(cms)/${rel}`,
    client(
      `import { LetterListPage } from '@/components/cms/letter-list-page'`,
      `export default function Page() {\n  return <LetterListPage page="${page}" />\n}`,
    ),
  )
}

write(
  'app/(cms)/letters/register/page.tsx',
  client(
    `import { Register } from '@/components/cms/register-letter'\nimport { useGo } from '@/hooks/use-go'`,
    `export default function RegisterPage() {\n  const go = useGo()\n  return <Register go={go} />\n}`,
  ),
)

write(
  'app/(cms)/letters/[id]/page.tsx',
  client(
    `import { use } from 'react'\nimport { Details } from '@/components/cms/letter-details'\nimport { useGo } from '@/hooks/use-go'`,
    `export default function LetterDetailPage({ params }: { params: Promise<{ id: string }> }) {\n  const { id } = use(params)\n  const go = useGo()\n  return <Details id={id} go={go} />\n}`,
  ),
)

write(
  'app/(cms)/ai/assistant/page.tsx',
  client(
    `import { PageTitle } from '@/components/cms/ui'\nimport { AIAssistant } from '@/components/ai/pages'\nimport { useGo } from '@/hooks/use-go'`,
    `export default function AiAssistantPage() {\n  const go = useGo()\n  return (\n    <>\n      <PageTitle title="AI Assistant" description="Ask questions about the correspondence register. Responses are mock, advisory intelligence." />\n      <AIAssistant go={go} />\n    </>\n  )\n}`,
  ),
)

write(
  'app/(cms)/ai/insights/page.tsx',
  client(
    `import { PageTitle } from '@/components/cms/ui'\nimport { AIInsightsPage } from '@/components/ai/pages'\nimport { useGo } from '@/hooks/use-go'`,
    `export default function AiInsightsRoute() {\n  const go = useGo()\n  return (\n    <>\n      <PageTitle title="AI Insights" description="Operational, risk and management observations generated from the current register." />\n      <AIInsightsPage go={go} />\n    </>\n  )\n}`,
  ),
)

write(
  'app/(cms)/ai/analysis/page.tsx',
  client(
    `import { PageTitle } from '@/components/cms/ui'\nimport { LetterAnalysisPage } from '@/components/ai/pages'\nimport { useGo } from '@/hooks/use-go'`,
    `export default function LetterAnalysisRoute() {\n  const go = useGo()\n  return (\n    <>\n      <PageTitle title="Letter Analysis" description="Timeline, delays and relationship analysis for selected correspondence." />\n      <LetterAnalysisPage go={go} />\n    </>\n  )\n}`,
  ),
)

write(
  'app/(cms)/ai/analysis/[id]/page.tsx',
  client(
    `import { use } from 'react'\nimport { PageTitle } from '@/components/cms/ui'\nimport { LetterAnalysisPage } from '@/components/ai/pages'\nimport { useGo } from '@/hooks/use-go'`,
    `export default function LetterAnalysisIdRoute({ params }: { params: Promise<{ id: string }> }) {\n  const { id } = use(params)\n  const go = useGo()\n  return (\n    <>\n      <PageTitle title="Letter Analysis" description="Timeline, delays and relationship analysis for selected correspondence." />\n      <LetterAnalysisPage selectedId={id} go={go} />\n    </>\n  )\n}`,
  ),
)

write(
  'app/(cms)/meetings/page.tsx',
  client(
    `import { MeetingsPage } from '@/components/cms/meetings-pages'\nimport { useGo } from '@/hooks/use-go'`,
    `export default function MeetingsRoute() {\n  const go = useGo()\n  return <MeetingsPage go={go} />\n}`,
  ),
)

write(
  'app/(cms)/meetings/[id]/page.tsx',
  client(
    `import { use } from 'react'\nimport { useAppData } from '@/components/app-provider'\nimport { MeetingDetailPage } from '@/components/cms/meetings-pages'\nimport { useGo } from '@/hooks/use-go'`,
    `export default function MeetingDetailRoute({ params }: { params: Promise<{ id: string }> }) {\n  const { id } = use(params)\n  const go = useGo()\n  const { letters } = useAppData()\n  return <MeetingDetailPage id={id} go={go} letters={letters} />\n}`,
  ),
)

write(
  'app/(cms)/operations/import/page.tsx',
  client(
    `import { useAppData } from '@/components/app-provider'\nimport { ImportCenterPage } from '@/components/cms/import-export'`,
    `export default function ImportRoute() {\n  const { refresh } = useAppData()\n  return <ImportCenterPage refresh={refresh} />\n}`,
  ),
)

write(
  'app/(cms)/operations/export/page.tsx',
  client(
    `import { ExportCenterPage } from '@/components/cms/import-export'`,
    `export default function ExportRoute() {\n  return <ExportCenterPage />\n}`,
  ),
)

write(
  'app/(cms)/analytics/page.tsx',
  client(
    `import { Analytics } from '@/components/cms/analytics'`,
    `export default function AnalyticsRoute() {\n  return <Analytics />\n}`,
  ),
)

write(
  'app/(cms)/reports/page.tsx',
  client(
    `import { Reports } from '@/components/cms/reports'`,
    `export default function ReportsRoute() {\n  return <Reports />\n}`,
  ),
)

write(
  'app/(cms)/admin/departments/page.tsx',
  client(
    `import { useAppData } from '@/components/app-provider'\nimport { ManagementTable } from '@/components/cms/management-table'`,
    `export default function DepartmentsRoute() {
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
}`,
  ),
)

write(
  'app/(cms)/admin/organizations/page.tsx',
  client(
    `import { useAppData } from '@/components/app-provider'\nimport { ManagementTable } from '@/components/cms/management-table'`,
    `export default function OrganizationsRoute() {
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
}`,
  ),
)

write(
  'app/(cms)/admin/users/page.tsx',
  client(
    `import { useAppData } from '@/components/app-provider'\nimport { SettingsHub } from '@/components/admin/settings-hub'\nimport { useGo } from '@/hooks/use-go'`,
    `export default function UsersRolesRoute() {
  const go = useGo()
  const { users, settings, masterData, refresh, updateSettings, addUser, addMasterValue } = useAppData()
  return (
    <SettingsHub
      initialTab="users"
      users={users}
      settings={settings}
      masterData={masterData}
      onRefresh={refresh}
      onUpdateSettings={updateSettings}
      onAddUser={addUser}
      onAddMaster={addMasterValue}
      go={go}
    />
  )
}`,
  ),
)

write(
  'app/(cms)/admin/master-data/page.tsx',
  client(
    `import { MasterData } from '@/components/cms/master-data-page'`,
    `export default function MasterDataRoute() {\n  return <MasterData />\n}`,
  ),
)

write(
  'app/(cms)/admin/audit/page.tsx',
  client(
    `import { Audit } from '@/components/cms/audit-page'`,
    `export default function AuditRoute() {\n  return <Audit />\n}`,
  ),
)

write(
  'app/(cms)/notifications/page.tsx',
  client(
    `import { Notifications } from '@/components/cms/notifications-page'\nimport { useGo } from '@/hooks/use-go'`,
    `export default function NotificationsRoute() {\n  const go = useGo()\n  return <Notifications go={go} />\n}`,
  ),
)

write(
  'app/(cms)/settings/page.tsx',
  client(
    `import { useAppData } from '@/components/app-provider'\nimport { SettingsHub } from '@/components/admin/settings-hub'\nimport { useGo } from '@/hooks/use-go'`,
    `export default function SettingsRoute() {
  const go = useGo()
  const { users, settings, masterData, refresh, updateSettings, addUser, addMasterValue } = useAppData()
  return (
    <SettingsHub
      initialTab="users"
      users={users}
      settings={settings}
      masterData={masterData}
      onRefresh={refresh}
      onUpdateSettings={updateSettings}
      onAddUser={addUser}
      onAddMaster={addMasterValue}
      go={go}
    />
  )
}`,
  ),
)

write(
  'app/(cms)/settings/[tab]/page.tsx',
  client(
    `import { use } from 'react'\nimport { useAppData } from '@/components/app-provider'\nimport { SettingsHub } from '@/components/admin/settings-hub'\nimport { useGo } from '@/hooks/use-go'`,
    `type Tab = 'users' | 'roles' | 'access' | 'status' | 'alerts' | 'security' | 'definitions' | 'backup'

export default function SettingsTabRoute({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = use(params)
  const go = useGo()
  const { users, settings, masterData, refresh, updateSettings, addUser, addMasterValue } = useAppData()
  const initialTab = (['users', 'roles', 'access', 'status', 'alerts', 'security', 'definitions', 'backup'].includes(tab) ? tab : 'users') as Tab
  return (
    <SettingsHub
      initialTab={initialTab}
      users={users}
      settings={settings}
      masterData={masterData}
      onRefresh={refresh}
      onUpdateSettings={updateSettings}
      onAddUser={addUser}
      onAddMaster={addMasterValue}
      go={go}
    />
  )
}`,
  ),
)

if (fs.existsSync('frontend/app/page.tsx')) {
  fs.unlinkSync('frontend/app/page.tsx')
  console.log('removed frontend/app/page.tsx')
}
