'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import { Building2, FileInput, FileOutput, Forward, Sparkles } from 'lucide-react'

export type LetterFlowStep = {
  title: string
  detail: string
  icon: React.ReactNode
}

const DEFAULT_STEPS: LetterFlowStep[] = [
  {
    title: 'Letter registered',
    detail: 'Incoming correspondence captured with OCR & metadata.',
    icon: <FileInput className="size-3.5" />,
  },
  {
    title: 'Routed to Coordination',
    detail: 'AI suggests owning department and priority.',
    icon: <Building2 className="size-3.5" />,
  },
  {
    title: 'Forwarded to Finance',
    detail: 'Cross-department handoff with linked trail.',
    icon: <Forward className="size-3.5" />,
  },
  {
    title: 'Smart analysis',
    detail: 'Artificial Intelligence extracts actions & risks.',
    icon: <Sparkles className="size-3.5" />,
  },
  {
    title: 'Response dispatched',
    detail: 'Outgoing reply issued and status closed.',
    icon: <FileOutput className="size-3.5" />,
  },
]

const slideVariants: Variants = {
  enter: (dir: number) => ({ x: dir >= 0 ? 40 : -40, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir >= 0 ? -30 : 30, opacity: 0 }),
}

export default function LetterFlowStepper({
  steps = DEFAULT_STEPS,
  intervalMs = 2800,
  className = '',
}: {
  steps?: LetterFlowStep[]
  intervalMs?: number
  className?: string
}) {
  const [current, setCurrent] = useState(0)
  const [direction, setDirection] = useState(1)

  useEffect(() => {
    const id = setInterval(() => {
      setDirection(1)
      setCurrent((prev) => (prev + 1) % steps.length)
    }, intervalMs)
    return () => clearInterval(id)
  }, [intervalMs, steps.length])

  return (
    <div className={`w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-white/15 bg-white/5 p-3 sm:p-4 backdrop-blur-sm ${className}`.trim()}>
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-200/70">Letter flow</p>

      <div className="mb-4 flex w-full min-w-0 items-center">
        {steps.map((step, index) => {
          const status = current === index ? 'active' : current > index ? 'complete' : 'inactive'
          const isLast = index === steps.length - 1
          return (
            <div key={step.title} className={`flex min-w-0 items-center ${isLast ? 'shrink-0' : 'flex-1'}`}>
              <motion.button
                type="button"
                aria-label={step.title}
                onClick={() => {
                  setDirection(index > current ? 1 : -1)
                  setCurrent(index)
                }}
                animate={status}
                initial={false}
                variants={{
                  inactive: { backgroundColor: 'rgba(255,255,255,0.12)', color: 'rgba(186,230,253,0.55)' },
                  active: { backgroundColor: '#38bdf8', color: '#0c4a6e' },
                  complete: { backgroundColor: '#0ea5e9', color: '#e0f2fe' },
                }}
                className="relative z-[1] flex size-6 shrink-0 items-center justify-center rounded-full sm:size-7"
              >
                {status === 'complete' ? (
                  <svg className="size-3 sm:size-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <motion.path
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 0.35 }}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                ) : status === 'active' ? (
                  <span className="size-2 rounded-full bg-[#0d3763]" />
                ) : (
                  <span className="text-[10px] font-bold">{index + 1}</span>
                )}
              </motion.button>
              {!isLast && (
                <div className="relative mx-0.5 h-0.5 min-w-0 flex-1 overflow-hidden rounded bg-white/15 sm:mx-1">
                  <motion.div
                    className="absolute inset-y-0 left-0 bg-sky-400"
                    initial={false}
                    animate={{ width: current > index ? '100%' : '0%' }}
                    transition={{ duration: 0.4 }}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="relative min-h-[4.25rem] overflow-hidden">
        <AnimatePresence initial={false} mode="wait" custom={direction}>
          <motion.div
            key={current}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.35 }}
            className="flex min-w-0 items-start gap-3"
          >
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-sky-400/20 text-sky-200">
              {steps[current].icon}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold break-words text-white">{steps[current].title}</p>
              <p className="mt-1 text-xs leading-relaxed break-words text-blue-100/75">{steps[current].detail}</p>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
