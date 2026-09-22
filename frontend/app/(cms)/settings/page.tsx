'use client'

import { useAppData } from '@/components/app-provider'
import { SettingsHub } from '@/components/admin/settings-hub'
import { useGo } from '@/hooks/use-go'

export default function SettingsRoute() {
  const go = useGo()
  const { users, settings, masterData, refresh, updateSettings, addUser, addMasterValue } = useAppData()
  return (
    <SettingsHub
      initialTab="users"
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
