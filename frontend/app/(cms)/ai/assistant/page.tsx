'use client'

import { PageTitle } from '@/components/cms/ui'
import { AIAssistant } from '@/components/ai/pages'
import { useGo } from '@/hooks/use-go'

export default function AiAssistantPage() {
  const go = useGo()
  return (
    <>
      <PageTitle title="AI Assistant" description="Ask questions about the correspondence register. Responses are mock, advisory intelligence." />
      <AIAssistant go={go} />
    </>
  )
}
