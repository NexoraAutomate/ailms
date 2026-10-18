'use client'

import { Fragment, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { UserAvatar } from '@/components/ui/user-avatar'
import { Button } from '@/components/ui/button'

export type HandlerTaskDetail = {
  action: string
  actionLabel: string
  fromStatus?: string
  toStatus?: string
  remarks?: string
  performedBy?: string
  assignedTo?: string
  department?: string
  createdAt?: string
}

export type AnimatedProgressStep = {
  id: string
  /** Person display name */
  title: string
  /** Department name shown under the person */
  department?: string
  /** Short task label (clickable) */
  task?: string
  /** Full task payload for the detail dialog */
  taskDetail?: HandlerTaskDetail
  /** Preformatted average response time, e.g. "Avg 2d 4h" */
  avgResponseLabel?: string
  avgResponseHours?: number | null
  /**
   * Time this user spent on *this* letter before the next handler
   * (shown on the connector line after this node).
   */
  letterDurationLabel?: string
  letterDurationHours?: number | null
  /** Circular avatar image URL (app profile photo when available) */
  avatarUrl: string
  /** Initials fallback if the image fails */
  initials?: string
}

type AnimatedProgressStepperProps = {
  steps: AnimatedProgressStep[]
  /** Zero-based index of the person currently working the letter. */
  currentStep: number
  className?: string
  /** Optional footer; omit to hide the "Currently working" line. */
  footerLabel?: string
  /** Logged-in user display name — when it matches the current holder, show a YOU badge. */
  viewerName?: string
  /**
   * When the visible window is truncated (e.g. last 3 of a longer chain),
   * show a faded lead-in for earlier unmarked officials.
   */
  priorCount?: number
  /**
   * Insert the "+N earlier" lead before this step index.
   * Use 1 when the initiator is always step 0 and truncated markings follow.
   */
  priorLeadAfterIndex?: number
}

const SMOOTH = { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const }

function StepAvatar({
  step,
  done,
  current,
  pending,
}: {
  step: AnimatedProgressStep
  done: boolean
  current: boolean
  pending: boolean
}) {
  return (
    <div className="relative flex size-11 items-center justify-center sm:size-12">
      {current ? (
        <>
          <span className="absolute inset-0 animate-ping rounded-full bg-[#1769aa]/35" />
          <span className="absolute -inset-1 animate-pulse rounded-full ring-2 ring-[#1769aa]/45" />
        </>
      ) : null}
      <div
        className={cn(
          'relative size-11 overflow-hidden rounded-full border bg-white sm:size-12',
          done && 'border-[#1769aa]',
          current && 'border-[#1769aa] shadow-[0_0_0_2px_rgba(23,105,170,0.2)]',
          pending && !current && 'border-slate-200 opacity-55 grayscale',
        )}
      >
        <UserAvatar
          name={step.title}
          avatarUrl={step.avatarUrl}
          size="xl"
          ring={false}
          className="size-full rounded-none text-sm"
          imgClassName="size-full rounded-none ring-0"
        />
      </div>
      {done ? (
        <span className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-[#1769aa] text-white shadow-sm">
          <Check className="size-2.5" strokeWidth={3} />
        </span>
      ) : null}
    </div>
  )
}

function TaskDialog({
  step,
  onClose,
}: {
  step: AnimatedProgressStep
  onClose: () => void
}) {
  const detail = step.taskDetail
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-800">Task details</h3>
            <p className="mt-1 text-xs text-slate-500">{step.title}</p>
          </div>
          <button type="button" className="text-slate-400 hover:text-slate-600" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <dl className="mt-4 space-y-3 text-xs">
          <div>
            <dt className="font-semibold text-slate-500">Task</dt>
            <dd className="mt-0.5 text-slate-800">{detail?.actionLabel || step.task || '—'}</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-500">Department</dt>
            <dd className="mt-0.5 text-slate-800">{detail?.department || step.department || '—'}</dd>
          </div>
          {detail?.fromStatus || detail?.toStatus ? (
            <div>
              <dt className="font-semibold text-slate-500">Status change</dt>
              <dd className="mt-0.5 text-slate-800">
                {detail.fromStatus || '—'} → {detail.toStatus || '—'}
              </dd>
            </div>
          ) : null}
          {detail?.performedBy ? (
            <div>
              <dt className="font-semibold text-slate-500">Performed by</dt>
              <dd className="mt-0.5 text-slate-800">{detail.performedBy}</dd>
            </div>
          ) : null}
          {detail?.assignedTo ? (
            <div>
              <dt className="font-semibold text-slate-500">Assigned to</dt>
              <dd className="mt-0.5 text-slate-800">{detail.assignedTo}</dd>
            </div>
          ) : null}
          {detail?.createdAt ? (
            <div>
              <dt className="font-semibold text-slate-500">When</dt>
              <dd className="mt-0.5 text-slate-800">{detail.createdAt}</dd>
            </div>
          ) : null}
          {step.avgResponseLabel ? (
            <div>
              <dt className="font-semibold text-slate-500">Average response time</dt>
              <dd className="mt-0.5 text-slate-800">{step.avgResponseLabel.replace(/^Avg\s+/i, '')}</dd>
            </div>
          ) : null}
          {step.letterDurationLabel ? (
            <div>
              <dt className="font-semibold text-slate-500">Time on this letter</dt>
              <dd className="mt-0.5 text-slate-800">{step.letterDurationLabel}</dd>
            </div>
          ) : null}
          <div>
            <dt className="font-semibold text-slate-500">Remarks</dt>
            <dd className="mt-0.5 whitespace-pre-wrap text-slate-800">{detail?.remarks?.trim() || 'No remarks recorded.'}</dd>
          </div>
        </dl>
        <div className="mt-5 flex justify-end">
          <Button size="sm" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * People pipeline: completed nodes are highlighted; current node pulses; future stay grey.
 */
function PriorLeadMarker({ priorCount }: { priorCount: number }) {
  return (
    <li
      className="relative flex w-10 shrink-0 flex-col items-center text-center sm:w-14"
      aria-label={`${priorCount} earlier marking${priorCount === 1 ? '' : 's'} in this chain`}
      title={`${priorCount} earlier marking${priorCount === 1 ? '' : 's'} in this chain`}
    >
      <div
        className="pointer-events-none absolute top-[22px] right-0 z-0 flex h-0 w-[140%] items-center sm:top-6"
        aria-hidden
      >
        <div className="h-px w-full bg-gradient-to-r from-transparent via-slate-200/80 to-slate-300" />
      </div>
      <div className="relative z-1 flex items-center gap-1 opacity-40">
        <span className="size-2 rounded-full bg-slate-300 sm:size-2.5" />
        <span className="size-2.5 rounded-full bg-slate-300/80 sm:size-3" />
        <span className="size-3 rounded-full border border-dashed border-slate-300 bg-slate-100 sm:size-3.5" />
      </div>
      <p className="mt-2.5 max-w-[3.5rem] text-[9px] font-medium leading-tight text-slate-400 sm:max-w-[4rem]">
        +{priorCount} earlier
      </p>
    </li>
  )
}

export function AnimatedProgressStepper({
  steps,
  currentStep,
  className,
  footerLabel,
  viewerName,
  priorCount = 0,
  priorLeadAfterIndex = 0,
}: AnimatedProgressStepperProps) {
  const [openStep, setOpenStep] = useState<AnimatedProgressStep | null>(null)
  const safeIndex = Math.max(0, Math.min(currentStep, Math.max(steps.length - 1, 0)))
  const active = useMemo(() => steps[safeIndex], [steps, safeIndex])
  const isYou = useMemo(() => {
    const viewer = (viewerName || '').trim().toLowerCase()
    const holder = (active?.title || '').trim().toLowerCase()
    return Boolean(viewer && holder && viewer === holder)
  }, [active?.title, viewerName])
  const showPriorLead = priorCount > 0
  const leadAt = Math.max(0, Math.min(priorLeadAfterIndex, steps.length))

  if (!steps.length) {
    return (
      <div className={cn('rounded-md border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-xs text-slate-400', className)}>
        No handlers recorded for this letter yet.
      </div>
    )
  }

  return (
    <div className={cn('w-full', className)}>
      <div className="-mx-1 overflow-x-auto px-1 sm:mx-0 sm:overflow-visible sm:px-0">
        <ol
          className="mx-auto flex w-full min-w-[min(100%,28rem)] max-w-4xl items-start justify-between gap-0 px-2 sm:min-w-0 sm:px-4 md:px-6"
        >
          {showPriorLead && leadAt === 0 ? <PriorLeadMarker priorCount={priorCount} /> : null}
          {steps.map((step, index) => {
            const done = index < safeIndex
            const current = index === safeIndex
            const pending = index > safeIndex
            const afterLineComplete = done

            return (
              <Fragment key={step.id}>
                {showPriorLead && leadAt === index && index > 0 ? (
                  <PriorLeadMarker priorCount={priorCount} />
                ) : null}
                <li className="relative flex min-w-0 flex-1 flex-col items-center text-center">
                  {index === leadAt && showPriorLead && leadAt === 0 ? (
                    <div
                      className="pointer-events-none absolute top-[22px] right-1/2 z-0 h-0 w-1/2 sm:top-6"
                      aria-hidden
                    >
                      <div className="h-px w-full bg-gradient-to-r from-slate-300/70 to-[#1769aa]/50" />
                    </div>
                  ) : null}
                  {index < steps.length - 1 ? (
                    <div
                      className="pointer-events-none absolute top-[22px] left-1/2 z-0 flex h-0 w-full items-center sm:top-6"
                      aria-hidden
                    >
                      <div
                        className={cn(
                          'h-px w-full',
                          afterLineComplete ? 'bg-[#1769aa]' : 'bg-slate-200',
                        )}
                      />
                      {step.letterDurationLabel ? (
                        <span
                          className={cn(
                            'absolute left-1/2 top-1/2 z-1 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-white px-1.5 py-0.5 text-[9px] font-semibold tabular-nums shadow-sm',
                            afterLineComplete
                              ? 'border-[#1769aa]/25 text-[#0d3763]'
                              : 'border-slate-200 text-slate-400',
                          )}
                          title={`Time on this letter: ${step.letterDurationLabel}`}
                        >
                          {step.letterDurationLabel}
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="relative z-1">
                    <StepAvatar step={step} done={done} current={current} pending={pending} />
                  </div>

                  <div className="mt-2.5 min-w-0 w-full max-w-[7.5rem] px-1 sm:max-w-[9rem]">
                    <p
                      className={cn(
                        'truncate text-[11px] font-semibold',
                        current ? 'text-[#0d3763]' : done ? 'text-slate-700' : 'text-slate-400',
                      )}
                      title={step.title}
                    >
                      {step.title}
                    </p>
                    {step.department ? (
                      <p className={cn('mt-0.5 truncate text-[10px]', current || done ? 'text-slate-500' : 'text-slate-400')} title={step.department}>
                        {step.department}
                      </p>
                    ) : null}
                    {step.avgResponseLabel ? (
                      <p
                        className={cn('mt-0.5 truncate text-[10px] tabular-nums', current || done ? 'font-medium text-slate-600' : 'text-slate-400')}
                        title={`Average response time: ${step.avgResponseLabel}`}
                      >
                        {step.avgResponseLabel}
                      </p>
                    ) : null}
                    {step.letterDurationLabel && index === steps.length - 1 ? (
                      <p
                        className={cn('mt-0.5 truncate text-[10px] tabular-nums', current ? 'font-medium text-[#1769aa]' : 'text-slate-500')}
                        title={`Time on this letter so far: ${step.letterDurationLabel}`}
                      >
                        Current: {step.letterDurationLabel}
                      </p>
                    ) : null}
                    {step.task ? (
                      <button
                        type="button"
                        onClick={() => setOpenStep(step)}
                        className={cn(
                          'mt-0.5 block w-full truncate text-[10px] underline-offset-2 hover:underline',
                          current || done ? 'font-medium text-[#1769aa]' : 'text-slate-400',
                        )}
                        title={`View task: ${step.task}`}
                      >
                        {step.task}
                      </button>
                    ) : null}
                  </div>
                </li>
              </Fragment>
            )
          })}
        </ol>
      </div>

      {footerLabel && active ? (
        <motion.div
          key={active.id}
          className="mt-4 flex justify-center px-2 sm:px-4"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={SMOOTH}
        >
          <p
            className={cn(
              'inline-flex max-w-full flex-wrap items-center justify-center gap-1.5 px-2.5 py-1 text-xs',
              isYou
                ? 'rounded-full border border-emerald-200 bg-emerald-50 font-medium text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300'
                : 'text-slate-500',
            )}
          >
            <span>{footerLabel}:</span>
            <span
              className={cn(
                'font-semibold',
                isYou ? 'text-emerald-900 dark:text-emerald-300' : 'text-[#0d3763]',
              )}
            >
              {active.title}
            </span>
            {isYou ? (
              <span className="rounded-full bg-emerald-200/80 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-emerald-900">
                YOU
              </span>
            ) : null}
            {active.task ? <span>· {active.task}</span> : null}
          </p>
        </motion.div>
      ) : null}

      {openStep ? <TaskDialog step={openStep} onClose={() => setOpenStep(null)} /> : null}
    </div>
  )
}

export { personInitials } from '@/components/ui/user-avatar'
