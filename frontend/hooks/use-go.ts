'use client'

import { useRouter } from 'next/navigation'
import { useCallback } from 'react'
import { resolveNavHref } from '@/lib/cms-nav'

/** Drop-in replacement for the monolith Workspace go() helper. */
export function useGo() {
  const router = useRouter()
  return useCallback(
    (target: string) => {
      router.push(resolveNavHref(target))
    },
    [router],
  )
}
