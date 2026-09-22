/**
 * Split frontend/app/page.tsx into CMS modules.
 * Usage: node frontend/scripts/split-cms.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const frontendRoot = path.resolve(__dirname, '..')
const srcPath = path.join(frontendRoot, 'app', 'page.tsx')
const lines = fs.readFileSync(srcPath, 'utf8').split(/\r?\n/)

function slice(start, endInclusive) {
  return lines.slice(start - 1, endInclusive).join('\n')
}

function exportify(src) {
  return src
    .replace(/^function /gm, 'export function ')
    .replace(/^type /gm, 'export type ')
}

function write(rel, content) {
  const full = path.join(frontendRoot, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content.replace(/\n+$/, '') + '\n', 'utf8')
  console.log('wrote', rel, `(${content.split('\n').length} lines)`)
}

write(
  'lib/cms-nav.ts',
  `/** Map legacy in-app page labels / tokens to App Router paths. */

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
  if (target.startsWith('detail:')) return \`/letters/\${target.slice(7)}\`
  if (target.startsWith('meeting:')) return \`/meetings/\${target.slice(8)}\`
  if (target.startsWith('analysis:')) return \`/ai/analysis/\${target.slice(9)}\`
  if (target.startsWith('Settings:')) {
    const tab = target.slice(9) || 'users'
    return \`/settings/\${tab}\`
  }
  if (LABEL_TO_HREF[target]) return LABEL_TO_HREF[target]
  if (/^\\d+$/.test(target)) return \`/letters/\${target}\`
  return '/'
}

export function labelFromPathname(pathname: string): string {
  if (pathname === '/' || pathname === '') return 'Dashboard'
  if (/^\\/letters\\/\\d+$/.test(pathname)) return 'All Letters'
  if (pathname.startsWith('/meetings/') && pathname !== '/meetings') return 'Meetings'
  if (pathname.startsWith('/ai/analysis')) return 'Letter Analysis'
  if (pathname.startsWith('/settings')) return 'Settings'
  return PATH_TO_LABEL[pathname] ?? 'Dashboard'
}

export function hrefForLabel(label: string): string {
  return LABEL_TO_HREF[label] ?? '/'
}
`,
)

write(
  'hooks/use-go.ts',
  `'use client'

import { useRouter } from 'next/navigation'
import { useCallback } from 'react'
import { resolveNavHref } from '@/lib/cms-nav'

/** Drop-in replacement for the monolith Workspace go() helper. */
export function useGo() {
  const router = useRouter()
  return useCallback(
    (target: string) => {
      router.push(resolveNavHref(target))
    },
    [router],
  )
}
`,
)

write(
  'components/cms/ui.tsx',
  `'use client'

import { BriefcaseBusiness, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

const toneClasses: Record<string, string> = {
  slate: 'bg-slate-100 text-slate-700',
  amber: 'bg-amber-100 text-amber-800',
  blue: 'bg-blue-100 text-blue-800',
  indigo: 'bg-indigo-100 text-indigo-800',
  violet: 'bg-violet-100 text-violet-800',
  green: 'bg-emerald-100 text-emerald-800',
  red: 'bg-red-100 text-red-800',
}

${exportify(slice(114, 145))}

${exportify(slice(308, 321))}

${exportify(slice(486, 501))}
`,
)

write(
  'components/cms/letter-table.tsx',
  `'use client'

import { MoreHorizontal, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, Card } from '@/components/cms/ui'
import { priorityTone, statusTone, type Letter } from '@/services/letters'

${exportify(slice(323, 395))}
`,
)

write(
  'components/cms/dashboard.tsx',
  `'use client'

import { Activity, CircleAlert, ChevronRight, Inbox, Plus, Sparkles } from 'lucide-react'
import { metricValue, useAppData } from '@/components/app-provider'
import { AIManagementInsights } from '@/components/ai/pages'
import { Button } from '@/components/ui/button'
import { Card, Kpi, PageTitle } from '@/components/cms/ui'

${exportify(slice(397, 484))}
`,
)

write(
  'components/cms/analytics.tsx',
  `'use client'

import { BarChart3 } from 'lucide-react'
import { metricValue, useAppData } from '@/components/app-provider'
import { Badge, Card, Filters, Kpi, PageTitle } from '@/components/cms/ui'

${exportify(slice(503, 574))}
`,
)

write(
  'components/cms/reports.tsx',
  `'use client'

import { useMemo, useState } from 'react'
import { Download, Printer } from 'lucide-react'
import { useAppData } from '@/components/app-provider'
import { Button } from '@/components/ui/button'
import { Badge, Card, Filters, PageTitle } from '@/components/cms/ui'
import { priorityTone, statusTone } from '@/services/letters'

${exportify(slice(576, 652))}
`,
)

write(
  'components/cms/management-table.tsx',
  `'use client'

import { useState } from 'react'
import { MoreHorizontal, Plus, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, Card, PageTitle } from '@/components/cms/ui'

${exportify(slice(654, 729))}
`,
)

