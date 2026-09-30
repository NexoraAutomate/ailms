'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Legacy path — redirects to Catalog. */
export default function Page() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/letters/catalog')
  }, [router])
  return null
}
