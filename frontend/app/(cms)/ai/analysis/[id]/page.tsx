'use client'

import { use } from 'react'
import { PageTitle } from '@/components/cms/ui'
import { LetterAnalysisPage } from '@/components/ai/pages'
import { useGo } from '@/hooks/use-go'

export default function LetterAnalysisIdRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const go = useGo()
  return (
    <>
      <PageTitle title="Letter Analysis" description="Timeline, delays and relationship analysis for selected correspondence." />
      <LetterAnalysisPage selectedId={id} go={go} />
    </>
  )
}
