'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useAppData } from '@/components/app-provider'
import { Button } from '@/components/ui/button'
import { Badge, Card, PageTitle } from '@/components/cms/ui'
import { FormDialog } from '@/components/cms/management-table'

export function MasterData() {
  const { masterData, addMasterValue } = useAppData()
  const tabs = Object.keys(masterData)
  const [tab, setTab] = useState(tabs[0] ?? 'Letter Types')
  const [open, setOpen] = useState(false)
  const current = masterData[tab] ?? []
  return (
    <>
      <PageTitle title="Master Data" description="Manage reusable reference values used across the system." action={<Button onClick={() => setOpen(true)}><Plus data-icon="inline-start" />Add value</Button>} />
      <Card>
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200 p-3">
          {tabs.map((t) => (
            <button onClick={() => setTab(t)} className={`whitespace-nowrap rounded-md px-3 py-2 text-xs ${tab === t ? 'bg-blue-50 font-semibold text-[#1769aa]' : 'text-slate-500 hover:bg-slate-50'}`} key={t}>{t}</button>
          ))}
        </div>
        <div className="p-4">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-400">
              <tr><th className="px-4 py-3">Value</th><th className="px-4 py-3">Status</th></tr>
            </thead>
            <tbody>
              {current.map((v) => (
                <tr className="border-t border-slate-100 text-xs" key={v}>
                  <td className="px-4 py-3 font-semibold text-slate-700">{v}</td>
                  <td className="px-4 py-3"><Badge tone="green">Active</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {open && <FormDialog title={`Add ${tab} value`} fields={[{ name: 'value', label: 'Value' }]} onClose={() => setOpen(false)} onSubmit={(values) => addMasterValue(tab, values.value)} />}
    </>
  )
}
