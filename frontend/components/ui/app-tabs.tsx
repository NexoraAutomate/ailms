'use client'

import {
  createContext,
  useContext,
  useId,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'

const tabFade = { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const }

const TabListContext = createContext<string | null>(null)

/**
 * Standalone pill styles (lists that are not wrapped in AppTabList).
 * Prefer AppTab + AppTabList for connected segmented tabs with a sliding indicator.
 */
export function appTabClass(active: boolean, className?: string) {
  return cn(
    'flex shrink-0 items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-semibold transition-all duration-200',
    active
      ? 'border-[#0d3763] bg-gradient-to-b from-[#134a7c] to-[#0d3763] text-white shadow-md shadow-[#0d3763]/25'
      : 'border-slate-300 bg-white text-slate-600 hover:border-[#0d3763]/45 hover:bg-slate-50 hover:text-[#0d3763]',
    className,
  )
}

/** Connected segmented track — tabs sit flush inside one control. */
export function AppTabList({
  children,
  className,
  groupId,
}: {
  children: ReactNode
  className?: string
  /** Isolates the sliding pill when multiple tab lists are on one page. */
  groupId?: string
}) {
  const autoId = useId()
  return (
    <TabListContext.Provider value={groupId ?? autoId}>
      <div
        role="tablist"
        className={cn(
          'mb-5 inline-flex max-w-full items-center overflow-x-auto rounded-xl border border-[#0d3763]/18 bg-gradient-to-b from-[#e8eef5] to-[#d5dee9] p-1 shadow-[inset_0_1px_2px_rgba(13,55,99,0.08)]',
          className,
        )}
      >
        {children}
      </div>
    </TabListContext.Provider>
  )
}

type AppTabProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active: boolean
}

/** Tab trigger with sliding active pill (must be inside AppTabList). */
export function AppTab({ active, className, children, type = 'button', ...props }: AppTabProps) {
  const group = useContext(TabListContext)
  const reduceMotion = useReducedMotion()
  const pillId = group ? `app-tab-pill-${group}` : 'app-tab-pill'

  return (
    <button
      type={type}
      role="tab"
      aria-selected={active}
      className={cn(
        'relative z-10 flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors duration-200',
        active ? 'text-white' : 'text-slate-600 hover:bg-white/50 hover:text-[#0d3763]',
        className,
      )}
      {...props}
    >
      {active ? (
        <motion.span
          layoutId={pillId}
          className="absolute inset-0 -z-10 rounded-lg bg-gradient-to-b from-[#134a7c] to-[#0d3763] shadow-md shadow-[#0d3763]/30"
          transition={
            reduceMotion
              ? { duration: 0 }
              : { type: 'spring', stiffness: 420, damping: 34, mass: 0.7 }
          }
        />
      ) : null}
      {children}
    </button>
  )
}

/** Fade + slight slide when switching tab panels. */
export function AppTabPanel({
  tabKey,
  children,
  className,
}: {
  tabKey: string
  children: ReactNode
  className?: string
}) {
  const reduceMotion = useReducedMotion()
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={tabKey}
        className={className}
        initial={reduceMotion ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
        transition={tabFade}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
