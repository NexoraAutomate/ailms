'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BarChart3,
  Bell,
  BriefcaseBusiness,
  Building2,
  Calendar,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  ClipboardList,
  Download,
  FilePlus2,
  FileText,
  Inbox,
  KeyRound,
  LayoutDashboard,
  Lightbulb,
  LineChart,
  LogOut,
  Maximize2,
  Menu,
  Moon,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Table2,
  Tags,
  Upload,
  Users,
  X,
} from 'lucide-react'
import { useAppData } from '@/components/app-provider'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/cms/ui'
import { useCmsSearch } from '@/components/cms/search-context'
import { useGo } from '@/hooks/use-go'
import { hrefForLabel, labelFromPathname, NAV_GROUPS } from '@/lib/cms-nav'
import { formatHeaderDate } from '@/lib/datetime'
import { applyTheme, getPreferredTheme } from '@/lib/theme'
import { looksLikeNaturalQuery } from '@/services/ai'

const NAV_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Dashboard: LayoutDashboard,
  'My Actions': CalendarClock,
  Monitoring: SlidersHorizontal,
  'All Letters': Table2,
  Incoming: Inbox,
  Outgoing: Send,
  'Register Letter': FilePlus2,
  Pending: ClipboardList,
  Overdue: CircleAlert,
  Closed: CheckCircle2,
  Archive: BriefcaseBusiness,
  'AI Assistant': Sparkles,
  'Letter Analysis': LineChart,
  'AI Insights': Lightbulb,
  Meetings: Calendar,
  'Import Center': Upload,
  'Export Center': Download,
  Analytics: BarChart3,
  Reports: FileText,
  Departments: Building2,
  Organizations: Building2,
  'Users & Roles': Users,
  'Master Data': Tags,
  'Audit Log': ShieldCheck,
  Notifications: Bell,
  Settings: Settings2,
}