write(
  'components/cms/notifications-page.tsx',
  `'use client'

import { useEffect, useState } from 'react'
import { Bell, Check } from 'lucide-react'
import { useAppData } from '@/components/app-provider'
import { Button } from '@/components/ui/button'
import { Badge, Card, PageTitle } from '@/components/cms/ui'

${exportify(slice(731, 817))}
`,
)

write(
  'components/cms/audit-page.tsx',
  `'use client'

import { useAppData } from '@/components/app-provider'
import { Badge, Card, Filters, PageTitle } from '@/components/cms/ui'

${exportify(slice(819, 850))}
`,
)

write(
  'components/cms/master-data-page.tsx',
  `'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useAppData } from '@/components/app-provider'
import { Button } from '@/components/ui/button'
import { Badge, Card, PageTitle } from '@/components/cms/ui'
import { FormDialog } from '@/components/cms/management-table'

${exportify(slice(852, 886))}
`,
)

write(
  'components/cms/letter-panels.tsx',
  `'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useAppData } from '@/components/app-provider'
import { Button } from '@/components/ui/button'
import { Badge, Card } from '@/components/cms/ui'
import { formatDateTime } from '@/lib/datetime'
import { statusTone, type Letter, type LetterStatus } from '@/services/letters'
import {
  executeWorkflow,
  fetchWorkflowActions,
  fetchWorkflowHistory,
  workflowActionLabel,
  type WorkflowTransition,
} from '@/services/workflow'
import { getCurrentApproval, listApprovals, type Approval } from '@/services/approvals'
import { listEscalations, resolveEscalation, type Escalation } from '@/services/escalations'
import {
  documentDownloadUrl,
  documentPreviewUrl,
  formatFileSize,
  listDocumentVersions,
  listLetterDocuments,
  uploadDocumentVersion,
  uploadLetterDocument,
  type DocumentVersion,
  type LetterDocument,
} from '@/services/documents'
import { createRelation, fetchCorrespondenceThread, listRelationTypes, type CorrespondenceThread } from '@/services/correspondence'
import { listMeetings, type Meeting } from '@/services/meetings'

${exportify(slice(888, 1226))}

${exportify(slice(1371, 1525))}
`,
)

write(
  'components/cms/letter-details.tsx',
  `'use client'

import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useAppData } from '@/components/app-provider'
import { AIAnalyzeDocument, AIIntelligencePanel } from '@/components/ai/letter-tools'
import { Button } from '@/components/ui/button'
import { Badge, Card, PageTitle } from '@/components/cms/ui'
import { priorityTone, statusTone } from '@/services/letters'
import {
  ApprovalEscalationPanel,
  CorrespondenceThreadPanel,
  DocumentsPanel,
  RelatedMeetingsPanel,
  WorkflowPanel,
} from '@/components/cms/letter-panels'

${exportify(slice(1527, 1572))}
`,
)

write(
  'components/cms/import-export.tsx',
  `'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, PageTitle } from '@/components/cms/ui'
import {
  confirmLetterImport,
  downloadExport,
  validateLetterImport,
  type ImportJobResult,
} from '@/services/data-operations'

${exportify(slice(1574, 1673))}
`,
)

write(
  'components/cms/letter-database.tsx',
  `'use client'

import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { useAppData } from '@/components/app-provider'
import { AISearchBanner } from '@/components/ai/pages'
import { Button } from '@/components/ui/button'
import { Card, PageTitle } from '@/components/cms/ui'
import { LetterTable } from '@/components/cms/letter-table'
import type { InterpretedQuery } from '@/services/ai'
import type { Letter } from '@/services/letters'
import { archiveLetters, restoreLetters, runBulkOperation } from '@/services/data-operations'

${exportify(slice(1675, 1806))}
`,
)

write(
  'components/cms/register-letter.tsx',
  `'use client'

import { useEffect, useState } from 'react'
import { useAppData } from '@/components/app-provider'
import { Button } from '@/components/ui/button'
import { Card, PageTitle } from '@/components/cms/ui'
import { createRelation, listRelationTypes } from '@/services/correspondence'
import { uploadLetterDocument } from '@/services/documents'
import type { Letter, LetterStatus } from '@/services/letters'

${exportify(slice(1808, 2024))}
`,
)

write(
  'components/cms/meetings-pages.tsx',
  `'use client'

import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { useAppData } from '@/components/app-provider'
import { Button } from '@/components/ui/button'
import { Badge, Card, PageTitle } from '@/components/cms/ui'
import { FormDialog } from '@/components/cms/management-table'
import type { Letter } from '@/services/letters'
import {
  addMeetingAction,
  createMeeting,
  getMeeting,
  linkMeetingLetter,
  listMeetings,
  updateMeetingAction,
  type Meeting,
} from '@/services/meetings'

${exportify(slice(1228, 1369))}
`,
)

console.log('component split complete')
