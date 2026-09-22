'use client'

import { Register } from '@/components/cms/register-letter'
import { useGo } from '@/hooks/use-go'

export default function RegisterPage() {
  const go = useGo()
  return <Register go={go} />
}
