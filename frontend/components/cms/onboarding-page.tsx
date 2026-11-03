'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  CornerUpLeft,
  FilePlus2,
  GraduationCap,
  Hand,
  Inbox,
  Lightbulb,
  Play,
  RotateCcw,
  Send,
  Sparkles,
  Tags,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, Card, PageTitle } from '@/components/cms/ui'
import { useGo } from '@/hooks/use-go'
import {
  MARK_TYPES,
  ONBOARDING_ACTORS,
  ONBOARDING_CHAPTERS,
  PRACTICE_STEPS,
  WORKFLOW_PIPELINE,
  defaultOnboardingProgress,
  getActorColor,
  loadOnboardingProgress,
  saveOnboardingProgress,
  type OnboardingChapterId,
  type OnboardingProgress,
  type PracticeAction,
} from '@/lib/onboarding'

const CHAPTER_ICONS: Record<OnboardingChapterId, React.ComponentType<{ className?: string }>> = {
  welcome: BookOpen,
  register: FilePlus2,
  mark: Tags,
  work: Hand,
  'track-close': CheckCircle2,
  workspace: Inbox,
  ai: Sparkles,
  practice: GraduationCap,
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <motion.div
        className="h-full rounded-full bg-[#1769aa]"
        initial={false}
        animate={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        transition={{ duration: 0.35 }}
      />
    </div>
  )
}

function ActorName({ name }: { name: string }) {
  const color = getActorColor(name)
  return (
    <strong className="font-bold" style={{ color: color.hex }}>
      {name}
    </strong>
  )
}

function ActorChips({ actors }: { actors: readonly string[] }) {
  if (!actors.length) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {actors.map((actor) => {
        const color = getActorColor(actor)
        return (
          <span
            key={actor}
            className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold"
            style={{ color: color.hex, backgroundColor: color.soft, border: `1px solid ${color.border}` }}
          >
            {actor}
          </span>
        )
      })}
    </span>
  )
}

function ActorLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {ONBOARDING_ACTORS.map((actor) => (
        <span key={actor.name} className="inline-flex items-center gap-1.5 text-[10px] text-slate-500">
          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: actor.color.hex }} />
          <ActorName name={actor.name} />
        </span>
      ))}
    </div>
  )
}

function QuizOption({
  label,
  selected,
  correct,
  revealed,
  onClick,
}: {
  label: string
  selected: boolean
  correct: boolean
  revealed: boolean
  onClick: () => void
}) {
  let tone = 'border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/40'
  if (revealed && correct) tone = 'border-emerald-300 bg-emerald-50 text-emerald-900'
  else if (revealed && selected && !correct) tone = 'border-red-300 bg-red-50 text-red-800'
  else if (selected) tone = 'border-blue-300 bg-blue-50 text-[#0d3763]'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={revealed}
      className={`w-full rounded-md border px-3 py-2.5 text-left text-xs transition ${tone} disabled:cursor-default`}
    >
      {label}
    </button>
  )
}

