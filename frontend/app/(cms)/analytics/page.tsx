'use client'

import { Suspense } from 'react'
import { Analytics } from '@/components/cms/analytics'

export default function AnalyticsRoute() {
  return (
    <Suspense fallback={<div className="p-6 text-xs text-slate-400">Loading analytics…</div>}>
      <Analytics />
    </Suspense>
  )
}
