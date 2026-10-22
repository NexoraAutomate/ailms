'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

const PREVIEW_LIMIT = 3

/** Split Assigned To into holder names (strips legacy trailing "..."). */
export function parseAssignedToNames(assignedTo: string | null | undefined): string[] {
  const raw = (assignedTo || '').trim()
  if (!raw) return []
  return raw
    .split(',')
    .map((part) => part.trim().replace(/\.\.\.$/, '').trim())
    .filter(Boolean)
}

export function AssignedToDisplay({
  assignedTo,
  className,
}: {
  assignedTo: string | null | undefined
  className?: string
}) {
  const names = parseAssignedToNames(assignedTo)
  if (!names.length) {
    return <span className={cn('text-slate-400', className)}>—</span>
  }

  if (names.length <= PREVIEW_LIMIT) {
    return <span className={className}>{names.join(', ')}</span>
  }

  const preview = names.slice(0, PREVIEW_LIMIT).join(', ')

  return (
    <span className={cn('inline-flex max-w-full flex-wrap items-center gap-0.5', className)}>
      <span className="truncate">{preview}</span>
      <DropdownMenu>
        <DropdownMenuTrigger
          type="button"
          className="inline-flex shrink-0 items-center rounded px-1 py-0.5 text-xs font-semibold text-[#1769aa] hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1769aa]/30"
          aria-label={`Show all ${names.length} assignees`}
          onClick={(e) => e.stopPropagation()}
        >
          …
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="min-w-[12rem] max-w-[16rem] p-2"
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Assigned to ({names.length})
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <ul className="max-h-48 space-y-0.5 overflow-y-auto px-1 py-1">
            {names.map((name) => (
              <li key={name} className="truncate text-xs font-medium text-slate-700">
                {name}
              </li>
            ))}
          </ul>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  )
}
