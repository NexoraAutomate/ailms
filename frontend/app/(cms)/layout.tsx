'use client'

import { AppDataProvider } from '@/components/app-provider'
import { CmsSearchProvider } from '@/components/cms/search-context'
import { CmsShell } from '@/components/cms/shell'

export default function CmsLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppDataProvider>
      <CmsSearchProvider>
        <CmsShell>{children}</CmsShell>
      </CmsSearchProvider>
    </AppDataProvider>
  )
}
