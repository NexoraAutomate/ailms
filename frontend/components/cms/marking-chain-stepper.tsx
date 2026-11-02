'use client'

import { Fragment } from 'react'
import { cn } from '@/lib/utils'
import { formatDateTime } from '@/lib/datetime'
import { UserAvatar } from '@/components/ui/user-avatar'
import type { MarkingNode } from '@/services/markings'

export type MarkingChainUser = {
  name: string
  avatarUrl?: string
  department?: string
}

export type MarkingChainStep = {
  id: string
  name: string
  /** When this person received the mark (undefined for the chain originator). */
  markedAt?: string
  department?: string
  avatarUrl?: string
}

type MarkingChainStepperProps = {
  steps: MarkingChainStep[]
  /** Zero-based index of the current holder (usually the last step). */
  currentStep: number
  /** Hidden earlier people collapsed into the faded lead-in. */
  priorCount?: number
  /** Logged-in user — when matching the current step, label shows "You". */
  viewerName?: string
  className?: string
}

const MS_HOUR = 1000 * 60 * 60
const MS_DAY = MS_HOUR * 24

function sameName(a?: string | null, b?: string | null) {
  return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase() && !!(a || '').trim()
}

function parseTs(value?: string | null): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/** Whole days between two ISO timestamps (0 on the same calendar span). */
export function markingDelayDays(from?: string | null, to?: string | null): number | null {
  const parts = markingDelayParts(from, to)
  return parts ? parts.days : null
}

/** Days + remaining hours between two ISO timestamps. */
export function markingDelayParts(
  from?: string | null,
  to?: string | null,
): { days: number; hours: number } | null {
  const a = parseTs(from)
  const b = parseTs(to)
  if (a == null || b == null || b < a) return null
  const ms = b - a
  const days = Math.floor(ms / MS_DAY)
  const hours = Math.floor((ms % MS_DAY) / MS_HOUR)
  return { days, hours }
}

function formatDelayParts(parts: { days: number; hours: number } | null): string | undefined {
  if (!parts) return undefined
  const { days, hours } = parts
  if (days <= 0 && hours <= 0) return '0h'
  if (days <= 0) return `${hours}h`
  if (hours <= 0) return `${days}d`
  return `${days}d ${hours}h`
}

function PriorUsersLead({ priorCount }: { priorCount: number }) {
  return (
    <li
      className="relative flex w-12 shrink-0 flex-col items-center text-center sm:w-16"
      aria-label={`${priorCount} earlier user${priorCount === 1 ? '' : 's'} in this chain`}
      title={`${priorCount} earlier user${priorCount === 1 ? '' : 's'} in this chain`}
    >
      <div
        className="pointer-events-none absolute top-[22px] right-0 z-0 flex h-0 w-[150%] items-center sm:top-6"
        aria-hidden
      >
        <div className="h-px w-full bg-gradient-to-r from-transparent via-slate-200/70 to-slate-300" />
      </div>
      <div className="relative z-1 flex items-center gap-1 opacity-40">
        <span className="size-2 rounded-full bg-slate-300 sm:size-2.5" />
        <span className="size-2.5 rounded-full bg-slate-300/80 sm:size-3" />
        <span className="size-3 rounded-full border border-dashed border-slate-300 bg-slate-100 sm:size-3.5" />
      </div>
      <p className="mt-2.5 max-w-[3.75rem] text-[9px] font-medium leading-tight text-slate-400 sm:max-w-[4.25rem]">
        +{priorCount} {priorCount === 1 ? 'user' : 'users'}
      </p>
    </li>
  )
}

/**
 * Compact linear chain: up to two previous holders + current holder.
 * Connector: datetime above the line, delay in days + hours below.
 */
