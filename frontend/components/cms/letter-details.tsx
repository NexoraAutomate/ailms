'use client'

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

export function Details({ id, go }: { id: string; go: (p: string) => void }) {
  const { letters, users, refresh, addAction, applyLetterField, acceptAiAction } = useAppData()
  const [action, setAction] = useState('')
  const letter = letters.find((item) => item.id === id)
  if (!letter) return <p className="text-sm text-slate-500">Letter not found.</p>
  return (
    <>
      <button onClick={() => go('All Letters')} className="mb-4 text-xs font-semibold text-[#1769aa]">← Back to letter database</button>
      <PageTitle title={letter.subject} description={`${letter.number} · ${letter.type} correspondence`} action={<div className="flex gap-2"><Button variant="outline" onClick={() => go('AI Assistant')}><Sparkles data-icon="inline-start" />AI Assistant</Button><Button variant="outline" onClick={() => go(`analysis:${letter.id}`)}>Letter Analysis</Button></div>} />
      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-bold text-slate-700">Correspondence details</h2>
          <div className="grid grid-cols-2 gap-5">
            {[['Letter number', letter.number], ['Letter date', letter.letterDate], ['Received date', letter.receivedDate], ['Type', letter.type], ['From', letter.from], ['To', letter.to], ['Department', letter.department], ['Assigned to', letter.assignedTo], ['Due date', letter.dueDate], ['Last action', letter.lastAction]].map(([a, b]) => (
              <div key={a}>
                <p className="text-[11px] text-slate-400">{a}</p>
                <p className="mt-1 text-xs font-semibold text-slate-700">{b}</p>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-bold text-slate-700">Tracking status</h2>
          <div className="flex flex-wrap gap-2">
            <Badge tone={letter.type === 'Incoming' ? 'blue' : 'violet'}>{letter.type}</Badge>
            <Badge tone={priorityTone(letter.priority)}>{letter.priority}</Badge>
            <Badge tone={statusTone(letter.status)}>{letter.status}</Badge>
          </div>
          <div className="mt-6 flex flex-col gap-3">
            <input value={action} onChange={(e) => setAction(e.target.value)} placeholder="Describe the next action" className="h-10 rounded-md border border-slate-200 px-3 text-xs" />
            <Button onClick={async () => { if (!action.trim()) return; await addAction(letter.id, action.trim()); setAction('') }}>Add action</Button>
          </div>
        </Card>
      </div>
      <WorkflowPanel letter={letter} users={users} onDone={refresh} />
      <ApprovalEscalationPanel letter={letter} onDone={refresh} />
      <DocumentsPanel letter={letter} />
      <RelatedMeetingsPanel letter={letter} go={go} />
      <CorrespondenceThreadPanel letter={letter} go={go} />
      <div className="mt-5">
        <AIIntelligencePanel letter={letter} letters={letters} onApplyField={(field, value, decision) => applyLetterField(letter.id, field, value, decision)} onAcceptAction={(next, decision) => acceptAiAction(letter.id, next, decision)} />
        <div className="mt-5"><AIAnalyzeDocument letter={letter} /></div>
      </div>
    </>
  )
}
