'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  FilePlus2,
  GraduationCap,
  Inbox,
  Lightbulb,
  Play,
  RotateCcw,
  Route,
  Sparkles,
  Tags,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, Card, PageTitle } from '@/components/cms/ui'
import { useGo } from '@/hooks/use-go'
import {
  ONBOARDING_CHAPTERS,
  ONBOARDING_ROLES,
  PRACTICE_STEPS,
  WORKFLOW_PIPELINE,
  defaultOnboardingProgress,
  getRoleColor,
  loadOnboardingProgress,
  saveOnboardingProgress,
  type OnboardingChapterId,
  type OnboardingProgress,
  type PracticeAction,
} from '@/lib/onboarding'

const CHAPTER_ICONS: Record<OnboardingChapterId, React.ComponentType<{ className?: string }>> = {
  welcome: BookOpen,
  roles: Users,
  register: FilePlus2,
  marking: Tags,
  routing: Route,
  'action-items': ClipboardList,
  response: CheckCircle2,
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

/** Bold role name in that role's unique color (used everywhere in onboarding). */
function RoleName({ name }: { name: string }) {
  const color = getRoleColor(name)
  return (
    <strong className="font-bold" style={{ color: color.hex }}>
      {name}
    </strong>
  )
}

/** Soft chip(s) naming which role(s) own a step. */
function RoleChips({ roles }: { roles: readonly string[] }) {
  if (!roles.length) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {roles.map((role) => {
        const color = getRoleColor(role)
        return (
          <span
            key={role}
            className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold"
            style={{ color: color.hex, backgroundColor: color.soft, border: `1px solid ${color.border}` }}
          >
            {role}
          </span>
        )
      })}
    </span>
  )
}

function RoleLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {ONBOARDING_ROLES.map((role) => (
        <span key={role.name} className="inline-flex items-center gap-1.5 text-[10px] text-slate-500">
          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: role.color.hex }} />
          <RoleName name={role.name} />
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
        This system tracks every letter from registration through marking, routing, action items, response,
        and archive. Work is role-gated: what you see on a letter depends on your role and the current status.
        Each step below lists the role(s) that typically act there.
      </p>
      <RoleLegend />
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
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Role</span>
              <RoleChips roles={step.roles} />
            </div>
          </div>
        ))}
      </div>
      <Card className="border-blue-100 bg-blue-50/50 p-4">
        <p className="text-xs font-semibold text-[#0d3763]">Tip</p>
        <p className="mt-1 text-xs leading-5 text-slate-600">
          Open any letter to use the Workflow panel. Only authorized transitions for your role appear as actions.{' '}
          <RoleName name="Viewer" /> never sees transition buttons; <RoleName name="Admin" /> can override any
          step.
        </p>
      </Card>
    </div>
  )
}

