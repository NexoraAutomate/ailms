/** Map legacy in-app page labels / tokens to App Router paths. */

export const NAV_GROUPS = [
  { label: 'Workspace', items: ['Dashboard', 'My Actions', 'Monitoring'] as const },
  {
    label: 'Letters',
    items: ['Inbox', 'Sent', 'Create', 'Track', 'Archive'] as const,
  },
  { label: 'AI Intelligence', items: ['AI Assistant', 'Letter Analysis', 'AI Insights'] as const },
  { label: 'Operations', items: ['Meetings', 'Import Center', 'Export Center'] as const },
  { label: 'Management', items: ['Analytics', 'Reports'] as const },
  {
    label: 'Administration',
    items: ['Audit Log'] as const,
  },
  { label: 'System', items: ['Notifications', 'Settings'] as const },
] as const

/** Secondary letter filters shown under the header when Track is active. */
export const LETTERS_TRACK_VIEWS = [
  'All Letters',
  'Incoming',
  'Outgoing',
  'Pending',
  'Overdue',
  'Closed',
  'Archived',
] as const

export type LettersTrackView = (typeof LETTERS_TRACK_VIEWS)[number]

const LABEL_TO_HREF: Record<string, string> = {
  Dashboard: '/',
  'My Actions': '/letters/my-actions',
  Monitoring: '/letters/monitoring',
  Inbox: '/letters/inbox',
  Sent: '/letters/sent',
  Create: '/letters/register',
  Track: '/letters',
  Archive: '/letters/archive',
  'All Letters': '/letters',
  Incoming: '/letters/incoming',
  Outgoing: '/letters/outgoing',
  'Register Letter': '/letters/register',
  Pending: '/letters/pending',
  Overdue: '/letters/overdue',
  Closed: '/letters/closed',
  Archived: '/letters/archived',
  'AI Assistant': '/ai/assistant',
  'Letter Analysis': '/ai/analysis',
  'AI Insights': '/ai/insights',
  Meetings: '/meetings',
  'Import Center': '/operations/import',
  'Export Center': '/operations/export',
  Analytics: '/analytics',
  Reports: '/reports',
  Departments: '/settings/definitions',
  Organizations: '/settings/definitions',
  'Users & Roles': '/settings/users',
  'Master Data': '/settings/definitions',
  'Audit Log': '/admin/audit',
  Notifications: '/notifications',
  Settings: '/settings',
}

const PATH_TO_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(LABEL_TO_HREF).map(([label, href]) => [href, label]),
)

const WORKSPACE_LETTER_PATHS = new Set(['/letters/my-actions', '/letters/monitoring'])

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

export function isLettersSection(pathname: string): boolean {
  if (!pathname.startsWith('/letters')) return false
  if (WORKSPACE_LETTER_PATHS.has(pathname)) return false
  return true
}

export type LettersPrimary = 'Inbox' | 'Sent' | 'Create' | 'Track' | 'Archive'

export function lettersPrimaryFromPathname(pathname: string): LettersPrimary | null {
  if (!isLettersSection(pathname)) return null
  if (pathname === '/letters/inbox') return 'Inbox'
  if (pathname === '/letters/sent') return 'Sent'
  if (pathname.startsWith('/letters/register')) return 'Create'
  if (pathname === '/letters/archive') return 'Archive'
  return 'Track'
}

export function lettersTrackViewFromPathname(pathname: string): LettersTrackView | null {
  if (lettersPrimaryFromPathname(pathname) !== 'Track') return null
  if (pathname === '/letters' || /^\/letters\/\d+$/.test(pathname)) return 'All Letters'
  const label = PATH_TO_LABEL[pathname]
  if (label && (LETTERS_TRACK_VIEWS as readonly string[]).includes(label)) {
    return label as LettersTrackView
  }
  return 'All Letters'
}

export function labelFromPathname(pathname: string): string {
  if (pathname === '/' || pathname === '') return 'Dashboard'
  if (pathname === '/letters/my-actions') return 'My Actions'
  if (pathname === '/letters/monitoring') return 'Monitoring'
  if (pathname === '/letters/inbox') return 'Inbox'
  if (pathname === '/letters/sent') return 'Sent'
  if (pathname.startsWith('/letters/register')) return 'Create'
  if (pathname === '/letters/archive') return 'Archive'
  if (isLettersSection(pathname)) return 'Track'
  if (pathname.startsWith('/meetings/') && pathname !== '/meetings') return 'Meetings'
  if (pathname.startsWith('/ai/analysis')) return 'Letter Analysis'
  if (pathname.startsWith('/settings')) return 'Settings'
  return PATH_TO_LABEL[pathname] ?? 'Dashboard'
}

export function hrefForLabel(label: string): string {
  return LABEL_TO_HREF[label] ?? '/'
}
