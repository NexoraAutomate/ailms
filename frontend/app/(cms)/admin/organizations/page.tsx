'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function OrganizationsRoute() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/settings/definitions')
  }, [router])
  return <p className="p-6 text-sm text-slate-500">Redirecting to Settings → Definitions…</p>
}
