'use client'

import { useGo } from '@/hooks/use-go'
import { useAppData } from '@/components/app-provider'
import { useCmsSearch } from '@/components/cms/search-context'
import { Database } from '@/components/cms/letter-database'

/** Shared letter-list route body for All Letters / Incoming / filters / etc. */
export function LetterListPage({ page }: { page: string }) {
  const go = useGo()
  const { refresh } = useAppData()
  const { query, aiSearch, clearAi } = useCmsSearch()
  return <Database page={page} query={query} go={go} aiSearch={aiSearch} onClearAi={clearAi} refresh={refresh} />
}
