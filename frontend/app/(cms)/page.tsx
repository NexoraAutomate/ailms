'use client'

import { Dashboard } from '@/components/cms/dashboard'
import { useGo } from '@/hooks/use-go'

export default function DashboardPage() {
  const go = useGo()
  return <Dashboard go={go} />
}
