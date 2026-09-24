'use client'

import { use } from 'react'
import { RegistrationReview } from '@/components/ai/registration-review'
import { useGo } from '@/hooks/use-go'

export default function AiRegistrationReviewPage({
  params,
}: {
  params: Promise<{ jobId: string }>
}) {
  const { jobId } = use(params)
  const go = useGo()
  return <RegistrationReview jobId={jobId} go={go} />
}
