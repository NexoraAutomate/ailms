'use client'

import { useEffect, useState } from 'react'
import { Bell, Check } from 'lucide-react'
import { useAppData } from '@/components/app-provider'
import { Button } from '@/components/ui/button'
import { Badge, Card, PageTitle } from '@/components/cms/ui'

export function Notifications({ go }: { go: (p: string) => void }) {
  const { readNotification, readAllNotifications, refresh } = useAppData()
  const [view, setView] = useState<'all' | 'unread'>('all')
  const [typeFilter, setTypeFilter] = useState('All')
  const [types, setTypes] = useState<string[]>([])
  const [items, setItems] = useState<import('@/services/management').AppNotification[]>([])
  const [summary, setSummary] = useState<{ unread: number }>({ unread: 0 })
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const { fetchNotificationSummary, fetchNotificationTypes, fetchNotifications } = await import('@/services/notifications')
      const [typeList, rows, stats] = await Promise.all([
        fetchNotificationTypes(),
        fetchNotifications({
          unread: view === 'unread',
          notificationType: typeFilter === 'All' ? undefined : typeFilter,
        }),
        fetchNotificationSummary(),
      ])
      setTypes(typeList.types)
      setItems(rows)
      setSummary(stats)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [view, typeFilter])

  const openTarget = async (n: import('@/services/management').AppNotification) => {
    const { openNotificationTarget } = await import('@/services/notifications')
    if (!n.read) {
      await readNotification(n.id)
      await refresh()
    }
    openNotificationTarget(go, n)
    await load()
  }

  return (
    <>
      <PageTitle
        title="Notifications"
        description={`Stay informed about assignments, deadlines and correspondence updates.${summary.unread ? ` ${summary.unread} unread.` : ''}`}
        action={<Button variant="outline" onClick={async () => { await readAllNotifications(); await refresh(); await load() }}><Check data-icon="inline-start" />Mark all as read</Button>}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Button size="sm" variant={view === 'all' ? 'default' : 'outline'} onClick={() => setView('all')}>All notifications</Button>
        <Button size="sm" variant={view === 'unread' ? 'default' : 'outline'} onClick={() => setView('unread')}>Unread only</Button>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-xs">
          <option>All</option>
          {types.map((t) => <option key={t}>{t}</option>)}
        </select>
      </div>
      <Card>
        {loading && <div className="p-8 text-center text-sm text-slate-500">Loading notifications…</div>}
        {!loading && items.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">You&apos;re all caught up.</div> : items.map((n) => (
          <div className={`flex gap-4 border-b border-slate-100 p-5 last:border-0 ${!n.read ? 'bg-blue-50/40' : ''}`} key={n.id}>
            <div className={`mt-1 flex size-8 shrink-0 items-center justify-center rounded-full ${n.priority === 'Critical' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-[#1769aa]'}`}><Bell className="size-4" /></div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-bold text-slate-700">{n.title}</h2>
                {n.notificationType && <Badge tone="indigo">{n.notificationType}</Badge>}
                <Badge tone={n.priority === 'Critical' ? 'red' : n.priority === 'High' ? 'amber' : 'slate'}>{n.priority}</Badge>
                {!n.read && <Badge tone="blue">Unread</Badge>}
              </div>
              <p className="mt-1 text-xs text-slate-500">{n.description}</p>
              <p className="mt-2 text-[11px] text-slate-400">{n.time}{n.recipientName ? ` · For ${n.recipientName}` : ''}</p>
            </div>
            <div className="flex gap-2">
              {(n.navigateTo || n.letter) && (
                <Button size="sm" variant="outline" onClick={() => void openTarget(n)}>
                  {n.navigateLabel || 'Open record'}
                </Button>
              )}
              {!n.read && <Button size="sm" variant="ghost" onClick={async () => { await readNotification(n.id); await refresh(); await load() }}>Mark read</Button>}
            </div>
          </div>
        ))}
      </Card>
    </>
  )
}
