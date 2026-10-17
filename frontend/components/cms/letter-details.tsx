'use client'

import { useEffect, useState } from 'react'
import {
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  ClipboardList,
  FileText,
  GitBranch,
  Inbox,
  Link2,
  Lock,
  MessageSquare,
  Paperclip,
  Send,
  Sparkles,
} from 'lucide-react'
import { useAppData } from '@/components/app-provider'
import { AIAnalyzeDocument, AIIntelligencePanel } from '@/components/ai/letter-tools'
import { Button } from '@/components/ui/button'
import { AppTabList, AppTabPanel, appTabClass } from '@/components/ui/app-tabs'
import { Badge, Card, PageTitle } from '@/components/cms/ui'
import { ReplyDialog } from '@/components/cms/reply-dialog'
import { CollapsibleCardMotionProvider } from '@/components/ui/collapsible-card'
import { getLetter, priorityTone, statusTone, type Letter } from '@/services/letters'
import { letterRowActions } from '@/services/letter-actions'
import {
  CorrespondenceThreadPanel,
  DocumentsPanel,
  RelatedMeetingsPanel,
} from '@/components/cms/letter-panels'
import { MarkingWorkflowPanel } from '@/components/cms/marking-workflow-panel'

type LetterTabId = 'details' | 'documents' | 'workflow' | 'meetings' | 'references' | 'ai'

const LETTER_TABS: {
  id: LetterTabId
  label: string
  icon: React.ComponentType<{ className?: string }>
}[] = [
  { id: 'details', label: 'Correspondence Details', icon: FileText },
  { id: 'documents', label: 'Documents & Attachments', icon: Paperclip },
  { id: 'workflow', label: 'Workflow', icon: GitBranch },
  { id: 'meetings', label: 'Related Meetings', icon: CalendarDays },
  { id: 'references', label: 'Reference & Linked Letters', icon: Link2 },
  { id: 'ai', label: 'AI Intelligence Panel', icon: Sparkles },
]

export function Details({ id, go }: { id: string; go: (p: string) => void }) {
  const { letters, users, me, refresh, applyLetterField, acceptAiAction } = useAppData()
  const [replyOpen, setReplyOpen] = useState(false)
  const [tab, setTab] = useState<LetterTabId>('details')
  const cached = letters.find((item) => item.id === id) ?? null
  const [letter, setLetter] = useState<Letter | null>(cached)
  const [loading, setLoading] = useState(!cached)
  const [denied, setDenied] = useState(false)

  useEffect(() => {
    setTab('details')
  }, [id])

  useEffect(() => {
    const fromCache = letters.find((item) => item.id === id) ?? null
    if (fromCache) {
      setLetter(fromCache)
      setLoading(false)
      setDenied(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setDenied(false)
    getLetter(id)
      .then((row) => {
        if (!cancelled) {
          setLetter(row)
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        setDenied(/403|access|forbidden/i.test(message))
        setLetter(null)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id, letters])

  if (loading) return <p className="text-sm text-slate-500">Loading letter…</p>
  if (denied) {
    return (
      <Card className="flex flex-col items-start gap-3 p-8">
        <div className="flex items-center gap-2 text-slate-600">
          <Lock className="size-5" />
          <h2 className="text-sm font-bold">Letter locked</h2>
        </div>
        <p className="text-sm text-slate-500">This correspondence is not marked to you, so detail access is restricted.</p>
        <Button variant="outline" onClick={() => go('Catalog')}>Back to Catalog</Button>
      </Card>
    )
  }
  if (!letter) return <p className="text-sm text-slate-500">Letter not found.</p>

  const canReply = letterRowActions(letter, me.role).includes('reply')
  const TypeIcon = letter.type === 'Incoming' ? Inbox : Send
  const PriorityIcon = letter.priority === 'Urgent' ? CircleAlert : letter.priority === 'Important' ? ClipboardList : CheckCircle2
  const StatusIcon =
    letter.status === 'Overdue'
      ? CircleAlert
      : letter.status === 'Closed' || letter.status === 'Completed' || letter.status === 'Archived'
        ? CheckCircle2
        : ClipboardList

  return (
    <>
      <Button variant="outline" size="xs" className="mb-4" onClick={() => go('All Letters')}>← Back to letter database</Button>
      <PageTitle
        title={letter.subject}
        description={
          <>
            <p className="font-medium text-slate-600">{letter.number}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge tone={letter.type === 'Incoming' ? 'blue' : 'violet'}>
                <TypeIcon className="size-3" />
                {letter.type}
              </Badge>
              <Badge tone={priorityTone(letter.priority)}>
                <PriorityIcon className="size-3" />
                {letter.priority}
              </Badge>
              <Badge tone={statusTone(letter.status)}>
                <StatusIcon className="size-3" />
                {letter.status}
              </Badge>
            </div>
          </>
        }
        action={
          canReply ? (
            <Button onClick={() => setReplyOpen(true)}>
              <MessageSquare data-icon="inline-start" />
              Reply
            </Button>
          ) : undefined
        }
      />

      <AppTabList>
        {LETTER_TABS.map(({ id: tabId, label, icon: Icon }) => (
          <button
            key={tabId}
            type="button"
            onClick={() => setTab(tabId)}
            className={appTabClass(tab === tabId)}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </AppTabList>

      <CollapsibleCardMotionProvider animated={false}>
        <AppTabPanel tabKey={tab}>
          {tab === 'details' && (
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
          )}

          {tab === 'documents' && (
            <div>
              <DocumentsPanel letter={letter} />
              <div className="mt-5">
                <AIAnalyzeDocument letter={letter} />
              </div>
            </div>
          )}

          {tab === 'workflow' && <MarkingWorkflowPanel letter={letter} users={users} onDone={refresh} />}

          {tab === 'meetings' && <RelatedMeetingsPanel letter={letter} go={go} />}

          {tab === 'references' && (
            <CorrespondenceThreadPanel letter={letter} go={go} />
          )}

          {tab === 'ai' && (
            <AIIntelligencePanel
              letter={letter}
              letters={letters}
              onApplyField={(field, value, decision) => applyLetterField(letter.id, field, value, decision)}
              onAcceptAction={(next, decision) => acceptAiAction(letter.id, next, decision)}
            />
          )}
        </AppTabPanel>
      </CollapsibleCardMotionProvider>

      {replyOpen && (
        <ReplyDialog
          letter={letter}
          users={users}
          role={me.role}
          onClose={() => setReplyOpen(false)}
          onDone={refresh}
        />
      )}
    </>
  )
}
