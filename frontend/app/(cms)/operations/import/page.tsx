'use client'

import { useAppData } from '@/components/app-provider'
import { ImportCenterPage } from '@/components/cms/import-export'

export default function ImportRoute() {
  const { refresh } = useAppData()
  return <ImportCenterPage refresh={refresh} />
}
