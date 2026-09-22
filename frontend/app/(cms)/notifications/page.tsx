'use client'

import { Notifications } from '@/components/cms/notifications-page'
import { useGo } from '@/hooks/use-go'

export default function NotificationsRoute() {
  const go = useGo()
  return <Notifications go={go} />
}
