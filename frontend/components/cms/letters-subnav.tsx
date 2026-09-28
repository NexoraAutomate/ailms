'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BriefcaseBusiness,
  CheckCircle2,
  CircleAlert,
  ClipboardList,
  Inbox,
  Send,
  Table2,
} from 'lucide-react'
import {
  hrefForLabel,
  LETTERS_TRACK_VIEWS,
  lettersTrackViewFromPathname,
} from '@/lib/cms-nav'

const TRACK_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'All Letters': Table2,
  Incoming: Inbox,
  Outgoing: Send,
  Pending: ClipboardList,
  Overdue: CircleAlert,
  Closed: CheckCircle2,
  Archived: BriefcaseBusiness,
}

/** Secondary letter filters under the header when Track is active. */
export function LettersSubnav() {
  const pathname = usePathname()
  const trackView = lettersTrackViewFromPathname(pathname)
  if (!trackView) return null

  return (
    <div className="shrink-0 border-b border-slate-200 bg-white">
      <nav
        aria-label="Letter views"
        className="mx-auto flex w-full max-w-[1600px] gap-1 overflow-x-auto px-4 py-2 sm:px-7"
      >
        {LETTERS_TRACK_VIEWS.map((label) => {
          const Icon = TRACK_ICONS[label] ?? Table2
          const href = hrefForLabel(label)
          const active = trackView === label
          return (
            <Link
              key={label}
              href={href}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                active
                  ? 'bg-blue-50 font-semibold text-[#0d3763]'
                  : 'font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-700'
              }`}
            >
              <Icon className="size-3.5" />
              {label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
