'use client'

import { useId, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Maximize2, Minimize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type CollapsibleCardProps = {
  title: ReactNode
  description?: string
  /** Extra controls in the header (e.g. status badge, secondary actions). */
  headerAside?: ReactNode
  /** Kept visible in the header; clicks do not toggle expand/collapse. */
  action?: ReactNode
  defaultExpanded?: boolean
  className?: string
  contentClassName?: string
  children: ReactNode
}

const expandTransition = {
  height: { type: 'spring' as const, stiffness: 420, damping: 38, mass: 0.85 },
  opacity: { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const },
  y: { type: 'spring' as const, stiffness: 420, damping: 38, mass: 0.85 },
}

const reduceTransition = {
  height: { duration: 0.01 },
  opacity: { duration: 0.01 },
  y: { duration: 0.01 },
}

export function CollapsibleCard({
  title,
  description,
  headerAside,
  action,
  defaultExpanded = true,
  className,
  contentClassName,
  children,
}: CollapsibleCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const reduceMotion = useReducedMotion()
  const panelId = useId()
  const transition = reduceMotion ? reduceTransition : expandTransition

  return (
    <motion.section
      layout={!reduceMotion}
      className={cn(
        'overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm',
        'transition-[box-shadow,border-color] duration-300',
        expanded ? 'border-slate-200 shadow-sm' : 'border-slate-200/90 shadow-none',
        className,
      )}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setExpanded((v) => !v)
          }
        }}
        className="flex cursor-pointer flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 transition-colors hover:bg-slate-50/80 sm:px-5"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {typeof title === 'string' ? (
              <h2 className="text-sm font-bold text-slate-700">{title}</h2>
            ) : (
              title
            )}
            {headerAside}
          </div>
          {description ? <p className="mt-0.5 text-xs text-slate-400">{description}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {action ? (
            <div
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              {action}
            </div>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={(e) => {
              e.stopPropagation()
              setExpanded((v) => !v)
            }}
            aria-expanded={expanded}
            aria-controls={panelId}
            aria-label={expanded ? 'Minimize' : 'Expand'}
            title={expanded ? 'Minimize' : 'Expand'}
          >
            <motion.span
              key={expanded ? 'min' : 'max'}
              initial={reduceMotion ? false : { opacity: 0, scale: 0.7, rotate: -40 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 28 }}
              className="inline-flex"
            >
              {expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            </motion.span>
          </Button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            id={panelId}
            key="content"
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1, y: 0 }}
            exit={reduceMotion ? { height: 0, opacity: 0 } : { height: 0, opacity: 0, y: -6 }}
            transition={transition}
            className="overflow-hidden"
          >
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { delay: 0.04, duration: 0.28, ease: [0.22, 1, 0.36, 1] }
              }
              className={cn('p-4 sm:p-5', contentClassName)}
            >
              {children}
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.section>
  )
}
