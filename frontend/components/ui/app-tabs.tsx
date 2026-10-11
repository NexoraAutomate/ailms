'use client'

import type { ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'

const tabFade = { duration: 0.15, ease: 'easeOut' as const }

/** Shared pill tab styles matching the letter detail page. */
export function appTabClass(active: boolean, className?: string) {
  return cn(
    'flex shrink-0 items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-semibold transition-colors',
    active
      ? 'border-slate-500 bg-slate-500 text-white'
      : 'border-slate-300 bg-slate-100 text-slate-600 hover:border-slate-400 hover:bg-slate-300 hover:text-slate-800',
    className,
  )
}

export function AppTabList({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mb-5 flex gap-2 overflow-x-auto pb-1', className)}>{children}</div>
}

/** Quick fade in/out when switching tab panels. */
export function AppTabPanel({ tabKey, children, className }: { tabKey: string; children: ReactNode; className?: string }) {
  const reduceMotion = useReducedMotion()
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={tabKey}
        className={className}
        initial={reduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={reduceMotion ? undefined : { opacity: 0 }}
        transition={tabFade}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
