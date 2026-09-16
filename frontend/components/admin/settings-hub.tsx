'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Bell,
  Database,
  Gauge,
  KeyRound,
  Lock,
  RefreshCw,
  Shield,
  ShieldCheck,
  Tag,
  Trash2,
  User,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AppSettings, AppUser } from '@/services/management'
import {
  createRole,
  deleteRole,
  deleteStatusDefinition,
  deleteUser,
  fetchAdminResources,
  fetchAlertSettings,
  fetchRolePermissions,
  fetchRoles,
  fetchSecuritySettings,
  fetchSessions,
  fetchStatusDefinitions,
  fetchUserStats,
  saveAlertSettings,
  saveRolePermissions,
  saveSecuritySettings,
  saveStatusDefinition,
  terminateAllSessions,
  terminateSession,
  updateUser,
  type AdminResource,
  type PermissionRow,
  type RoleRow,
  type SessionRow,
  type StatusBadge,
  type UserStats,
} from '@/services/administration'

type TabId = 'users' | 'roles' | 'access' | 'status' | 'alerts' | 'security' | 'definitions' | 'backup'

const TABS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'users', label: 'Users', icon: Users },
  { id: 'roles', label: 'Roles', icon: Shield },
  { id: 'access', label: 'Role Access', icon: ShieldCheck },
  { id: 'status', label: 'Status', icon: Gauge },
  { id: 'alerts', label: 'Alerts', icon: Bell },
  { id: 'security', label: 'Security', icon: Lock },
  { id: 'definitions', label: 'Definitions', icon: Tag },
  { id: 'backup', label: 'Backup & Restore', icon: Database },
]

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition ${checked ? 'bg-[#2563eb]' : 'bg-slate-300'}`}
    >
      <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition ${checked ? 'left-5' : 'left-0.5'}`} />
    </button>
  )
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="text-sm font-bold text-slate-800">{title}</h3>
            {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

export function SettingsHub({
  initialTab = 'users',
  users,
  settings,
  masterData,
  onRefresh,
  onUpdateSettings,
  onAddUser,
  onAddMaster,
  go,
}: {
  initialTab?: TabId
  users: AppUser[]
  settings: AppSettings
  masterData: Record<string, string[]>
  onRefresh: () => Promise<void>
  onUpdateSettings: (input: Partial<AppSettings>) => Promise<void>
  onAddUser: (input: { name: string; username: string; department?: string; role?: string; email?: string }) => Promise<void>
  onAddMaster: (category: string, value: string) => Promise<void>
  go: (page: string) => void
}) {
  const [tab, setTab] = useState<TabId>(initialTab)
  const [stats, setStats] = useState<UserStats | null>(null)
  const [userQuery, setUserQuery] = useState('')
  const [userStatus, setUserStatus] = useState('All statuses')
  const [editUser, setEditUser] = useState<(AppUser & { id?: number }) | null>(null)
  const [roles, setRoles] = useState<RoleRow[]>([])
  const [roleQuery, setRoleQuery] = useState('')
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null)
  const [resources, setResources] = useState<AdminResource[]>([])
  const [permissions, setPermissions] = useState<Record<string, PermissionRow>>({})
  const [roleDescription, setRoleDescription] = useState('')
  const [statuses, setStatuses] = useState<StatusBadge[]>([])
  const [statusCategory, setStatusCategory] = useState('All categories')
  const [security, setSecurity] = useState<Record<string, unknown>>({})
  const [alerts, setAlerts] = useState<{ email: Record<string, boolean>; inApp: Record<string, boolean> } | null>(null)
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const [s, r, res, st] = await Promise.all([fetchUserStats(), fetchRoles(), fetchAdminResources(), fetchStatusDefinitions()])
    setStats(s)
    setRoles(r)
    setResources(res.resources)
    setStatuses(st)
    if (!selectedRoleId && r[0]) setSelectedRoleId(r[0].id)
  }, [selectedRoleId])

  useEffect(() => {
    load().catch(() => undefined)
  }, [load])

  useEffect(() => {
    if (tab !== 'access' || !selectedRoleId) return
    fetchRolePermissions(selectedRoleId).then((data) => {
      setPermissions(data.permissions)
      setRoleDescription(data.description)
    })
  }, [tab, selectedRoleId])

  useEffect(() => {
    if (tab === 'security') {
      fetchSecuritySettings().then(setSecurity)
      fetchSessions().then(setSessions)
    }
    if (tab === 'alerts') fetchAlertSettings().then(setAlerts)
  }, [tab])

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const q = !userQuery || [u.name, u.username, u.email, u.role].join(' ').toLowerCase().includes(userQuery.toLowerCase())
      const statusOk = userStatus === 'All statuses' || u.status === userStatus
      return q && statusOk
    })
  }, [users, userQuery, userStatus])

  const filteredRoles = roles.filter((r) => !roleQuery || r.name.toLowerCase().includes(roleQuery.toLowerCase()))

  const statusCategories = useMemo(() => ['All categories', ...new Set(statuses.map((s) => s.category))], [statuses])

  const saveUser = async () => {
    if (!editUser?.id) return
    await updateUser(editUser.id, {
      name: editUser.name,
      email: editUser.email,
      role: editUser.role,
      status: editUser.status,
      password: (editUser as AppUser & { password?: string }).password,
    })
    setEditUser(null)
    await onRefresh()
    setMsg('User updated.')
  }

  const setPerm = (resource: string, field: keyof PermissionRow, value: boolean, otherKey?: string) => {
    setPermissions((current) => {
      const base = current[resource] ?? { view: false, create: false, edit: false, delete: false, other: {} }
      const row: PermissionRow = { ...base, other: { ...base.other } }
      if (otherKey) row.other[otherKey] = value
      else if (field !== 'other') row[field] = value
      return { ...current, [resource]: row }
    })
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#102a43]">Settings</h1>
          <p className="mt-1 text-sm text-slate-500">Centralized administration for users, access control, and system configuration.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => load().then(() => onRefresh())}>
          <RefreshCw data-icon="inline-start" />
          Refresh
        </Button>
      </div>

      <div className="mb-6 flex flex-wrap gap-1 border-b border-slate-200 pb-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold ${tab === id ? 'bg-slate-100 text-[#0d3763]' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>

      {msg && <p className="mb-4 text-xs text-emerald-700">{msg}</p>}

      {tab === 'users' && (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
              ['Total Users', stats?.totalUsers ?? users.length],
              ['Active Users', stats?.activeUsers ?? 0],
              ['Inactive Users', stats?.inactiveUsers ?? 0],
              ['Currently Logged-in', stats?.loggedIn ?? 0],
              ['Failed Logins (Today)', stats?.failedLoginsToday ?? 0],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-[11px] font-medium text-slate-500">{label}</p>
                <p className="mt-2 text-2xl font-bold text-[#102a43]">{value}</p>
              </div>
            ))}
          </div>
          <div className="mb-4 flex flex-wrap gap-2">
            <input value={userQuery} onChange={(e) => setUserQuery(e.target.value)} placeholder="Search users…" className="h-10 min-w-[200px] flex-1 rounded-md border border-slate-200 px-3 text-xs" />
            <select value={userStatus} onChange={(e) => setUserStatus(e.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-xs">
              <option>All statuses</option>
              <option>Active</option>
              <option>Inactive</option>
            </select>
            <Button onClick={() => setEditUser({ id: 0, name: '', username: '', email: '', role: 'Clerk', department: '', status: 'Active', activity: '', created: '' })}>+ Add User</Button>
          </div>
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[10px] font-bold uppercase text-slate-400">
                <tr>
                  {['Name', 'Username', 'Email', 'Roles', 'Status', 'Created', 'Actions'].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => (
                  <tr key={u.username} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-semibold">{u.name}</td>
                    <td className="px-4 py-3">{u.username}</td>
                    <td className="px-4 py-3">{u.email || '—'}</td>
                    <td className="px-4 py-3">{u.role}</td>
                    <td className="px-4 py-3"><span className={`inline-flex items-center gap-1 ${u.status === 'Active' ? 'text-emerald-700' : 'text-red-600'}`}>● {u.status}</span></td>
                    <td className="px-4 py-3">{u.created || '—'}</td>
                    <td className="px-4 py-3">
                      <Button size="sm" variant="outline" onClick={() => setEditUser(u)}>Edit</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'roles' && (
        <>
          <p className="mb-3 text-xs text-slate-500">Create and manage roles.</p>
          <div className="mb-4 flex gap-2">
            <input value={roleQuery} onChange={(e) => setRoleQuery(e.target.value)} placeholder="Search roles…" className="h-10 flex-1 rounded-md border border-slate-200 px-3 text-xs" />
            <Button onClick={async () => { const name = prompt('Role name'); if (!name) return; await createRole(name, ''); await load() }}>+ Add Role</Button>
          </div>
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[10px] font-bold uppercase text-slate-400">
                <tr>{['Name', 'Description', 'Permissions', 'Actions'].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}</tr>
              </thead>
              <tbody>
                {filteredRoles.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-semibold">{r.name}</td>
                    <td className="px-4 py-3 text-slate-600">{r.description}</td>
                    <td className="px-4 py-3">{r.permissionCount}</td>
                    <td className="px-4 py-3 flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setSelectedRoleId(r.id); setTab('access') }}>Edit</Button>
                      <Button size="sm" variant="outline" className="text-red-600" onClick={async () => { await deleteRole(r.id); await load() }}>Delete</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'access' && (
        <>
          <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-semibold text-slate-600">Role</span>
                <select value={selectedRoleId ?? ''} onChange={(e) => setSelectedRoleId(Number(e.target.value))} className="h-10 min-w-[200px] rounded-md border border-slate-200 px-3">
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </label>
              <label className="flex min-w-[280px] flex-1 flex-col gap-1 text-xs">
                <span className="font-semibold text-slate-600">Description</span>
                <input value={roleDescription} onChange={(e) => setRoleDescription(e.target.value)} className="h-10 rounded-md border border-slate-200 px-3" />
              </label>
              <Button onClick={async () => { if (!selectedRoleId) return; await saveRolePermissions(selectedRoleId, roleDescription, permissions); setMsg('Permissions saved.') }}>Save changes</Button>
            </div>
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="bg-slate-50 text-[10px] font-bold uppercase text-slate-400">
                <tr><th className="px-3 py-2">Resource</th><th className="px-3 py-2">View</th><th className="px-3 py-2">Create</th><th className="px-3 py-2">Edit</th><th className="px-3 py-2">Delete</th><th className="px-3 py-2">Other</th></tr>
              </thead>
              <tbody>
                {resources.map((res) => {
                  const row = permissions[res.key] ?? { view: false, create: false, edit: false, delete: false, other: {} }
                  return (
                    <tr key={res.key} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-semibold">{res.label}</td>
                      {(['view', 'create', 'edit', 'delete'] as const).map((f) => (
                        <td key={f} className="px-3 py-2"><input type="checkbox" checked={!!row[f]} onChange={(e) => setPerm(res.key, f, e.target.checked)} /></td>
                      ))}
                      <td className="px-3 py-2">
                        {res.other.map((o) => (
                          <label key={o} className="mr-2 inline-flex items-center gap-1">
                            <input type="checkbox" checked={!!row.other?.[o]} onChange={(e) => setPerm(res.key, 'edit', e.target.checked, o)} />
                            {o}
                          </label>
                        ))}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'status' && (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <select value={statusCategory} onChange={(e) => setStatusCategory(e.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-xs">
              {statusCategories.map((c) => <option key={c}>{c}</option>)}
            </select>
            <Button onClick={() => go('Import Center')}>Import CSV</Button>
            <Button onClick={async () => {
              const name = prompt('Status name'); if (!name) return
              await saveStatusDefinition({ category: 'Correspondence', name, description: '', color: '#64748b' })
              setStatuses(await fetchStatusDefinitions())
            }}>+ Add Status</Button>
          </div>
          {statusCategories.filter((c) => c !== 'All categories' && (statusCategory === 'All categories' || c === statusCategory)).map((cat) => (
            <div key={cat} className="mb-6">
              <h3 className="mb-3 text-sm font-bold text-slate-700">{cat}</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {statuses.filter((s) => s.category === cat).map((s) => (
                  <div key={s.id} className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="flex items-start justify-between">
                      <span className="rounded-md px-2 py-1 text-[11px] font-bold text-white" style={{ backgroundColor: s.color }}>{s.name}</span>
                      <button type="button" className="text-red-500" onClick={async () => { await deleteStatusDefinition(s.id); setStatuses(await fetchStatusDefinitions()) }}><Trash2 className="size-3.5" /></button>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">{s.description}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {tab === 'alerts' && alerts && (
        <div className="space-y-6">
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-bold text-slate-700">Email notifications</h3>
            <p className="text-xs text-slate-500">Choose which operational events generate email alerts.</p>
            <div className="mt-4 divide-y divide-slate-100">
              {Object.entries(alerts.email).map(([key, on]) => (
                <div key={key} className="flex items-center justify-between py-3 text-xs">
                  <span className="capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
                  <Toggle checked={on} onChange={async (v) => { const next = { ...alerts, email: { ...alerts.email, [key]: v } }; setAlerts(next); await saveAlertSettings(next) }} />
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-bold text-slate-700">In-app notifications</h3>
            {Object.entries(alerts.inApp).map(([key, on]) => (
              <div key={key} className="flex items-center justify-between py-3 text-xs">
                <span>{key === 'enabled' ? 'Enable in-app notifications' : 'Enable desktop notifications'}</span>
                <Toggle checked={on} onChange={async (v) => { const next = { ...alerts, inApp: { ...alerts.inApp, [key]: v } }; setAlerts(next); await saveAlertSettings(next) }} />
              </div>
            ))}
          </section>
        </div>
      )}

      {tab === 'security' && (
        <div className="space-y-6">
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <div><h3 className="text-sm font-bold">Password policy</h3><p className="text-xs text-slate-500">Define password strength and account lockout rules.</p></div>
              <Button size="sm" onClick={async () => { await saveSecuritySettings(security); setMsg('Security policy saved.') }}>Save policy</Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                ['minLength', 'Minimum length', 'number'],
                ['expiryDays', 'Password expiry (days)', 'number'],
                ['inactiveAfterDays', 'Auto-inactive after (days)', 'number'],
                ['historyLength', 'Password history', 'number'],
                ['maxAttempts', 'Max login attempts', 'number'],
                ['lockoutMinutes', 'Lockout duration (minutes)', 'number'],
              ].map(([key, label, type]) => (
                <label key={key} className="text-xs">
                  <span className="font-semibold text-slate-600">{label}</span>
                  <input type={type} value={String(security[key] ?? '')} onChange={(e) => setSecurity((s) => ({ ...s, [key]: Number(e.target.value) }))} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3" />
                </label>
              ))}
            </div>
            <div className="mt-4 space-y-2">
              {[
                ['requireUpper', 'Require uppercase'],
                ['requireLower', 'Require lowercase'],
                ['requireNumbers', 'Require numbers'],
                ['requireSpecial', 'Require special characters'],
              ].map(([key, label]) => (
                <div key={key} className="flex items-center justify-between rounded-md border border-slate-100 px-3 py-2 text-xs">
                  <span>{label}</span>
                  <Toggle checked={!!security[key]} onChange={(v) => setSecurity((s) => ({ ...s, [key]: v }))} />
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <div><h3 className="text-sm font-bold">Two-factor authentication</h3></div>
              <Button size="sm" variant="outline" onClick={async () => { await saveSecuritySettings(security); setMsg('2FA settings saved.') }}>Save 2FA</Button>
            </div>
            {[
              ['twoFactorEnabled', 'Enable two-factor authentication'],
              ['twoFactorRequiredAll', 'Require 2FA for all users'],
              ['twoFactorRequiredAdmin', 'Require 2FA for administrators only'],
            ].map(([key, label]) => (
              <div key={key} className="flex items-center justify-between border-t border-slate-100 py-3 text-xs">
                <span>{label}</span>
                <Toggle checked={!!security[key]} onChange={(v) => setSecurity((s) => ({ ...s, [key]: v }))} />
              </div>
            ))}
          </section>
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold">Active sessions</h3>
              <Button size="sm" variant="outline" className="text-red-600" onClick={async () => { await terminateAllSessions(); setSessions(await fetchSessions()) }}>Terminate all</Button>
            </div>
            <table className="w-full text-left text-[11px]">
              <thead className="text-slate-400"><tr>{['User', 'Device', 'Browser', 'OS', 'IP', 'Login', 'Status', ''].map((h) => <th key={h} className="py-2">{h}</th>)}</tr></thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="py-2">{s.username}</td><td className="py-2">{s.device}</td><td className="py-2">{s.browser}</td><td className="py-2">{s.os}</td><td className="py-2">{s.ipAddress}</td><td className="py-2">{s.loginTime}</td>
                    <td className="py-2"><span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-800">{s.status}</span></td>
                    <td className="py-2"><Button size="sm" variant="ghost" onClick={async () => { await terminateSession(s.id); setSessions(await fetchSessions()) }}>Terminate</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}

      {tab === 'definitions' && (
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h3 className="text-sm font-bold text-slate-700">System definitions</h3>
          <p className="text-xs text-slate-500">Organization profile and master data categories.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {([
              ['organizationName', 'Organization name'],
              ['systemName', 'System name'],
              ['defaultDueDays', 'Default due days'],
            ] as const).map(([key, label]) => (
              <label key={key} className="text-xs">
                <span className="font-semibold text-slate-600">{label}</span>
                <input defaultValue={settings[key]} onBlur={(e) => onUpdateSettings({ [key]: e.target.value })} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3" />
              </label>
            ))}
          </div>
          <div className="mt-6">
            <p className="mb-2 text-xs font-semibold text-slate-600">Quick add master value</p>
            <div className="flex gap-2">
              <select id="master-cat" className="h-10 rounded-md border border-slate-200 px-3 text-xs">
                {Object.keys(masterData).map((c) => <option key={c}>{c}</option>)}
              </select>
              <input id="master-val" placeholder="New value" className="h-10 flex-1 rounded-md border border-slate-200 px-3 text-xs" />
              <Button size="sm" onClick={async () => {
                const cat = (document.getElementById('master-cat') as HTMLSelectElement).value
                const val = (document.getElementById('master-val') as HTMLInputElement).value
                if (!val) return
                await onAddMaster(cat, val)
                setMsg('Master value added.')
              }}>Add</Button>
            </div>
          </div>
        </div>
      )}

      {tab === 'backup' && (
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h3 className="text-sm font-bold text-slate-700">Backup & restore</h3>
          <p className="mt-1 text-xs text-slate-500">Use the import and export center for CSV backup of correspondence and reference data.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => go('Export Center')}>Open export center</Button>
            <Button variant="outline" onClick={() => go('Import Center')}>Open import center</Button>
          </div>
        </div>
      )}

      {editUser && (
        <Modal title={editUser.id ? 'Edit user' : 'Add user'} subtitle="Update user details, status, and roles" onClose={() => setEditUser(null)}>
          <div className="space-y-3 text-xs">
            {!editUser.id && (
              <>
                <label className="block"><span className="font-semibold">Username</span><input value={editUser.username} onChange={(e) => setEditUser({ ...editUser, username: e.target.value })} className="mt-1 h-10 w-full rounded-md border px-3" /></label>
              </>
            )}
            {!!editUser.id && <p className="text-slate-500">Username (read-only): <strong>{editUser.username}</strong></p>}
            <label className="block"><span className="font-semibold">Full name</span><input value={editUser.name} onChange={(e) => setEditUser({ ...editUser, name: e.target.value })} className="mt-1 h-10 w-full rounded-md border px-3" /></label>
            <label className="block"><span className="font-semibold">Email</span><input value={editUser.email} onChange={(e) => setEditUser({ ...editUser, email: e.target.value })} className="mt-1 h-10 w-full rounded-md border px-3" /></label>
            <label className="block"><span className="font-semibold">New password (optional)</span><input type="password" placeholder="Leave blank to keep current" onChange={(e) => setEditUser({ ...editUser, password: e.target.value } as AppUser & { password?: string })} className="mt-1 h-10 w-full rounded-md border px-3" /></label>
            <label className="block"><span className="font-semibold">Role</span>
              <select value={editUser.role} onChange={(e) => setEditUser({ ...editUser, role: e.target.value })} className="mt-1 h-10 w-full rounded-md border px-3">
                {roles.map((r) => <option key={r.id}>{r.name}</option>)}
              </select>
            </label>
            <div className="flex items-center justify-between rounded-md border border-slate-100 p-3">
              <div><p className="font-semibold">Account active</p><p className="text-slate-500">Inactive users cannot sign in until reactivated</p></div>
              <Toggle checked={editUser.status === 'Active'} onChange={(v) => setEditUser({ ...editUser, status: v ? 'Active' : 'Inactive' })} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditUser(null)}>Cancel</Button>
              <Button onClick={async () => {
                if (!editUser.id) {
                  await onAddUser({ name: editUser.name, username: editUser.username, email: editUser.email, role: editUser.role })
                } else if (editUser.id > 0) {
                  await saveUser()
                }
                setEditUser(null)
                await onRefresh()
              }}>{editUser.id ? 'Update' : 'Create'}</Button>
              {editUser.id && editUser.id > 0 && editUser.username !== 'admin' && (
                <Button variant="outline" className="text-red-600" onClick={async () => { await deleteUser(editUser.id!); setEditUser(null); await onRefresh() }}>Delete</Button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