function RolesChapter({
  selectedRole,
  onSelectRole,
}: {
  selectedRole: string
  onSelectRole: (role: string) => void
}) {
  const role = ONBOARDING_ROLES.find((r) => r.name === selectedRole) ?? ONBOARDING_ROLES[0]
  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-slate-600">
        Roles are listed in the order a letter moves through the system — from intake to close. Each role keeps
        the same color throughout this tour. New accounts typically start as <RoleName name="Actionist" />;{' '}
        <RoleName name="Admin" /> elevates people in Settings → Users.
      </p>
      <div className="flex flex-wrap gap-2">
        {ONBOARDING_ROLES.map((item) => {
          const active = selectedRole === item.name
          return (
            <button
              key={item.name}
              type="button"
              onClick={() => onSelectRole(item.name)}
              className="rounded-md border px-3 py-1.5 text-xs font-bold transition"
              style={
                active
                  ? { backgroundColor: item.color.hex, borderColor: item.color.hex, color: '#fff' }
                  : {
                      backgroundColor: item.color.soft,
                      borderColor: item.color.border,
                      color: item.color.hex,
                    }
              }
            >
              {item.name}
            </button>
          )
        })}
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={role.name}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2 }}
          className="rounded-lg border bg-white p-4 shadow-sm"
          style={{ borderColor: role.color.border }}
        >
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: role.color.hex }} />
            <h3 className="text-sm font-bold" style={{ color: role.color.hex }}>
              {role.name}
            </h3>
            <span
              className="inline-flex items-center rounded-md px-2 py-1 text-[11px] font-semibold"
              style={{ color: role.color.hex, backgroundColor: role.color.soft }}
            >
              {role.focus}
            </span>
          </div>
          <p className="text-xs leading-5 text-slate-600">{role.summary}</p>
          <ul className="mt-3 space-y-1.5">
            {role.permissions.map((perm) => (
              <li key={perm} className="flex items-start gap-2 text-xs text-slate-700">
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" style={{ color: role.color.hex }} />
                <span>{perm}</span>
              </li>
            ))}
          </ul>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function RegisterChapter({ go }: { go: (target: string) => void }) {
  const steps: { text: string; roles: string[] }[] = [
    {
      text: 'Open Letters → Create and choose Incoming or Outgoing.',
      roles: ['Coordinator', 'Admin'],
    },
    {
      text: 'Upload a scan (optional) — OCR fills number, subject, dates, and body.',
      roles: ['Coordinator'],
    },
    {
      text: 'Review the staged job if AI needs confirmation, then save the letter.',
      roles: ['Coordinator'],
    },
    {
      text: 'The letter starts as Registered and appears in Inbox / Track.',
      roles: ['Coordinator', 'Viewer'],
    },
  ]
  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-slate-600">
        <RoleName name="Coordinator" /> (or <RoleName name="Admin" />) uses <strong>Create</strong> (Register
        Letter) to capture incoming or outgoing correspondence. Enter fields manually or upload a scan for OCR +
        AI extraction, then review before saving.
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
                <RoleChips roles={step.roles} />
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

function MarkingChapter() {
  const [choice, setChoice] = useState<'actionable' | 'information' | null>(null)
  const [quiz, setQuiz] = useState<string | null>(null)
  const revealed = quiz !== null

  return (
    <div className="space-y-5">
      <p className="text-sm leading-6 text-slate-600">
        <strong>Marking</strong> (classify) decides the path. <RoleName name="Coordinator" /> and{' '}
        <RoleName name="Manager" /> set whether a letter is Actionable or Information after validation.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setChoice('actionable')}
          className={`rounded-lg border p-4 text-left transition ${
            choice === 'actionable' ? 'border-[#0d3763] bg-blue-50 ring-1 ring-[#0d3763]/40' : 'border-slate-200 hover:border-blue-200'
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold text-slate-800">Actionable</p>
            <RoleChips roles={['Coordinator', 'Manager']} />
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Needs an owner, action items, response draft, approval, and dispatch before close. Marked by{' '}
            <RoleName name="Coordinator" /> / <RoleName name="Manager" />.
          </p>
        </button>
        <button
          type="button"
          onClick={() => setChoice('information')}
          className={`rounded-lg border p-4 text-left transition ${
            choice === 'information' ? 'border-[#0d3763] bg-blue-50 ring-1 ring-[#0d3763]/40' : 'border-slate-200 hover:border-blue-200'
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold text-slate-800">Information / FYI</p>
            <RoleChips roles={['Coordinator']} />
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Route for awareness, acknowledge delivery, then close as information delivered — no reply chain.
            Typically marked and closed by <RoleName name="Coordinator" />.
          </p>
        </button>
      </div>
      {choice && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-900"
        >
          {choice === 'actionable' ? (
            <>
              Next: <RoleName name="Management" /> approves routing → <RoleName name="Manager" /> delegates →{' '}
              <RoleName name="Actionist" /> accepts the action item.
            </>
          ) : (
            <>
              Next: <RoleName name="Coordinator" /> routes for information → <RoleName name="Actionist" />{' '}
              acknowledges → <RoleName name="Coordinator" /> closes the information letter.
            </>
          )}
        </motion.div>
      )}
      <div className="rounded-lg border border-slate-200 p-4">
        <p className="text-xs font-bold text-slate-700">Quick check</p>
        <p className="mt-1 text-xs text-slate-500">
          A ministry circular only needs departments to be aware — no reply is expected. How should it be marked?
        </p>
        <div className="mt-3 space-y-2">
          <QuizOption
            label="Actionable — assign someone to draft a response"
            selected={quiz === 'wrong'}
            correct={false}
            revealed={revealed}
            onClick={() => setQuiz('wrong')}
          />
          <QuizOption
            label="Information / FYI — route for awareness and close when delivered"
            selected={quiz === 'right'}
            correct
            revealed={revealed}
            onClick={() => setQuiz('right')}
          />
        </div>
        {revealed && (
          <p className="mt-3 text-xs text-slate-600">
            {quiz === 'right'
              ? 'Correct. Use Information when the letter is for awareness only.'
              : 'Not quite — without a required reply, mark it Information / FYI.'}
          </p>
        )}
      </div>
    </div>
  )
}

function RoutingChapter() {
  const steps: { title: string; detail: string; roles: string[] }[] = [
    {
      title: 'Validate',
      detail: 'Confirm OCR fields, attachments, and parties.',
      roles: ['Coordinator'],
    },
    {
      title: 'Classify / Mark',
      detail: 'Set Information vs Actionable.',
      roles: ['Coordinator', 'Manager'],
    },
    {
      title: 'Approve routing',
      detail: 'Confirm owning department when required.',
      roles: ['Management', 'Admin'],
    },
    {
      title: 'Delegate / Handle here',
      detail: 'Create an action item or keep ownership.',
      roles: ['Manager', 'Coordinator'],
    },
    {
      title: 'Assign / Forward / Reassign',
      detail: 'Move ownership as the letter progresses.',
      roles: ['Coordinator', 'Manager', 'Admin'],
    },
  ]
  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-slate-600">
        After registration, <RoleName name="Coordinator" /> <strong>validates</strong> data, then{' '}
        <strong>classifies</strong> (marks) the letter. <RoleName name="Management" /> may approve routing;{' '}
        <RoleName name="Manager" /> delegates to an <RoleName name="Actionist" /> or handles the letter at their
        tier.
      </p>
      <div className="overflow-hidden rounded-lg border border-slate-200">
        {steps.map((step, index, arr) => (
          <div
            key={step.title}
            className={`flex gap-3 px-4 py-3 ${index < arr.length - 1 ? 'border-b border-slate-100' : ''} ${
              index % 2 === 0 ? 'bg-white' : 'bg-slate-50/80'
            }`}
          >
            <span className="text-xs font-bold text-[#1769aa]">{String(index + 1).padStart(2, '0')}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-bold text-slate-800">{step.title}</p>
                <RoleChips roles={step.roles} />
              </div>
              <p className="mt-0.5 text-[11px] text-slate-500">{step.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ActionItemsChapter({ go }: { go: (target: string) => void }) {
  const stages: { label: string; detail: ReactNode; roles: string[] }[] = [
    {
      label: 'Assigned',
      detail: (
        <>
          <RoleName name="Manager" /> / <RoleName name="Coordinator" /> created the item with instructions and due
          date.
        </>
      ),
      roles: ['Manager', 'Coordinator'],
    },
    {
      label: 'Accept',
      detail: (
        <>
          <RoleName name="Actionist" /> takes ownership so status becomes clear.
        </>
      ),
      roles: ['Actionist'],
    },
    {
      label: 'Start',
      detail: 'Work begins; Monitoring tracks days pending.',
      roles: ['Actionist'],
    },
    {
      label: 'Block',
      detail: 'Pause with a reason when waiting on external input.',
      roles: ['Actionist'],
    },
    {
      label: 'Complete',
      detail: 'Finish the item, then draft a response if a reply is required.',
      roles: ['Actionist'],
    },
  ]
  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-slate-600">
        Action items are the unit of work on an actionable letter. They appear under <strong>My Actions</strong>{' '}
        for the <RoleName name="Actionist" /> assignee and drive status changes when accepted, blocked, or
        completed.
      </p>
      <div className="relative space-y-0 pl-3">
        <div className="absolute bottom-2 left-[19px] top-2 w-px bg-slate-200" />
        {stages.map((stage) => {
          const accent = getRoleColor(stage.roles[0] ?? 'Actionist')
          return (
            <div key={stage.label} className="relative flex gap-3 py-2">
              <span
                className="relative z-[1] mt-0.5 size-3.5 shrink-0 rounded-full border-2 bg-white"
                style={{ borderColor: accent.hex }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-bold text-slate-800">{stage.label}</p>
                  <RoleChips roles={stage.roles} />
                </div>
                <p className="text-[11px] leading-5 text-slate-500">{stage.detail}</p>
              </div>
            </div>
          )
        })}
      </div>
      <Button variant="outline" size="sm" onClick={() => go('My Actions')}>
        Open My Actions <ArrowRight data-icon="inline-end" />
      </Button>
    </div>
  )
}

function ResponseChapter() {
  const steps: { label: string; roles: string[] }[] = [
    { label: 'Draft response', roles: ['Actionist'] },
    { label: 'Submit for approval', roles: ['Actionist'] },
    { label: 'Approve / Return', roles: ['Manager', 'Management'] },
    { label: 'Dispatch', roles: ['Management', 'Admin'] },
    { label: 'Close', roles: ['Manager', 'Management', 'Admin'] },
    { label: 'Archive', roles: ['Manager', 'Admin'] },
  ]
  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-slate-600">
        When a reply is needed, the <RoleName name="Actionist" /> drafts a response version, submits it for
        approval by <RoleName name="Manager" /> / <RoleName name="Management" />, then{' '}
        <RoleName name="Management" /> or <RoleName name="Admin" /> dispatches on an internal or external channel.
        Then close and archive.
      </p>
      <div className="flex flex-col gap-2">
        {steps.map((step, index, arr) => (
          <div key={step.label} className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700">
              {step.label}
            </span>
            <RoleChips roles={step.roles} />
            {index < arr.length - 1 && <ArrowRight className="size-3.5 text-slate-300" />}
          </div>
        ))}
      </div>
      <Card className="p-4">
        <p className="text-xs font-bold text-slate-700">Also available on the letter</p>
        <ul className="mt-2 space-y-1.5 text-xs text-slate-600">
          <li>
            • <RoleName name="Actionist" /> — request clarification when instructions are unclear
          </li>
          <li>
            • <RoleName name="Manager" /> / <RoleName name="Management" /> — escalate blocked or overdue work
          </li>
          <li>
            • <RoleName name="Manager" /> / <RoleName name="Admin" /> — reopen closed letters if follow-up is
            required
          </li>
        </ul>
      </Card>
    </div>
  )
}

function WorkspaceChapter({ go }: { go: (target: string) => void }) {
  const areas: { title: string; href: string; detail: string; roles: string[] }[] = [
    {
      title: 'Inbox',
      href: 'Inbox',
      detail: 'Letters awaiting your attention or assignment.',
      roles: ['Coordinator', 'Manager', 'Actionist'],
    },
    {
      title: 'My Actions',
      href: 'My Actions',
      detail: 'Action items assigned to you with due dates.',
      roles: ['Actionist'],
    },
    {
      title: 'Monitoring',
      href: 'Monitoring',
      detail: 'Overdue, blocked, and aging correspondence.',
      roles: ['Manager', 'Management', 'Admin'],
    },
    {
      title: 'Track',
      href: 'Track',
      detail: 'Filter All / Incoming / Pending / Closed / Archived.',
      roles: ['Coordinator', 'Manager', 'Viewer'],
    },
    {
      title: 'Catalog',
      href: 'Catalog',
      detail: 'Browse retained correspondence for reference.',
      roles: ['Viewer', 'Coordinator', 'Admin'],
    },
  ]
  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-slate-600">
        Day-to-day work lives in Workspace and Letters. Primary audiences differ by view — chips show who uses
        each area most.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {areas.map((area) => (
          <button
            key={area.title}
            type="button"
            onClick={() => go(area.href)}
            className="rounded-md border border-slate-200 bg-white p-3 text-left transition hover:border-blue-200 hover:bg-blue-50/40"
          >
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-bold text-slate-800">{area.title}</p>
              <RoleChips roles={area.roles} />
            </div>
            <p className="mt-1 text-[11px] text-slate-500">{area.detail}</p>
          </button>
        ))}
      </div>
    </div>
  )
}

function AiChapter({ go }: { go: (target: string) => void }) {
  const items: { title: string; detail: string; href: string; roles: string[] }[] = [
    {
      title: 'AI Assistant',
      detail: 'Ask natural-language questions about letters and follow-ups.',
      href: 'AI Assistant',
      roles: ['Coordinator', 'Manager', 'Actionist', 'Viewer'],
    },
    {
      title: 'Letter Analysis',
      detail: 'Priority, risks, and suggested actions on a letter.',
      href: 'Letter Analysis',
      roles: ['Management', 'Admin'],
    },
    {
      title: 'AI Insights',
      detail: 'Management-facing patterns across correspondence.',
      href: 'AI Insights',
      roles: ['Management', 'Admin'],
    },
    {
      title: 'OCR on Create',
      detail: 'Extract fields from scans during registration.',
      href: 'Create',
      roles: ['Coordinator'],
    },
  ]
  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-slate-600">
        AI assists intake and discovery — it does not replace role-based workflow approval. LLM analysis beyond
        OCR is gated to <RoleName name="Management" /> and <RoleName name="Admin" />.
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
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-bold text-slate-800">{item.title}</p>
                <RoleChips roles={item.roles} />
              </div>
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
  log: { roles: string[]; text: string }[]
  onAction: (action: PracticeAction) => void
  onReset: () => void
}) {
  const step = PRACTICE_STEPS.find((s) => s.status === status) ?? PRACTICE_STEPS[0]
  const done = step.actions.length === 0
  const activeRoles = step.actions[0]?.roles ?? []

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-slate-600">
        Click through a sample letter. Each button shows the role(s) that perform that step — including marking
        Information vs Actionable.
      </p>
      <RoleLegend />
      <div className="rounded-lg border border-slate-200 bg-[#0d3763] p-4 text-white">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-200/80">Sample letter</p>
          <Badge tone="blue">{status.replace('-Info', ' (Info)')}</Badge>
        </div>
        <p className="text-sm font-semibold">SUPARCO / Coordination — Budget clarification request</p>
        <p className="mt-2 text-xs leading-5 text-blue-100/85">{step.prompt}</p>
        {activeRoles.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-200/70">Act as</span>
            <RoleChips roles={activeRoles} />
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {step.actions.map((action) => {
          const accent = getRoleColor(action.roles[0] ?? 'Coordinator')
          return (
            <Button
              key={action.id}
              size="sm"
              onClick={() => onAction(action)}
              style={{ backgroundColor: accent.hex, borderColor: accent.hex }}
            >
              <Play data-icon="inline-start" />
              {action.label}
              <span className="ml-1.5 inline-flex gap-1">
                {action.roles.map((role) => (
                  <span
                    key={role}
                    className="rounded px-1 py-px text-[10px] font-bold"
                    style={{ backgroundColor: 'rgba(255,255,255,0.22)' }}
                  >
                    {role}
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
          Journey complete for this path. Restart and choose the other marking option to see both flows.
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
                <RoleChips roles={entry.roles} />
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
    case 'roles':
      return (
        <RolesChapter
          selectedRole={progress.selectedRole}
          onSelectRole={(role) => setProgress((prev) => ({ ...prev, selectedRole: role }))}
        />
      )
    case 'register':
      return <RegisterChapter go={go} />
    case 'marking':
      return <MarkingChapter />
    case 'routing':
      return <RoutingChapter />
    case 'action-items':
      return <ActionItemsChapter go={go} />
    case 'response':
      return <ResponseChapter />
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
                  roles: action.roles,
                  text: `${action.label} → ${action.nextStatus.replace('-Info', '')}. ${action.note}`,
                },
              ],
            }))
          }
          onReset={() =>
            setProgress((prev) => ({
              ...prev,
              practiceStatus: 'Registered',
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
        description="Interactive walkthrough of roles, letter marking, action items, and the full correspondence workflow."
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
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition ${
                    active ? 'bg-blue-50 text-[#0d3763]' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span
                    className={`flex size-6 shrink-0 items-center justify-center rounded-md ${
                      done ? 'bg-emerald-100 text-emerald-700' : active ? 'bg-[#0d3763] text-white' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {done ? <CheckCircle2 className="size-3.5" /> : <ItemIcon className="size-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-xs ${active ? 'font-bold' : 'font-medium'}`}>
                      {index + 1}. {item.title}
                    </span>
                    <span className="block truncate text-[10px] text-slate-400">{item.minutes} min</span>
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
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.22 }}
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
