'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { looksLikeNaturalQuery, naturalLanguageSearch, type InterpretedQuery } from '@/services/ai'
import { useAppData } from '@/components/app-provider'

type CmsSearchContextValue = {
  query: string
  setQuery: (value: string) => void
  aiSearch: InterpretedQuery | null
  clearAi: () => void
}

const CmsSearchContext = createContext<CmsSearchContextValue | null>(null)

export function CmsSearchProvider({ children }: { children: React.ReactNode }) {
  const { letters } = useAppData()
  const pathname = usePathname()
  const router = useRouter()
  const [query, setQueryState] = useState('')
  const [aiSearch, setAiSearch] = useState<InterpretedQuery | null>(null)

  const setQuery = useCallback(
    (value: string) => {
      setQueryState(value)
      // Match prior Workspace behavior: NL search always opens the full letter list.
      if (looksLikeNaturalQuery(value) && pathname !== '/letters') {
        router.push('/letters')
      }
    },
    [pathname, router],
  )

  const clearAi = useCallback(() => {
    setAiSearch(null)
    setQueryState('')
  }, [])

  useEffect(() => {
    if (!looksLikeNaturalQuery(query)) {
      setAiSearch(null)
      return
    }
    let active = true
    naturalLanguageSearch(query, letters).then((result) => {
      if (active) setAiSearch(result)
    })
    return () => {
      active = false
    }
  }, [query, letters])

  const value = useMemo(
    () => ({ query, setQuery, aiSearch, clearAi }),
    [query, setQuery, aiSearch, clearAi],
  )

  return <CmsSearchContext.Provider value={value}>{children}</CmsSearchContext.Provider>
}

export function useCmsSearch() {
  const ctx = useContext(CmsSearchContext)
  if (!ctx) throw new Error('useCmsSearch must be used within CmsSearchProvider')
  return ctx
}
