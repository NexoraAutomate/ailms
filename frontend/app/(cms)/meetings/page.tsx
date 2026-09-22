'use client'

import { MeetingsPage } from '@/components/cms/meetings-pages'
import { useGo } from '@/hooks/use-go'

export default function MeetingsRoute() {
  const go = useGo()
  return <MeetingsPage go={go} />
}
