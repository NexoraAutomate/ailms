'use client'

import { Badge } from '@/components/cms/ui'
import { markingActionLabel, groupMarkingsByBatch, type MarkingNode } from '@/services/markings'

type HoldUser = { name: string; avatarUrl?: string; department?: string }

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
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
    <div className="flex min-w-[140px] max-w-[200px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 shadow-sm">
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
        {actionLabel ? (
          <span className="mt-0.5 inline-block">
            <Badge tone="blue">{actionLabel}</Badge>
          </span>
        ) : null}
      </div>
    </div>
  )
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
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Active holders</p>
          <p className="text-[10px] text-slate-400">List “Assigned to” lists current holders</p>
        </div>
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

  const groups = groupMarkingsByBatch(activeLeaves)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Active holders</p>
        <p className="text-[10px] text-slate-400">
          {activeLeaves.length} parallel hold{activeLeaves.length === 1 ? '' : 's'}
          {activeLeaves.length > 3 ? ' · list shows first 3…' : ''}
        </p>
      </div>
      {groups.map(({ batchId, markings }) => (
        <div key={batchId} className="space-y-1.5">
          {groups.length > 1 || markings.length > 1 ? (
            <p className="text-[10px] font-medium text-slate-400">Batch #{batchId}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {markings.map((m) => {
              const profile = byName.get(m.toUser)
              return (
                <HoldChip
                  key={m.id}
                  title={m.toUser}
                  subtitle={profile?.department || `from ${m.fromUser}`}
                  actionLabel={markingActionLabel(m.action)}
                  avatarUrl={profile?.avatarUrl}
                  initials={initialsOf(m.toUser)}
                />
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