export function MarkingChainStepper({
  steps,
  currentStep,
  priorCount = 0,
  viewerName,
  className,
}: MarkingChainStepperProps) {
  const safeIndex = Math.max(0, Math.min(currentStep, Math.max(steps.length - 1, 0)))
  const showPriorLead = priorCount > 0
  const viewer = (viewerName || '').trim()

  if (!steps.length) return null

  return (
    <div className={cn('w-full', className)}>
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        Marked to you via
      </p>
      <div className="-mx-1 overflow-x-auto px-1 sm:mx-0 sm:overflow-visible sm:px-0">
        <ol className="mx-auto flex w-full min-w-[min(100%,22rem)] max-w-3xl items-start justify-between gap-0 px-1 pt-5 sm:min-w-0 sm:px-2">
          {showPriorLead ? <PriorUsersLead priorCount={priorCount} /> : null}
          {steps.map((step, index) => {
            const done = index < safeIndex
            const current = index === safeIndex
            const isYou = Boolean(viewer && sameName(step.name, viewer))
            const label = isYou ? 'You' : step.name
            const next = steps[index + 1]
            const hopMarkedAt = next?.markedAt
            const delayLabel = next
              ? formatDelayParts(markingDelayParts(step.markedAt, next.markedAt))
              : undefined

            return (
              <Fragment key={step.id}>
                <li className="relative flex min-w-0 flex-1 flex-col items-center text-center">
                  {index === 0 && showPriorLead ? (
                    <div
                      className="pointer-events-none absolute top-[22px] right-1/2 z-0 h-0 w-1/2 sm:top-6"
                      aria-hidden
                    >
                      <div className="h-px w-full bg-gradient-to-r from-slate-300/70 to-[#1769aa]/45" />
                    </div>
                  ) : null}

                  {index < steps.length - 1 ? (
                    <div
                      className="pointer-events-none absolute top-[22px] left-1/2 z-0 h-0 w-full sm:top-6"
                      aria-hidden
                    >
                      <div
                        className={cn(
                          'absolute inset-x-0 top-0 h-px',
                          done || current ? 'bg-[#1769aa]' : 'bg-slate-200',
                        )}
                      />
                      {hopMarkedAt ? (
                        <span
                          className="absolute left-1/2 bottom-1 z-1 -translate-x-1/2 whitespace-nowrap text-[9px] font-medium tabular-nums text-slate-500"
                          title={`Marked ${formatDateTime(hopMarkedAt)}`}
                        >
                          {formatDateTime(hopMarkedAt)}
                        </span>
                      ) : null}
                      {delayLabel ? (
                        <span
                          className="absolute left-1/2 top-8 z-1 -translate-x-1/2 rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-slate-600 shadow-sm sm:top-9"
                          title={`${delayLabel} between markings`}
                        >
                          {delayLabel}
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="relative z-1 flex size-11 items-center justify-center sm:size-12">
                    {current ? (
                      <>
                        <span className="absolute inset-0 animate-ping rounded-full bg-[#1769aa]/30" />
                        <span className="absolute -inset-1 animate-pulse rounded-full ring-2 ring-[#1769aa]/40" />
                      </>
                    ) : null}
                    <div
                      className={cn(
                        'relative size-11 overflow-hidden rounded-full border bg-white sm:size-12',
                        current && 'border-[#1769aa] shadow-[0_0_0_2px_rgba(23,105,170,0.18)]',
                        done && !current && 'border-[#1769aa]',
                        !done && !current && 'border-slate-200 opacity-60 grayscale',
                      )}
                    >
                      <UserAvatar
                        name={step.name}
                        avatarUrl={step.avatarUrl}
                        size="xl"
                        ring={false}
                        className="size-full rounded-none text-sm"
                        imgClassName="size-full rounded-none ring-0"
                      />
                    </div>
                  </div>

                  <div className="mt-5 min-w-0 w-full max-w-[7rem] px-1 sm:mt-6 sm:max-w-[8.5rem]">
                    <p
                      className={cn(
                        'truncate text-[11px] font-semibold',
                        current ? 'text-[#0d3763]' : done ? 'text-slate-700' : 'text-slate-400',
                      )}
                      title={step.name}
                    >
                      {label}
                    </p>
                    {step.department ? (
                      <p
                        className={cn(
                          'mt-0.5 truncate text-[10px]',
                          current || done ? 'text-slate-500' : 'text-slate-400',
                        )}
                        title={step.department}
                      >
                        {step.department}
                      </p>
                    ) : null}
                  </div>
                </li>
              </Fragment>
            )
          })}
        </ol>
      </div>
    </div>
  )
}

const VISIBLE_PREVIOUS = 2

/**
 * Build a truncated person chain ending at the viewer's active hold.
 * Visible window = previous two holders + the viewer; older people → priorCount.
 */
export function buildMarkingChainToViewer({
  hold,
  allMarkings,
  users,
  viewerName,
  originMarkedAt,
}: {
  hold: MarkingNode
  allMarkings: MarkingNode[]
  users: MarkingChainUser[]
  viewerName: string
  /** Fallback timestamp for the chain originator (e.g. letter received/created). */
  originMarkedAt?: string
}): { steps: MarkingChainStep[]; currentStep: number; priorCount: number } | null {
  const me = (viewerName || '').trim()
  if (!me || !sameName(hold.toUser, me)) return null

  const byId = new Map(allMarkings.map((m) => [m.id, m]))
  const ancestry: MarkingNode[] = []
  const seen = new Set<number>()
  let cur: MarkingNode | undefined = hold
  while (cur && !seen.has(cur.id)) {
    if (cur.status === 'revoked') break
    seen.add(cur.id)
    ancestry.unshift(cur)
    if (cur.parentMarkingId == null) break
    cur = byId.get(cur.parentMarkingId)
  }
  if (!ancestry.length) return null

  const byName = new Map(users.map((u) => [u.name.trim().toLowerCase(), u]))
  const resolve = (name: string) => {
    const key = name.trim().toLowerCase()
    return (
      byName.get(key) ||
      [...byName.entries()].find(([n]) => n === key)?.[1]
    )
  }

  const people: MarkingChainStep[] = []
  const pushPerson = (name: string, markedAt?: string, id?: string) => {
    const trimmed = (name || '').trim()
    if (!trimmed) return
    const last = people[people.length - 1]
    if (last && sameName(last.name, trimmed)) {
      if (markedAt && !last.markedAt) last.markedAt = markedAt
      return
    }
    const profile = resolve(trimmed)
    people.push({
      id: id || `user-${people.length}-${trimmed.toLowerCase()}`,
      name: trimmed,
      markedAt,
      department: profile?.department,
      avatarUrl: profile?.avatarUrl || '',
    })
  }

  const root = ancestry[0]!
  pushPerson(root.fromUser, originMarkedAt || undefined, `from-${root.id}`)
  for (const m of ancestry) {
    pushPerson(m.toUser, m.createdAt || undefined, `mark-${m.id}`)
  }

  if (people.length < 2) return null

  const visibleWindow = VISIBLE_PREVIOUS + 1
  const priorCount = Math.max(0, people.length - visibleWindow)
  const visible = people.slice(-visibleWindow)
  const currentStep = visible.length - 1

  return { steps: visible, currentStep, priorCount }
}

/** Prefer RR hold, else newest active inbound leaf for the viewer. */
export function pickViewerHold(holds: MarkingNode[], viewerName: string): MarkingNode | null {
  const me = (viewerName || '').trim()
  if (!me) return null
  const mine = holds.filter(
    (m) => m.status === 'active' && sameName(m.toUser, me),
  )
  if (!mine.length) return null
  const rr = mine.find((m) => m.action === 'response_required')
  if (rr) return rr
  return mine.reduce((best, row) => (row.id > best.id ? row : best), mine[0]!)
}