function WelcomeChapter() {
  return (
    <div className="space-y-5">
      <p className="text-sm leading-6 text-slate-600">
        Correspondence moves by <strong>who holds the letter</strong>, not by Coordinator → Manager → Actionist
        approval ladders. Anyone can register and Mark to any user. The Workflow tab on a letter is where Mark,
        Accept, Reply, Revoke, and Close happen.
      </p>
      <ActorLegend />
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {WORKFLOW_PIPELINE.map((step, index) => (
          <div key={step.status} className="rounded-md border border-slate-200 bg-slate-50/80 p-3">
            <div className="mb-1 flex items-center gap-2">
              <span className="flex size-5 items-center justify-center rounded-full bg-[#0d3763] text-[10px] font-bold text-white">
                {index + 1}
              </span>
              <p className="text-xs font-bold text-slate-800">{step.status}</p>
            </div>
            <p className="text-[11px] leading-5 text-slate-500">{step.meaning}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Who</span>
              <ActorChips actors={step.actors} />
            </div>
          </div>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {ONBOARDING_ACTORS.filter((a) => a.name === 'Admin' || a.name === 'Viewer').map((actor) => (
          <div
            key={actor.name}
            className="rounded-md border p-3"
            style={{ borderColor: actor.color.border, backgroundColor: actor.color.soft }}
          >
            <p className="text-xs font-bold" style={{ color: actor.color.hex }}>
              {actor.name}
            </p>
            <p className="mt-1 text-[11px] leading-5 text-slate-600">{actor.summary}</p>
          </div>
        ))}
      </div>
      <Card className="border-blue-100 bg-blue-50/50 p-4">
        <p className="text-xs font-semibold text-[#0d3763]">Tip</p>
        <p className="mt-1 text-xs leading-5 text-slate-600">
          Letter status is simply <strong>Open</strong>, <strong>Closed</strong>, or <strong>Archived</strong>.
          Inbox and Sent come from active markings and holds — not an enterprise status machine. Department roles
          may still affect which letters you can see; they no longer gate day-to-day Mark actions.
        </p>
      </Card>
    </div>
  )
}

function RegisterChapter({ go }: { go: (target: string) => void }) {
  const steps: { text: string; actors: string[] }[] = [
    {
      text: 'Open Letters → Create and choose Incoming or Outgoing.',
      actors: ['Any user'],
    },
    {
      text: 'Enter fields manually, or upload a scan for OCR + AI extraction.',
      actors: ['Any user'],
    },
    {
      text: 'If AI staged a review job, confirm the fields, then save.',
      actors: ['Any user'],
    },
    {
      text: 'The letter opens as Open. You are initiator and initial holder — ready to Mark.',
      actors: ['Initiator'],
    },
  ]
  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-slate-600">
        Use <strong>Create</strong> (Register Letter) to capture incoming or outgoing correspondence. There is no
        separate validate / classify gate afterward — once saved, work continues on the <strong>Workflow</strong>{' '}
        tab.
      </p>
      <ol className="space-y-3">
        {steps.map((step, i) => (
          <li key={step.text} className="flex gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#1769aa] text-[11px] font-bold text-white">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <span className="text-xs leading-5 text-slate-700">{step.text}</span>
              <div className="mt-1.5">
                <ActorChips actors={step.actors} />
              </div>
            </div>
          </li>
        ))}
      </ol>
      <Button variant="outline" size="sm" onClick={() => go('Create')}>
        Open Create <ArrowRight data-icon="inline-end" />
      </Button>
    </div>
  )
}

function MarkChapter() {
  const [selected, setSelected] = useState<string | null>(null)
  const [quiz, setQuiz] = useState<string | null>(null)
  const revealed = quiz !== null
  const active = MARK_TYPES.find((m) => m.id === selected)

  return (
    <div className="space-y-5">
      <p className="text-sm leading-6 text-slate-600">
        <strong>Mark</strong> is how work moves. The current holder picks recipients in the Workflow composer:{' '}
        <strong>To</strong> (Forward or Response Required) and optional <strong>Info</strong> (For Information),
        then <strong>Confirm Mark</strong>. Depth is unlimited — anyone who holds can Mark onward.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {MARK_TYPES.map((mark) => {
          const activeMark = selected === mark.id
          return (
            <button
              key={mark.id}
              type="button"
              onClick={() => setSelected(mark.id)}
              className={`rounded-lg border p-4 text-left transition ${
                activeMark
                  ? 'border-[#0d3763] bg-blue-50 ring-1 ring-[#0d3763]/40'
                  : 'border-slate-200 hover:border-blue-200'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-bold text-slate-800">{mark.title}</p>
                <Badge tone="slate">{mark.slot}</Badge>
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-500">{mark.meaning}</p>
            </button>
          )
        })}
      </div>
      {active && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-900"
        >
          {active.id === 'forward' && (
            <>
              Forward moves the hold. After <ActorName name="Recipient" /> Accepts, they become{' '}
              <ActorName name="Current holder" /> and can Mark or Reply.
            </>
          )}
          {active.id === 'response_required' && (
            <>
              Response Required creates a trackable obligation. Use <strong>My batch trackers</strong> on the
              Workflow tab until the recipient Replies.
            </>
          )}
          {active.id === 'for_info' && (
            <>
              For Information is awareness only — no response obligation and no action ladder. Combine it with a
              To recipient when someone still needs to own the letter.
            </>
          )}
          {active.id === 'reply' && (
            <>
              Reply sends the letter back to the previous <ActorName name="Marker" />. Use it after notes or when
              fulfilling Response Required.
            </>
          )}
        </motion.div>
      )}
      <div className="rounded-lg border border-slate-200 p-4">
        <p className="text-xs font-bold text-slate-700">Quick check</p>
        <p className="mt-1 text-xs text-slate-500">
          You need Legal to prepare comments before a board meeting. Which Mark type fits?
        </p>
        <div className="mt-3 space-y-2">
          <QuizOption
            label="For Information — they only need to be aware"
            selected={quiz === 'wrong'}
            correct={false}
            revealed={revealed}
            onClick={() => setQuiz('wrong')}
          />
          <QuizOption
            label="Response Required — ask for Comments and track until they Reply"
            selected={quiz === 'right'}
            correct
            revealed={revealed}
            onClick={() => setQuiz('right')}
          />
        </div>
        {revealed && (
          <p className="mt-3 text-xs text-slate-600">
            {quiz === 'right'
              ? 'Correct. Response Required fits when you need a tracked reply.'
              : 'Not quite — For Information is FYI only. Use Response Required when you need comments back.'}
          </p>
        )}
      </div>
    </div>
  )
}

function WorkChapter({ go }: { go: (target: string) => void }) {
  const stages: { label: string; detail: ReactNode; actors: string[] }[] = [
    {
      label: 'Inbox',
      detail: 'New marks land here. Open the letter → Workflow tab.',
      actors: ['Recipient'],
    },
    {
      label: 'Accept or Reject',
      detail: (
        <>
          Choose <strong>Accept — I will work on it</strong> before Marking or adding notes. Reject returns the
          hold.
        </>
      ),
      actors: ['Recipient'],
    },
    {
      label: 'Notes & attachments',
      detail: 'While you hold, add dated comments and typed files on the letter.',
      actors: ['Current holder'],
    },
    {
      label: 'Mark or Reply',
      detail: 'Pass the letter onward, or Send Reply back to the previous marker.',
      actors: ['Current holder'],
    },
  ]
  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-slate-600">
        After someone Marks to you, the letter appears in <strong>Inbox</strong>. Accepting makes you the{' '}
        <ActorName name="Current holder" />. There are no separate action-item Accept / Start / Complete stages —
        you work on the letter itself, then Mark or Reply.
      </p>
      <div className="relative space-y-0 pl-3">
        <div className="absolute bottom-2 left-[19px] top-2 w-px bg-slate-200" />
        {stages.map((stage) => {
          const accent = getActorColor(stage.actors[0] ?? 'Current holder')
          return (
            <div key={stage.label} className="relative flex gap-3 py-2">
              <span
                className="relative z-[1] mt-0.5 size-3.5 shrink-0 rounded-full border-2 bg-white"
                style={{ borderColor: accent.hex }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-bold text-slate-800">{stage.label}</p>
                  <ActorChips actors={stage.actors} />
                </div>
                <p className="text-[11px] leading-5 text-slate-500">{stage.detail}</p>
              </div>
            </div>
          )
        })}
      </div>
      <Button variant="outline" size="sm" onClick={() => go('Inbox')}>
        Open Inbox <ArrowRight data-icon="inline-end" />
      </Button>
    </div>
  )
}

function TrackCloseChapter() {
  const items: { title: string; detail: string; actors: string[] }[] = [
    {
      title: 'My batch trackers',
      detail: 'On Workflow, see Response Required marks you sent and whether recipients still owe a reply.',
      actors: ['Marker'],
    },
    {
      title: 'Pathway / Marking Information',
      detail: 'Follow the marking tree, active holders, and how the letter reached you.',
      actors: ['Current holder', 'Marker'],
    },
    {
      title: 'Revoke',
      detail: 'Undo your mark if the recipient has not remade onward or added comments/attachments.',
      actors: ['Marker'],
    },
    {
      title: 'Close',
      detail: 'When the initiator holds again, Close the correspondence. Soft warning if RR marks remain open.',
      actors: ['Initiator'],
    },
  ]
  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-slate-600">
        After you Mark, you are mostly watching and (when allowed) revoking until hold returns. Closing is for the{' '}
        <ActorName name="Initiator" /> while they hold — not a multi-tier dispatch approval.
      </p>
      <div className="overflow-hidden rounded-lg border border-slate-200">
        {items.map((item, index, arr) => (
          <div
            key={item.title}
            className={`flex gap-3 px-4 py-3 ${index < arr.length - 1 ? 'border-b border-slate-100' : ''} ${
              index % 2 === 0 ? 'bg-white' : 'bg-slate-50/80'
            }`}
          >
            <span className="text-xs font-bold text-[#1769aa]">{String(index + 1).padStart(2, '0')}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-bold text-slate-800">{item.title}</p>
                <ActorChips actors={item.actors} />
              </div>
              <p className="mt-0.5 text-[11px] text-slate-500">{item.detail}</p>
            </div>
          </div>
        ))}
      </div>
      <Card className="p-4">
        <p className="text-xs font-bold text-slate-700">Also remember</p>
        <ul className="mt-2 space-y-1.5 text-xs text-slate-600">
          <li>• After Marking onward, you generally cannot edit the letter until hold comes back.</li>
          <li>
            • <ActorName name="Admin" /> can still override (for example force-close or edit when needed).
          </li>
          <li>• Archive remains a separate retention step after Close when policy requires it.</li>
        </ul>
      </Card>
    </div>
  )
}

function WorkspaceChapter({ go }: { go: (target: string) => void }) {
  const areas: { title: string; href: string; detail: string }[] = [
    {
      title: 'Inbox',
      href: 'Inbox',
      detail: 'Marks waiting for Accept, or letters you currently hold.',
    },
    {
      title: 'Sent',
      href: 'Sent',
      detail: 'Letters you marked onward — useful while tracking.',
    },
    {
      title: 'Create',
      href: 'Create',
      detail: 'Register a new letter (manual or OCR-assisted).',
    },
    {
      title: 'Track',
      href: 'Track',
      detail: 'Filter All / Incoming / Pending / Closed / Archived.',
    },
    {
      title: 'Catalog',
      href: 'Catalog',
      detail: 'Browse retained correspondence for reference.',
    },
    {
      title: 'My Actions',
      href: 'My Actions',
      detail: 'Personal follow-ups tied to your participation.',
    },
  ]
  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-slate-600">
        Day-to-day work lives under Workspace and Letters. Start in <strong>Inbox</strong> or{' '}
        <strong>Create</strong>; open any letter and use the <strong>Workflow</strong> tab for Marking.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {areas.map((area) => (
          <button
            key={area.title}
            type="button"
            onClick={() => go(area.href)}
            className="rounded-md border border-slate-200 bg-white p-3 text-left transition hover:border-blue-200 hover:bg-blue-50/40"
          >
            <p className="text-xs font-bold text-slate-800">{area.title}</p>
            <p className="mt-1 text-[11px] text-slate-500">{area.detail}</p>
          </button>
        ))}
      </div>
    </div>
  )
}

function AiChapter({ go }: { go: (target: string) => void }) {
  const items: { title: string; detail: string; href: string }[] = [
    {
      title: 'OCR on Create',
      detail: 'Extract fields from scans during registration.',
      href: 'Create',
    },
    {
      title: 'AI Assistant',
      detail: 'Ask natural-language questions about letters and follow-ups.',
      href: 'AI Assistant',
    },
    {
      title: 'AI Insights',
      detail: 'Patterns across correspondence for oversight.',
      href: 'AI Insights',
    },
    {
      title: 'Letter Analysis',
      detail: 'Priority, risks, and suggested next steps on a letter.',
      href: 'Letter Analysis',
    },
  ]
  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-slate-600">
        AI helps with <strong>intake and discovery</strong>. It does not create markings or replace Accept / Mark /
        Reply / Close on the Workflow tab.
      </p>
      <div className="grid gap-3">
        {items.map((item) => (
          <button
            key={item.title}
            type="button"
            onClick={() => go(item.href)}
            className="flex items-start gap-3 rounded-md border border-slate-200 px-3 py-3 text-left hover:bg-slate-50"
          >
            <Sparkles className="mt-0.5 size-4 shrink-0 text-[#1769aa]" />
            <div>
              <p className="text-xs font-bold text-slate-800">{item.title}</p>
              <p className="text-[11px] text-slate-500">{item.detail}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function PracticeChapter({
  status,
  log,
  onAction,
  onReset,
}: {
  status: string
  log: { actors: string[]; text: string }[]
  onAction: (action: PracticeAction) => void
  onReset: () => void
}) {
  const step = PRACTICE_STEPS.find((s) => s.status === status) ?? PRACTICE_STEPS[0]
  const done = step.actions.length === 0
  const activeActors = step.actions[0]?.actors ?? []

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-slate-600">
        Click through a sample letter using the simplified flow. Buttons show who acts — holder, recipient,
        marker, or initiator — not legacy role tiers.
      </p>
      <ActorLegend />
      <div className="rounded-lg border border-slate-200 bg-[#0d3763] p-4 text-white">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-200/80">Sample letter</p>
          <Badge tone="blue">{status}</Badge>
        </div>
        <p className="text-sm font-semibold">SUPARCO / Coordination — Budget clarification request</p>
        <p className="mt-2 text-xs leading-5 text-blue-100/85">{step.prompt}</p>
        {activeActors.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-200/70">Act as</span>
            <ActorChips actors={activeActors} />
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {step.actions.map((action) => {
          const accent = getActorColor(action.actors[0] ?? 'Current holder')
          return (
            <Button
              key={action.id}
              size="sm"
              onClick={() => onAction(action)}
              style={{ backgroundColor: accent.hex, borderColor: accent.hex }}
            >
              {action.id.includes('reply') ? (
                <CornerUpLeft data-icon="inline-start" />
              ) : action.id.includes('mark') ? (
                <Send data-icon="inline-start" />
              ) : (
                <Play data-icon="inline-start" />
              )}
              {action.label}
              <span className="ml-1.5 inline-flex gap-1">
                {action.actors.map((actor) => (
                  <span
                    key={actor}
                    className="rounded px-1 py-px text-[10px] font-bold"
                    style={{ backgroundColor: 'rgba(255,255,255,0.22)' }}
                  >
                    {actor}
                  </span>
                ))}
              </span>
            </Button>
          )
        })}
        <Button variant="outline" size="sm" onClick={onReset}>
          <RotateCcw data-icon="inline-start" />
          Restart practice
        </Button>
      </div>
      {done && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-900">
          Journey complete. Restart and choose the other Mark type to see Forward vs Response Required.
        </div>
      )}
      {log.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Your trail</p>
          <div className="space-y-1.5">
            {log.map((entry, index) => (
              <div
                key={`${entry.text}-${index}`}
                className="flex flex-wrap items-start gap-2 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-[11px] text-slate-600"
              >
                <ActorChips actors={entry.actors} />
                <span className="min-w-0 flex-1">{entry.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ChapterBody({
  id,
  progress,
  setProgress,
  go,
}: {
  id: OnboardingChapterId
  progress: OnboardingProgress
  setProgress: (next: OnboardingProgress | ((prev: OnboardingProgress) => OnboardingProgress)) => void
  go: (target: string) => void
}) {
  switch (id) {
    case 'welcome':
      return <WelcomeChapter />
    case 'register':
      return <RegisterChapter go={go} />
    case 'mark':
      return <MarkChapter />
    case 'work':
      return <WorkChapter go={go} />
    case 'track-close':
      return <TrackCloseChapter />
    case 'workspace':
      return <WorkspaceChapter go={go} />
    case 'ai':
      return <AiChapter go={go} />
    case 'practice':
      return (
        <PracticeChapter
          status={progress.practiceStatus}
          log={progress.practiceLog}
          onAction={(action) =>
            setProgress((prev) => ({
              ...prev,
              practiceStatus: action.nextStatus,
              practiceLog: [
                ...prev.practiceLog,
                {
                  actors: action.actors,
                  text: `${action.label} → ${action.nextStatus}. ${action.note}`,
                },
              ],
            }))
          }
          onReset={() =>
            setProgress((prev) => ({
              ...prev,
              practiceStatus: 'Open',
              practiceLog: [],
            }))
          }
        />
      )
    default:
      return null
  }
}

export function OnboardingPage() {
  const go = useGo()
  const [ready, setReady] = useState(false)
  const [progress, setProgress] = useState<OnboardingProgress>(defaultOnboardingProgress)

  useEffect(() => {
    setProgress(loadOnboardingProgress())
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready) return
    saveOnboardingProgress(progress)
  }, [progress, ready])

  const chapterIndex = ONBOARDING_CHAPTERS.findIndex((c) => c.id === progress.current)
  const chapter = ONBOARDING_CHAPTERS[chapterIndex] ?? ONBOARDING_CHAPTERS[0]
  const percent = Math.round((progress.completed.length / ONBOARDING_CHAPTERS.length) * 100)
  const Icon = CHAPTER_ICONS[chapter.id]

  const markCompleteAndNext = () => {
    setProgress((prev) => {
      const completed = prev.completed.includes(prev.current)
        ? prev.completed
        : [...prev.completed, prev.current]
      const next = ONBOARDING_CHAPTERS[Math.min(chapterIndex + 1, ONBOARDING_CHAPTERS.length - 1)]
      return { ...prev, completed, current: next.id }
    })
  }

  const goPrev = () => {
    if (chapterIndex <= 0) return
    setProgress((prev) => ({ ...prev, current: ONBOARDING_CHAPTERS[chapterIndex - 1].id }))
  }

  const resetAll = () => setProgress(defaultOnboardingProgress())

  const completedSet = useMemo(() => new Set(progress.completed), [progress.completed])

  return (
    <>
      <PageTitle
        title="Onboarding"
        description="Interactive walkthrough of holdership, Marking, Accept / Reply, and closing correspondence."
        action={
          <Button variant="outline" size="sm" onClick={resetAll}>
            <RotateCcw data-icon="inline-start" />
            Reset progress
          </Button>
        }
      />

      <Card className="mb-5 p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-slate-700">
            {progress.completed.length} of {ONBOARDING_CHAPTERS.length} chapters complete
          </p>
          <p className="text-xs font-bold text-[#1769aa]">{percent}%</p>
        </div>
        <ProgressBar value={percent} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
        <nav className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm lg:sticky lg:top-4 lg:self-start">
          <p className="px-2 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Chapters</p>
          <div className="flex flex-col gap-0.5">
            {ONBOARDING_CHAPTERS.map((item, index) => {
              const ItemIcon = CHAPTER_ICONS[item.id]
              const active = item.id === progress.current
              const done = completedSet.has(item.id)
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setProgress((prev) => ({ ...prev, current: item.id }))}
                  className={`flex w-full items-center gap-2 rounded-lg border px-2 py-2 text-left transition-colors ${
                    active
                      ? 'border-slate-500 bg-slate-500 text-white'
                      : 'border-transparent text-slate-600 hover:border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  <span
                    className={`flex size-6 shrink-0 items-center justify-center rounded-md ${
                      done
                        ? 'bg-emerald-100 text-emerald-700'
                        : active
                          ? 'bg-white/20 text-white'
                          : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {done ? <CheckCircle2 className="size-3.5" /> : <ItemIcon className="size-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-xs ${active ? 'font-bold text-white' : 'font-medium'}`}>
                      {index + 1}. {item.title}
                    </span>
                    <span className={`block truncate text-[10px] ${active ? 'text-white/70' : 'text-slate-400'}`}>
                      {item.minutes} min
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </nav>

        <Card className="overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50/80 px-5 py-4">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#0d3763] text-white">
                <Icon className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                  Chapter {chapterIndex + 1} of {ONBOARDING_CHAPTERS.length}
                </p>
                <h2 className="text-lg font-bold text-[#102a43]">{chapter.title}</h2>
                <p className="text-xs text-slate-500">{chapter.subtitle}</p>
              </div>
            </div>
          </div>
          <div className="p-5">
            <AnimatePresence mode="wait">
              <motion.div
                key={chapter.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
              >
                <ChapterBody id={chapter.id} progress={progress} setProgress={setProgress} go={go} />
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-4">
            <Button variant="outline" size="sm" disabled={chapterIndex === 0} onClick={goPrev}>
              Previous
            </Button>
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <Lightbulb className="size-3.5" />
              Progress is saved in this browser
            </div>
            {chapterIndex < ONBOARDING_CHAPTERS.length - 1 ? (
              <Button size="sm" onClick={markCompleteAndNext}>
                {completedSet.has(chapter.id) ? 'Next chapter' : 'Mark complete & continue'}
                <ArrowRight data-icon="inline-end" />
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() =>
                  setProgress((prev) => ({
                    ...prev,
                    completed: prev.completed.includes('practice')
                      ? prev.completed
                      : [...prev.completed, 'practice'],
                  }))
                }
              >
                {completedSet.has('practice') ? 'Tour finished' : 'Finish tour'}
                <CheckCircle2 data-icon="inline-end" />
              </Button>
            )}
          </div>
        </Card>
      </div>
    </>
  )
}
