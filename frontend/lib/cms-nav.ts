/** Map legacy in-app page labels / tokens to App Router paths. */

export const NAV_GROUPS = [
  { label: 'Workspace', items: ['Dashboard', 'My Actions', 'Monitoring'] as const },
  {
    label: 'Letters',
    items: [
      'All Letters',
      'Incoming',
      'Outgoing',
      'Register Letter',
      'Pending',
      'Overdue',
      'Closed',
      'Archive',
    ] as const,
  },
  { label: 'AI Intelligence', items: ['AI Assistant', 'Letter Analysis', 'AI Insights'] as const },
  { label: 'Operations', items: ['Meetings', 'Import Center', 'Export Center'] as const },
  { label: 'Management', items: ['Analytics', 'Reports'] as const },
  {
    label: 'Administration',
    items: ['Departments', 'Organizations', 'Users & Roles', 'Master Data', 'Audit Log'] as const,
  },
  { label: 'System', items: ['Notifications', 'Settings'] as const },
] as const

const LABEL_TO_HREF: Record<string, string> = {
  Dashboard: '/',
  'My Actions': '/letters/my-actions',
  Monitoring: '/letters/monitoring',
  'All Letters': '/letters',
  Incoming: '/letters/incoming',
  Outgoing: '/letters/outgoing',
  'Register Letter': '/letters/register',
  Pending: '/letters/pending',
  Overdue: '/letters/overdue',
  Closed: '/letters/closed',
  Archive: '/letters/archive',
  'AI Assistant': '/ai/assistant',
  'Letter Analysis': '/ai/analysis',
  'AI Insights': '/ai/insights',
  Meetings: '/meetings',
  'Import Center': '/operations/import',
  'Export Center': '/operations/export',
  Analytics: '/analytics',
  Reports: '/reports',
  Departments: '/admin/departments',
  Organizations: '/admin/organizations',
  'Users & Roles': '/admin/users',
  'Master Data': '/admin/master-data',
  'Audit Log': '/admin/audit',
  Notifications: '/notifications',
  Settings: '/settings',
}

const PATH_TO_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(LABEL_TO_HREF).map(([label, href]) => [href, label]),
)

/** Resolve legacy go() targets (labels, detail:id, meeting:id, Settings:tab, bare ids) to hrefs. */
export function resolveNavHref(target: string): string {
  if (!target) return '/'
  if (target.startsWith('/')) return target
  if (target.startsWith('detail:')) return `/letters/${target.slice(7)}`
  if (target.startsWith('meeting:')) return `/meetings/${target.slice(8)}`
  if (target.startsWith('analysis:')) return `/ai/analysis/${target.slice(9)}`
  if (target.startsWith('Settings:')) {
    const tab = target.slice(9) || 'users'
    return `/settings/${tab}`
  }
  if (LABEL_TO_HREF[target]) return LABEL_TO_HREF[target]
  if (/^\d+$/.test(target)) return `/letters/${target}`
  return '/'
}

export function labelFromPathname(pathname: string): string {
  if (pathname === '/' || pathname === '') return 'Dashboard'
  if (/^\/letters\/\d+$/.test(pathname)) return 'All Letters'
  if (pathname.startsWith('/letters/register/review')) return 'Register Letter'
  if (pathname.startsWith('/meetings/') && pathname !== '/meetings') return 'Meetings'
  if (pathname.startsWith('/ai/analysis')) return 'Letter Analysis'
  if (pathname.startsWith('/settings')) return 'Settings'
  return PATH_TO_LABEL[pathname] ?? 'Dashboard'
}

export function hrefForLabel(label: string): string {
  return LABEL_TO_HREF[label] ?? '/'
}
