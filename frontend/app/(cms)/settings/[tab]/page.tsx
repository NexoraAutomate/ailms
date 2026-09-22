'use client'

import { use } from 'react'
import { useAppData } from '@/components/app-provider'
import { SettingsHub } from '@/components/admin/settings-hub'
import { useGo } from '@/hooks/use-go'

type Tab = 'users' | 'roles' | 'access' | 'status' | 'alerts' | 'security' | 'definitions' | 'backup'

export default function SettingsTabRoute({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = use(params)
  const go = useGo()
  const { users, settings, masterData, refresh, updateSettings, addUser, addMasterValue } = useAppData()
  const initialTab = (['users', 'roles', 'access', 'status', 'alerts', 'security', 'definitions', 'backup'].includes(tab) ? tab : 'users') as Tab
  return (
    <SettingsHub
      initialTab={initialTab}
      users={users}
      settings={settings}
      masterData={masterData}
      onRefresh={refresh}
      onUpdateSettings={updateSettings}
      onAddUser={addUser}
      onAddMaster={addMasterValue}
      go={go}
    />
  )
}
