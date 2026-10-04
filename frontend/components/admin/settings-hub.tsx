'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bell,
  Camera,
  Database,
  Gauge,
  Lock,
  LogIn,
  Pencil,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Tag,
  Trash2,
  UserCheck,
  UserX,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconActionButton } from '@/components/ui/icon-action-button'
import { UserAvatar } from '@/components/ui/user-avatar'
import { DataTable, TableActions, type DataTableColumn } from '@/components/cms/data-table'
import { Kpi, MiniDashboard } from '@/components/cms/ui'
import { MasterData } from '@/components/cms/master-data-page'
import { OrganizationsManager } from '@/components/cms/organizations-page'
import dynamic from 'next/dynamic'
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
import { uploadUserAvatar } from '@/services/management'

const DepartmentOrgChart = dynamic(
  () => import('@/components/cms/department-org-chart').then((m) => m.DepartmentOrgChart),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[min(55vh,560px)] items-center justify-center rounded-lg border border-slate-200 bg-white text-sm text-slate-500">
        Loading organization chart…
      </div>
    ),
  },
)

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

type EditUserForm = AppUser & { id?: number; password?: string; avatarFile?: File | null; avatarPreview?: string }

const USER_STAT_CARDS: {
  key: keyof UserStats
  label: string
  icon: React.ComponentType<{ className?: string }>
  iconBg: string
  iconColor: string
}[] = [
  { key: 'totalUsers', label: 'Total Users', icon: Users, iconBg: 'bg-blue-50', iconColor: 'text-blue-600' },
  { key: 'activeUsers', label: 'Active Users', icon: UserCheck, iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600' },
  { key: 'inactiveUsers', label: 'Inactive Users', icon: UserX, iconBg: 'bg-slate-100', iconColor: 'text-slate-600' },
  { key: 'loggedIn', label: 'Currently Logged-in', icon: LogIn, iconBg: 'bg-cyan-50', iconColor: 'text-cyan-700' },
  { key: 'failedLoginsToday', label: 'Failed Logins (Today)', icon: ShieldAlert, iconBg: 'bg-amber-50', iconColor: 'text-amber-700' },
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
            {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

function ProfilePictureField({
  name,
  previewUrl,
  required,
  onPick,
}: {
  name: string
  previewUrl?: string
  required?: boolean
  onPick: (file: File | null, preview: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="flex items-center gap-4 rounded-md border border-slate-100 p-3">
      <UserAvatar name={name || 'User'} avatarUrl={previewUrl} size="lg" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-slate-700">
          Profile picture{required ? <span className="text-red-500"> *</span> : null}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-500">PNG, JPG, or WebP · max 2 MB</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
            <Camera data-icon="inline-start" />
            {previewUrl ? 'Change photo' : 'Upload photo'}
          </Button>
          {previewUrl ? (
            <Button type="button" size="sm" variant="ghost" className="text-red-600" onClick={() => onPick(null, '')}>
              Remove
            </Button>
          ) : null}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null
            e.target.value = ''
            if (!file) return
            if (file.size > 2 * 1024 * 1024) {
              alert('Profile picture must be 2 MB or smaller')
              return
            }
            const reader = new FileReader()
            reader.onload = () => onPick(file, String(reader.result || ''))
            reader.readAsDataURL(file)
          }}
        />
      </div>
    </div>
  )
}

export function SettingsHub({
  initialTab = 'users',
  users,
  settings,
  masterData: _masterData,
  onRefresh,
  onUpdateSettings,
  onAddUser,
  onAddMaster: _onAddMaster,
  go,
}: {
  initialTab?: TabId
  users: AppUser[]
  settings: AppSettings
  masterData: Record<string, string[]>
  onRefresh: () => Promise<void>
  onUpdateSettings: (input: Partial<AppSettings>) => Promise<void>
  onAddUser: (input: {
    name: string
    username: string
    password: string
    department?: string
    role?: string
    email?: string
    avatarFile?: File | null
  }) => Promise<void>
  onAddMaster: (category: string, value: string) => Promise<void>
  go: (page: string) => void
}) {
  const [tab, setTab] = useState<TabId>(initialTab)

  useEffect(() => {
    setTab(initialTab)
  }, [initialTab])

  const selectTab = (id: TabId) => {
    setTab(id)
    go(`Settings:${id}`)
  }
  const [stats, setStats] = useState<UserStats | null>(null)
  const [userQuery, setUserQuery] = useState('')
  const [userStatus, setUserStatus] = useState('All statuses')
  const [editUser, setEditUser] = useState<EditUserForm | null>(null)
  const [formError, setFormError] = useState('')
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

  const isEditing = Boolean(editUser && (editUser.id ?? 0) > 0)

  const userColumns = useMemo<DataTableColumn<AppUser>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        sortValue: (u) => u.name,
        cell: (u) => (
          <div className="flex items-center gap-2.5">
            <UserAvatar name={u.name} avatarUrl={u.avatarUrl} size="sm" />
            <span className="font-semibold">{u.name}</span>
          </div>
        ),
      },
      { id: 'username', header: 'Username', sortValue: (u) => u.username, cell: (u) => u.username },
      { id: 'email', header: 'Email', sortValue: (u) => u.email || '', cell: (u) => u.email || '—' },
      { id: 'role', header: 'Roles', sortValue: (u) => u.role, cell: (u) => u.role },
      {
        id: 'status',
        header: 'Status',
        sortValue: (u) => u.status,
        cell: (u) => (
          <span className={`inline-flex items-center gap-1 ${u.status === 'Active' ? 'text-emerald-700' : 'text-red-600'}`}>
            ● {u.status}
          </span>
        ),
      },
      { id: 'created', header: 'Created', sortValue: (u) => u.created || '', cell: (u) => u.created || '—' },
      {
        id: 'actions',
        header: 'Actions',
        hideable: false,
        sortable: false,
        cell: (u) => (
          <TableActions>
            <IconActionButton label="Edit" icon={Pencil} onClick={() => openEditUser(u)} />
            {u.username !== 'admin' ? (
              <IconActionButton
                label="Delete"
                icon={Trash2}
                tone="danger"
                onClick={async () => {
                  if (!u.id || !confirm(`Delete user ${u.username}?`)) return
                  await deleteUser(u.id)
                  await onRefresh()
                  setMsg('User deleted.')
                }}
              />
            ) : null}
          </TableActions>
        ),
      },
    ],
    [onRefresh],
  )

  const roleColumns = useMemo<DataTableColumn<RoleRow>[]>(
    () => [
      { id: 'name', header: 'Name', sortValue: (r) => r.name, className: 'font-semibold', cell: (r) => r.name },
      { id: 'description', header: 'Description', sortValue: (r) => r.description, className: 'text-slate-600', cell: (r) => r.description },
      { id: 'permissionCount', header: 'Permissions', sortValue: (r) => r.permissionCount, cell: (r) => r.permissionCount },
      {
        id: 'actions',
        header: 'Actions',
        hideable: false,
        sortable: false,
        cell: (r) => (
          <TableActions>
            <IconActionButton label="Edit" icon={Pencil} onClick={() => { setSelectedRoleId(r.id); selectTab('access') }} />
            <IconActionButton label="Delete" icon={Trash2} tone="danger" onClick={async () => { await deleteRole(r.id); await load() }} />
          </TableActions>
        ),
      },
    ],
    [],
  )

  const accessColumns = useMemo<DataTableColumn<AdminResource>[]>(
    () => [
      { id: 'resource', header: 'Resource', sortValue: (res) => res.label, className: 'font-semibold', cell: (res) => res.label },
      {
        id: 'view',
        header: 'View',
        sortable: false,
        cell: (res) => {
          const row = permissions[res.key] ?? { view: false, create: false, edit: false, delete: false, other: {} }
          return <input type="checkbox" checked={!!row.view} onChange={(e) => setPerm(res.key, 'view', e.target.checked)} />
        },
      },
      {
        id: 'create',
        header: 'Create',
        sortable: false,
        cell: (res) => {
          const row = permissions[res.key] ?? { view: false, create: false, edit: false, delete: false, other: {} }
          return <input type="checkbox" checked={!!row.create} onChange={(e) => setPerm(res.key, 'create', e.target.checked)} />
        },
      },
      {
        id: 'edit',
        header: 'Edit',
        sortable: false,
        cell: (res) => {
          const row = permissions[res.key] ?? { view: false, create: false, edit: false, delete: false, other: {} }
          return <input type="checkbox" checked={!!row.edit} onChange={(e) => setPerm(res.key, 'edit', e.target.checked)} />
        },
      },
      {
        id: 'delete',
        header: 'Delete',
        sortable: false,
        cell: (res) => {
          const row = permissions[res.key] ?? { view: false, create: false, edit: false, delete: false, other: {} }
          return <input type="checkbox" checked={!!row.delete} onChange={(e) => setPerm(res.key, 'delete', e.target.checked)} />
        },
      },
      {
        id: 'other',
        header: 'Other',
        sortable: false,
        cell: (res) => {
          const row = permissions[res.key] ?? { view: false, create: false, edit: false, delete: false, other: {} }
          return (
            <>
              {res.other.map((o) => (
                <label key={o} className="mr-2 inline-flex items-center gap-1">
                  <input type="checkbox" checked={!!row.other?.[o]} onChange={(e) => setPerm(res.key, 'edit', e.target.checked, o)} />
                  {o}
                </label>
              ))}
            </>
          )
        },
      },
    ],
    [permissions],
  )

  const sessionColumns = useMemo<DataTableColumn<SessionRow>[]>(
    () => [
      { id: 'username', header: 'User', sortValue: (s) => s.username, cell: (s) => s.username },
      { id: 'device', header: 'Device', sortValue: (s) => s.device, cell: (s) => s.device },
      { id: 'browser', header: 'Browser', sortValue: (s) => s.browser, cell: (s) => s.browser },
      { id: 'os', header: 'OS', sortValue: (s) => s.os, cell: (s) => s.os },
      { id: 'ipAddress', header: 'IP', sortValue: (s) => s.ipAddress, cell: (s) => s.ipAddress },
      { id: 'loginTime', header: 'Login', sortValue: (s) => s.loginTime, cell: (s) => s.loginTime },
      {
        id: 'status',
        header: 'Status',
        sortValue: (s) => s.status,
        cell: (s) => <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-800">{s.status}</span>,
      },
      {
        id: 'actions',
        header: '',
        hideable: false,
        sortable: false,
        cell: (s) => (
          <Button size="sm" variant="ghost" onClick={async () => { await terminateSession(s.id); setSessions(await fetchSessions()) }}>
            Terminate
          </Button>
        ),
      },
    ],
    [],
  )

  const openAddUser = () => {
    setFormError('')
    setEditUser({
      id: 0,
      name: '',
      username: '',
      email: '',
      role: 'Clerk',
      department: '',
      status: 'Active',
      activity: '',
      created: '',
      password: '',
      avatarFile: null,
      avatarPreview: '',
    })
  }

  const openEditUser = (u: AppUser) => {
    setFormError('')
    setEditUser({
      ...u,
      password: '',
      avatarFile: null,
      avatarPreview: u.avatarUrl || '',
    })
  }

  const saveUser = async () => {
    if (!editUser?.id) return
    await updateUser(editUser.id, {
      name: editUser.name,
      email: editUser.email,
      role: editUser.role,
      status: editUser.status,
      password: editUser.password || undefined,
    })
    if (editUser.avatarFile) {
      await uploadUserAvatar(editUser.id, editUser.avatarFile)
    }
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

  const statValue = (key: keyof UserStats) => {
    if (key === 'totalUsers') return stats?.totalUsers ?? users.length
    if (!stats) return 0
    return stats[key] ?? 0
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
            onClick={() => selectTab(id)}
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
          <MiniDashboard
            title="User statistics"
            description="Account activity overview"
            className="mb-5"
            gridClassName="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5"
          >
            {USER_STAT_CARDS.map(({ key, label, icon: Icon }) => (
              <Kpi key={label} label={label} value={String(statValue(key))} icon={<Icon className="size-4" />} />
            ))}
          </MiniDashboard>
          <div className="mb-4 flex flex-wrap gap-2">
            <input value={userQuery} onChange={(e) => setUserQuery(e.target.value)} placeholder="Search users…" className="h-10 min-w-[200px] flex-1 rounded-md border border-slate-200 px-3 text-xs" />
            <select value={userStatus} onChange={(e) => setUserStatus(e.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-xs">
              <option>All statuses</option>
              <option>Active</option>
              <option>Inactive</option>
            </select>
            <Button onClick={openAddUser}>+ Add User</Button>
          </div>
          <DataTable
            columns={userColumns}
            data={filteredUsers}
            rowKey={(u) => u.username}
            storageKey="settings-users"
            minWidth="720px"
            title="Users"
            description={`${filteredUsers.length} accounts`}
          />
        </>
      )}

      {tab === 'roles' && (
        <>
          <p className="mb-3 text-xs text-slate-500">Create and manage roles.</p>
          <div className="mb-4 flex gap-2">
            <input value={roleQuery} onChange={(e) => setRoleQuery(e.target.value)} placeholder="Search roles…" className="h-10 flex-1 rounded-md border border-slate-200 px-3 text-xs" />
            <Button onClick={async () => { const name = prompt('Role name'); if (!name) return; await createRole(name, ''); await load() }}>+ Add Role</Button>
          </div>
          <DataTable
            columns={roleColumns}
            data={filteredRoles}
            rowKey={(r) => String(r.id)}
            storageKey="settings-roles"
            minWidth="560px"
            title="Roles"
            description={`${filteredRoles.length} roles`}
          />
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
          <DataTable
            columns={accessColumns}
            data={resources}
            rowKey={(res) => res.key}
            storageKey="settings-access"
            minWidth="720px"
            title="Permissions matrix"
            description="Toggle access per resource"
            showColumnPicker={false}
          />
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
                      <IconActionButton label="Delete" icon={Trash2} tone="danger" onClick={async () => { await deleteStatusDefinition(s.id); setStatuses(await fetchStatusDefinitions()) }} />
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
            <DataTable
              bordered={false}
              columns={sessionColumns}
              data={sessions}
              rowKey={(s) => String(s.id)}
              storageKey="settings-sessions"
              minWidth="720px"
              maxHeight="min(280px, 40vh)"
              showColumnPicker
              title="Sessions"
              description={`${sessions.length} active`}
            />
          </section>
        </div>
      )}

      {tab === 'definitions' && (
        <div className="space-y-8">
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-bold text-slate-700">System profile</h3>
            <p className="text-xs text-slate-500">Organization and system defaults.</p>
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
          </div>

          <section>
            <MasterData embedded />
          </section>

          <section>
            <DepartmentOrgChart embedded />
          </section>

          <section>
            <OrganizationsManager embedded />
          </section>
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

      {editUser ? (
        <Modal
          title={isEditing ? 'Edit user' : 'Add user'}
          subtitle={isEditing ? 'Update user details, status, and roles' : 'Add a new user'}
          onClose={() => setEditUser(null)}
        >
          <div className="space-y-3 text-xs">
            {formError ? <p className="rounded-md bg-red-50 px-3 py-2 text-red-600">{formError}</p> : null}
            <ProfilePictureField
              name={editUser.name}
              previewUrl={editUser.avatarPreview}
              required={!isEditing}
              onPick={(file, preview) => setEditUser({ ...editUser, avatarFile: file, avatarPreview: preview })}
            />
            {!isEditing ? (
              <label className="block"><span className="font-semibold">Username <span className="text-red-500">*</span></span><input value={editUser.username} onChange={(e) => setEditUser({ ...editUser, username: e.target.value })} className="mt-1 h-10 w-full rounded-md border px-3" /></label>
            ) : (
              <p className="text-slate-500">Username (read-only): <strong>{editUser.username}</strong></p>
            )}
            <label className="block"><span className="font-semibold">Full name <span className="text-red-500">*</span></span><input value={editUser.name} onChange={(e) => setEditUser({ ...editUser, name: e.target.value })} className="mt-1 h-10 w-full rounded-md border px-3" /></label>
            <label className="block"><span className="font-semibold">Email</span><input value={editUser.email} onChange={(e) => setEditUser({ ...editUser, email: e.target.value })} className="mt-1 h-10 w-full rounded-md border px-3" /></label>
            {isEditing ? (
              <label className="block"><span className="font-semibold">New password (optional)</span><input type="password" placeholder="Leave blank to keep current" value={editUser.password || ''} onChange={(e) => setEditUser({ ...editUser, password: e.target.value })} className="mt-1 h-10 w-full rounded-md border px-3" /></label>
            ) : (
              <label className="block"><span className="font-semibold">Password <span className="text-red-500">*</span></span><input type="password" placeholder="Enter password" value={editUser.password || ''} onChange={(e) => setEditUser({ ...editUser, password: e.target.value })} className="mt-1 h-10 w-full rounded-md border px-3" required /></label>
            )}
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
                setFormError('')
                if (!editUser.name.trim()) {
                  setFormError('Full name is required.')
                  return
                }
                if (!isEditing) {
                  if (!editUser.username.trim()) {
                    setFormError('Username is required.')
                    return
                  }
                  if (!editUser.password?.trim()) {
                    setFormError('Password is required.')
                    return
                  }
                  if (!editUser.avatarFile) {
                    setFormError('Profile picture is required.')
                    return
                  }
                  try {
                    await onAddUser({
                      name: editUser.name,
                      username: editUser.username,
                      email: editUser.email,
                      role: editUser.role,
                      password: editUser.password,
                      avatarFile: editUser.avatarFile,
                    })
                    setEditUser(null)
                    await onRefresh()
                    setMsg('User created.')
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'Unable to create user')
                  }
                  return
                }
                if ((editUser.id ?? 0) > 0) {
                  try {
                    await saveUser()
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'Unable to update user')
                  }
                }
              }}>{isEditing ? 'Update' : 'Create'}</Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  )
}
