'use client'

import { Badge } from '@/components/cms/ui'
import { markingActionLabel, type MarkingNode } from '@/services/markings'

type HoldUser = { name: string; avatarUrl?: string; department?: string }

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

function sameHolder(a?: string | null, b?: string | null) {
  return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase() && !!(a || '').trim()
}

function HoldChip({
  title,
  subtitle,
  actionLabel,
  avatarUrl,
  initials,
}: {
  title: string
  subtitle?: string
  actionLabel?: string
  avatarUrl?: string
  initials: string
}) {
  return (
    <div className="flex min-w-[140px] max-w-[220px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 shadow-sm">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-xs font-bold text-slate-600">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          initials || '?'
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-slate-800">{title}</p>
        {subtitle ? <p className="truncate text-[10px] text-slate-500">{subtitle}</p> : null}
        <div className="mt-0.5 flex flex-wrap gap-1">
          {actionLabel ? <Badge tone="blue">{actionLabel}</Badge> : null}
        </div>
      </div>
    </div>
  )
}

/** One chip per distinct holder (toUser) — multiple inbound marks collapse. */
function uniqueHolders(leaves: MarkingNode[]): {
  toUser: string
  fromUsers: string[]
  action: string
  department?: string
}[] {
  const order: string[] = []
  const map = new Map<
    string,
    { toUser: string; fromUsers: string[]; action: string; latestId: number }
  >()

  const sorted = [...leaves].sort((a, b) => a.id - b.id)
  for (const m of sorted) {
    const name = (m.toUser || '').trim() || 'Unknown'
    const key = name.toLowerCase()
    const from = (m.fromUser || '').trim()
    const existing = map.get(key)
    if (!existing) {
      order.push(key)
      map.set(key, {
        toUser: name,
        fromUsers: from ? [from] : [],
        action: m.action,
        latestId: m.id,
      })
      continue
    }
    if (from && !existing.fromUsers.some((f) => sameHolder(f, from))) {
      existing.fromUsers.push(from)
    }
    // Prefer the newest marking's action label when collapsing.
    if (m.id >= existing.latestId) {
      existing.action = m.action
      existing.latestId = m.id
      existing.toUser = name
    }
  }

  return order.map((key) => {
    const row = map.get(key)!
    return {
      toUser: row.toUser,
      fromUsers: row.fromUsers,
      action: row.action,
    }
  })
}

export function MarkingActiveHolds({
  activeLeaves,
  initiatorHold,
  initiatorName,
  users,
}: {
  activeLeaves: MarkingNode[]
  initiatorHold: boolean
  initiatorName: string
  users: HoldUser[]
}) {
  const byName = new Map(users.map((u) => [u.name, u]))

  if (initiatorHold || activeLeaves.length === 0) {
    const name = (initiatorName || '').trim() || 'Initiator'
    const profile = byName.get(name)
    return (
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Active holders</p>
        <div className="flex flex-wrap gap-2">
          <HoldChip
            title={name}
            subtitle={profile?.department || 'Registrant'}
            actionLabel="Holds"
            avatarUrl={profile?.avatarUrl}
            initials={initialsOf(name)}
          />
        </div>
      </div>
    )
  }

  const holders = uniqueHolders(activeLeaves)

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Active holders</p>
      <div className="flex flex-wrap gap-2">
        {holders.map((h) => {
          const profile =
            byName.get(h.toUser) ||
            [...byName.entries()].find(([n]) => sameHolder(n, h.toUser))?.[1]
          const fromLabel =
            h.fromUsers.length === 0
              ? undefined
              : h.fromUsers.length === 1
                ? `from ${h.fromUsers[0]}`
                : `from ${h.fromUsers.join(', ')}`
          return (
            <HoldChip
              key={h.toUser.toLowerCase()}
              title={h.toUser}
              subtitle={profile?.department || fromLabel}
              actionLabel={markingActionLabel(h.action)}
              avatarUrl={profile?.avatarUrl}
              initials={initialsOf(h.toUser)}
            />
          )
        })}
      </div>
    </div>
  )
}
