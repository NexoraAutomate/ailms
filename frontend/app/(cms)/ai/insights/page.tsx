'use client'

import { PageTitle } from '@/components/cms/ui'
import { AIInsightsPage } from '@/components/ai/pages'
import { useGo } from '@/hooks/use-go'

export default function AiInsightsRoute() {
  const go = useGo()
  return (
    <>
      <PageTitle title="AI Insights" description="Operational, risk and management observations generated from the current register." />
      <AIInsightsPage go={go} />
    </>
  )
}
