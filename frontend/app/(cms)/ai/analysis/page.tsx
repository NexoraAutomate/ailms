'use client'

import { PageTitle } from '@/components/cms/ui'
import { LetterAnalysisPage } from '@/components/ai/pages'
import { useGo } from '@/hooks/use-go'

export default function LetterAnalysisRoute() {
  const go = useGo()
  return (
    <>
      <PageTitle title="Letter Analysis" description="Timeline, delays and relationship analysis for selected correspondence." />
      <LetterAnalysisPage go={go} />
    </>
  )
}
