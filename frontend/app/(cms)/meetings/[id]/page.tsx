'use client'

import { use } from 'react'
import { useAppData } from '@/components/app-provider'
import { MeetingDetailPage } from '@/components/cms/meetings-pages'
import { useGo } from '@/hooks/use-go'

export default function MeetingDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const go = useGo()
  const { letters } = useAppData()
  return <MeetingDetailPage id={id} go={go} letters={letters} />
}
