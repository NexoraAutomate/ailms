'use client'

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

export function MeetingsPage({ go }: { go: (p: string) => void }) {
  const { users } = useAppData()
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ title: '', date: '', location: '', chairperson: users[0]?.name ?? '', agenda: '' })

  const load = () => listMeetings().then(setMeetings).finally(() => setLoading(false))
  useEffect(() => { void load() }, [])

  return (
    <>
      <PageTitle title="Meetings" description="Schedule meetings, link correspondence, and track meeting actions." action={<Button onClick={() => setOpen(true)}><Plus data-icon="inline-start" />New meeting</Button>} />
      {loading && <p className="text-sm text-slate-500">Loading meetings…</p>}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-400">
              <tr>{['Title', 'Date', 'Time', 'Location', 'Status', 'Actions'].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}</tr>
            </thead>
            <tbody>
              {meetings.map((m) => (
                <tr key={m.id} className="border-t border-slate-100 text-xs">
                  <td className="px-4 py-3 font-semibold text-[#1769aa]"><button onClick={() => go(`meeting:${m.id}`)}>{m.title}</button></td>
                  <td className="px-4 py-3">{m.date}</td>
                  <td className="px-4 py-3">{m.startTime}–{m.endTime}</td>
                  <td className="px-4 py-3">{m.location || '—'}</td>
                  <td className="px-4 py-3"><Badge tone="blue">{m.status}</Badge></td>
                  <td className="px-4 py-3">{m.actions.length} action(s)</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {open && (
        <FormDialog
          title="Create meeting"
          fields={[
            { name: 'title', label: 'Title', required: true },
            { name: 'date', label: 'Date (YYYY-MM-DD)', required: true },
            { name: 'location', label: 'Location' },
            { name: 'chairperson', label: 'Chairperson' },
            { name: 'agenda', label: 'Agenda' },
          ]}
          onClose={() => setOpen(false)}
          onSubmit={async (values) => {
            await createMeeting({
              title: values.title,
              date: values.date,
              location: values.location,
              chairperson: values.chairperson || form.chairperson,
              agenda: values.agenda,
              participants: values.chairperson ? [{ name: values.chairperson }] : [],
            })
            setOpen(false)
            await load()
          }}
        />
      )}
    </>
  )
}

export function MeetingDetailPage({ id, go, letters }: { id: string; go: (p: string) => void; letters: Letter[] }) {
  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [linkLetterId, setLinkLetterId] = useState('')
  const [actionText, setActionText] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      setMeeting(await getMeeting(id))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [id])

  if (loading) return <p className="text-sm text-slate-500">Loading meeting…</p>
  if (!meeting) return <p className="text-sm text-slate-500">Meeting not found.</p>

  return (
    <>
      <button type="button" onClick={() => go('Meetings')} className="mb-4 text-xs font-semibold text-[#1769aa]">← Back to meetings</button>
      <PageTitle title={meeting.title} description={`${meeting.date} · ${meeting.startTime}–${meeting.endTime} · ${meeting.location || 'No location'}`} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5 text-xs">
          <p className="mb-2"><span className="text-slate-400">Chairperson:</span> {meeting.chairperson || '—'}</p>
          <p className="mb-2"><span className="text-slate-400">Agenda:</span> {meeting.agenda || '—'}</p>
          <p><span className="text-slate-400">Participants:</span> {meeting.participants.map((p) => p.name).join(', ') || '—'}</p>
        </Card>
        <Card className="p-5 text-xs">
          <h3 className="mb-2 font-bold text-slate-700">Linked letters</h3>
          {meeting.letterIds.length === 0 && <p className="text-slate-500">No letters linked.</p>}
          {meeting.letterIds.map((lid) => {
            const letter = letters.find((l) => l.id === lid)
            return (
              <button key={lid} type="button" className="mb-1 block text-[#1769aa]" onClick={() => go(lid)}>
                {letter?.number ?? lid} · {letter?.subject ?? ''}
              </button>
            )
          })}
          <div className="mt-3 flex gap-2">
            <select value={linkLetterId} onChange={(e) => setLinkLetterId(e.target.value)} className="h-9 flex-1 rounded-md border border-slate-200 px-2">
              <option value="">Link letter…</option>
              {letters.map((l) => <option key={l.id} value={l.id}>{l.number}</option>)}
            </select>
            <Button size="sm" onClick={async () => { if (!linkLetterId) return; await linkMeetingLetter(id, linkLetterId); setLinkLetterId(''); await load() }}>Link</Button>
          </div>
        </Card>
      </div>
      <Card className="mt-5 p-5">
        <h3 className="mb-3 text-sm font-bold text-slate-700">Meeting actions</h3>
        <div className="mb-3 flex gap-2">
          <input value={actionText} onChange={(e) => setActionText(e.target.value)} placeholder="Action description" className="h-10 flex-1 rounded-md border border-slate-200 px-3 text-xs" />
          <Button size="sm" onClick={async () => {
            if (!actionText.trim()) return
            await addMeetingAction(id, { actionDescription: actionText.trim(), status: 'Open' })
            setActionText('')
            await load()
          }}>Add action</Button>
        </div>
        {meeting.actions.map((action) => (
          <div key={action.id} className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
            <div>
              <p className="font-semibold">{action.actionDescription}</p>
              <p className="text-slate-500">{action.status} · {action.dueDate || 'No due date'}</p>
            </div>
            {action.status !== 'Completed' && (
              <Button size="sm" variant="outline" onClick={async () => { await updateMeetingAction(action.id, { status: 'Completed' }); await load() }}>Complete</Button>
            )}
          </div>
        ))}
      </Card>
    </>
  )
}