function Sidebar({ mobile, setMobile }: { mobile: boolean; setMobile: (v: boolean) => void }) {
  const { unreadCount } = useAppData()
  const pathname = usePathname()
  const page = labelFromPathname(pathname)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const group = NAV_GROUPS.find((g) => g.items.some((label) => page === label))
    if (group) setOpenGroups((prev) => ({ ...prev, [group.label]: true }))
  }, [page])

  const groupContainsPage = (items: readonly string[]) => items.some((label) => page === label)
  const isOpen = (label: string, items: readonly string[]) => openGroups[label] ?? groupContainsPage(items)
  const toggleGroup = (label: string, items: readonly string[]) => {
    setOpenGroups((prev) => ({ ...prev, [label]: !(prev[label] ?? groupContainsPage(items)) }))
  }

  return (
    <aside className={`${mobile ? 'fixed inset-y-0 left-0 z-20 flex w-72' : 'hidden lg:flex lg:h-dvh lg:w-64 lg:shrink-0'} flex-col border-r border-slate-200 bg-white`}>
      <div className="flex h-[72px] shrink-0 items-center gap-3 border-b border-slate-200 px-5">
        <Logo />
        <div>
          <p className="text-sm font-bold text-[#102a43]">Correspondence</p>
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400">Management System</p>
        </div>
        {mobile && (
          <button className="ml-auto" onClick={() => setMobile(false)}>
            <X className="size-5" />
          </button>
        )}
      </div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-4">
        {NAV_GROUPS.map((group) => {
          const expanded = isOpen(group.label, group.items)
          const active = groupContainsPage(group.items)
          return (
            <div key={group.label}>
              <button
                type="button"
                onClick={() => toggleGroup(group.label, group.items)}
                aria-expanded={expanded}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.14em] transition-colors ${active ? 'text-[#0d3763]' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}
              >
                <span className="flex-1">{group.label}</span>
                <ChevronDown className={`size-3.5 shrink-0 transition-transform ${expanded ? 'rotate-0' : '-rotate-90'}`} />
              </button>
              <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`} aria-hidden={!expanded}>
                <div className="min-h-0 overflow-hidden" inert={!expanded || undefined}>
                  <div className="flex flex-col gap-1 pb-2 pl-1">
                    {group.items.map((label) => {
                      const Icon = NAV_ICONS[label] ?? FileText
                      const href = hrefForLabel(label)
                      const isActive = page === label
                      return (
                        <Link
                          key={label}
                          href={href}
                          onClick={() => setMobile(false)}
                          className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${isActive ? 'bg-blue-50 font-semibold text-[#0d3763]' : 'text-slate-600 hover:bg-slate-50'}`}
                        >
                          <Icon className="size-4" />
                          <span>{label}</span>
                          {label === 'Notifications' && unreadCount > 0 && (
                            <span className="ml-auto rounded-full bg-red-100 px-1.5 text-[10px] font-bold text-red-600">{unreadCount}</span>
                          )}
                        </Link>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </nav>
    </aside>
  )
}

function Header({ setMobile }: { setMobile: (v: boolean) => void }) {
  const { me, unreadCount, settings } = useAppData()
  const { query, setQuery } = useCmsSearch()
  const go = useGo()
  const [menuOpen, setMenuOpen] = useState(false)
  const [dark, setDark] = useState(false)
  const [pwdOpen, setPwdOpen] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const today = formatHeaderDate()

  useEffect(() => {
    setDark(getPreferredTheme() === 'dark')
  }, [])

  const toggleTheme = () => {
    const next = !dark
    setDark(next)
    applyTheme(next ? 'dark' : 'light')
  }

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.()
    else document.exitFullscreen?.()
  }

  return (
    <header className="sticky top-0 z-10 flex shrink-0 min-h-[72px] items-center gap-3 border-b border-slate-200 bg-white px-4 sm:px-7">
      <button className="lg:hidden" onClick={() => setMobile(true)}>
        <Menu className="size-5 text-slate-600" />
      </button>
      <div className="hidden min-w-0 flex-1 md:block">
        <p className="text-xs text-slate-400" suppressHydrationWarning>
          {today}
        </p>
        <p className="truncate text-sm font-semibold text-slate-700">{settings.systemName || 'Correspondence Management System'}</p>
      </div>
      <div className="relative flex-1 md:max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(e) => {
            const value = e.target.value
            setQuery(value)
            if (looksLikeNaturalQuery(value)) {
              /* navigation handled in CmsSearchProvider */
            }
          }}
          placeholder="Search or ask: Show overdue letters from SUPARCO"
          className="h-10 w-full rounded-md border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs outline-none ring-blue-500 focus:ring-2"
        />
      </div>
      <button type="button" className="rounded-md p-2 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-100" onClick={toggleFullscreen} title="Full screen">
        <Maximize2 className="size-5" />
      </button>
      <button type="button" className="rounded-md p-2 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-100" onClick={toggleTheme} title="Toggle theme">
        {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
      </button>
      <button type="button" className="rounded-md p-2 text-slate-500 hover:bg-slate-50" onClick={() => go('AI Assistant')} title="AI Assistant">
        <Sparkles className="size-5" />
      </button>
      <button type="button" className="relative rounded-md p-2 text-slate-500 hover:bg-slate-50" onClick={() => go('Notifications')}>
        <Bell className="size-5" />
        {unreadCount > 0 && (
          <span className="absolute right-0.5 top-0.5 min-w-[16px] rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
      <div className="relative border-l border-slate-200 pl-3">
        <button type="button" className="flex items-center gap-2 rounded-md p-1 hover:bg-slate-50" onClick={() => setMenuOpen((v) => !v)}>
          <span className="flex size-8 items-center justify-center rounded-full bg-[#dce9f7] text-xs font-bold text-[#0d3763]">{me.initials}</span>
          <span className="hidden text-left sm:block">
            <span className="block text-xs font-semibold text-slate-700">{me.name}</span>
            <span className="block text-[10px] font-medium text-[#2563eb]">{me.role}</span>
          </span>
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-full z-30 mt-2 w-56 rounded-lg border border-slate-200 bg-white py-2 shadow-lg">
              <div className="border-b border-slate-100 px-4 pb-2">
                <p className="text-xs font-bold text-slate-800">{me.name}</p>
                <p className="text-[11px] text-slate-400">{settings.currentUser || me.name.toLowerCase().replace(/\s+/g, '-')}</p>
              </div>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  setMenuOpen(false)
                  go('Settings:users')
                }}
              >
                <Users className="size-4" /> View profile
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  setMenuOpen(false)
                  setPwdOpen(true)
                }}
              >
                <KeyRound className="size-4" /> Change password
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs text-red-600 hover:bg-red-50"
                onClick={() => {
                  setMenuOpen(false)
                  go('Settings:security')
                }}
              >
                <LogOut className="size-4" /> Logout (demo)
              </button>
            </div>
          </>
        )}
      </div>
      {pwdOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
            <h3 className="text-sm font-bold text-slate-800">Change password</h3>
            <p className="mt-1 text-xs text-slate-500">Policy is enforced when full authentication is enabled.</p>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="mt-4 h-10 w-full rounded-md border border-slate-200 px-3 text-xs"
              placeholder="New password"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setPwdOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setPwdOpen(false)
                  setNewPassword('')
                }}
              >
                Update
              </Button>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}

export function CmsShell({ children }: { children: React.ReactNode }) {
  const { loading, error, refresh } = useAppData()
  const [mobile, setMobile] = useState(false)

  let content: React.ReactNode = children
  if (loading) {
    content = <div className="rounded-lg border border-slate-200 bg-white p-10 text-sm text-slate-500">Loading correspondence workspace…</div>
  } else if (error) {
    content = (
      <div className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h2 className="text-sm font-bold text-slate-700">Backend unavailable</h2>
        <p className="mt-2 text-sm text-slate-500">{error}</p>
        <Button className="mt-4" onClick={() => refresh()}>
          Retry connection
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-[#f5f8fb] text-slate-900">
      <Sidebar mobile={mobile} setMobile={setMobile} />
      {mobile && <div onClick={() => setMobile(false)} className="fixed inset-0 z-10 bg-slate-900/20 lg:hidden" />}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Header setMobile={setMobile} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <main className="mx-auto w-full max-w-[1600px] p-4 sm:p-7">{content}</main>
        </div>
      </div>
    </div>
  )
}
