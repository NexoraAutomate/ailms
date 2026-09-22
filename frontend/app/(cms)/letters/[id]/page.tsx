'use client'

import { use } from 'react'
import { Details } from '@/components/cms/letter-details'
import { useGo } from '@/hooks/use-go'

export default function LetterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const go = useGo()
  return <Details id={id} go={go} />
}
