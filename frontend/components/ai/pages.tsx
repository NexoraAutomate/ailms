'use client'

import { useEffect, useMemo, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppData } from '@/components/app-provider'
import { AIAdvisoryNote, AIInsightCard, AIStatusIndicator, AiBadge, SectionCard } from '@/components/ai/common'
import { AIAnalysisPanel } from '@/components/ai/letter-tools'
import { assistantChat, assistantPromptLibrary, fetchAiStatus, generateManagementInsights, naturalLanguageSearch, type AiBackendStatus, type InterpretedQuery, type ManagementInsight } from '@/services/ai'
import type { Letter } from '@/services/letters'
import { formatDateTime } from '@/lib/datetime'

type ChatItem = {
  id: string
  role: 'user' | 'assistant'
  text: string
  time: string
  result?: InterpretedQuery
}

function nowLabel() {
  return formatDateTime(new Date())
}

export function AIAssistant({ go }: { go: (page: string) => void }) {
  const { letters, departmentPerformance } = useAppData()
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<'idle' | 'generating' | 'error'>('idle')
  const [messages, setMessages] = useState<ChatItem[]>([])
  const [aiBackend, setAiBackend] = useState<AiBackendStatus | null>(null)
  const prompts = assistantPromptLibrary()

  useEffect(() => {
    fetchAiStatus().then(setAiBackend)
  }, [])

  const ask = async (question: string) => {
    const q = question.trim()
    if (!q) return
    setInput('')
    setMessages((current) => [...current, { id: `u-${Date.now()}`, role: 'user', text: q, time: nowLabel() }])
    setStatus('generating')
    try {
      const chat = await assistantChat(q, letters)
      let text = chat.text
      let result = chat.result
      if (!result) {
        result = await naturalLanguageSearch(q, letters)
        text = result.summary
      }
      const workload = q.toLowerCase().includes('workload') || q.toLowerCase().includes('department')
      const extra = workload
        ? departmentPerformance.slice().sort((a, b) => b.pending - a.pending)[0]
        : null
      if (extra && !aiBackend?.enabled) {
        text = `${text} ${extra.name} currently has the highest pending workload (${extra.pending}).`
      }
      setMessages((current) => [...current, { id: `a-${Date.now()}`, role: 'assistant', text, time: nowLabel(), result }])
      setStatus('idle')
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[280px_1fr]">
      <SectionCard title="Suggested questions">
        {Object.entries(prompts).map(([group, items]) => (
          <div key={group} className="mb-4 last:mb-0">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">{group}</p>
            <div className="flex flex-col gap-1">
              {items.map((item) => (
                <button key={item} onClick={() => void ask(item)} className="rounded-md px-3 py-2 text-left text-xs text-slate-600 hover:bg-slate-50">{item}</button>
              ))}
            </div>
          </div>
        ))}
      </SectionCard>
      <section className="flex min-h-[520px] flex-col rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-700"><Sparkles className="size-4 text-[#1769aa]" /> AI Assistant</h2>
            <p className="text-[11px] text-slate-400">
              {aiBackend?.enabled ? `Live reasoning · ${aiBackend.provider} / ${aiBackend.model}` : 'Rule-based fallback (configure LLM_API_KEY in backend .env for live model)'}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setMessages([])}>Clear conversation</Button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {messages.length === 0 && <p className="text-sm text-slate-500">Ask about overdue items, department workload, or a specific organization. Answers use the configured LLM when available, otherwise local rule-based fallback.</p>}
          {messages.map((message) => (
            <div key={message.id} className={`max-w-3xl rounded-lg p-3 ${message.role === 'user' ? 'ml-auto bg-[#0d3763] text-white' : 'bg-slate-50'}`}>
              <div className="mb-1 flex items-center justify-between gap-3">
                <span className={`text-[10px] font-bold uppercase ${message.role === 'user' ? 'text-blue-100' : 'text-[#1769aa]'}`}>{message.role === 'user' ? 'You' : 'AI'}</span>
                <span className={`text-[10px] ${message.role === 'user' ? 'text-blue-100' : 'text-slate-400'}`}>{message.time}</span>
              </div>
              <p className={`text-xs leading-5 ${message.role === 'user' ? 'text-white' : 'text-slate-700'}`}>{message.text}</p>
              {message.result && (
                <div className="mt-3 rounded-md bg-white p-3">
                  <p className="text-[11px] font-semibold text-slate-500">Interpreted query</p>
                  <div className="mt-2 flex flex-wrap gap-1">{Object.entries(message.result.filters).map(([key, value]) => <AiBadge key={key}>{key} = {value}</AiBadge>)}</div>
                  {message.result.letters.length === 0 ? <p className="mt-3 text-xs text-slate-500">No matching correspondence found.</p> : (
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full min-w-[520px] text-left text-xs">
                        <thead className="text-[10px] uppercase text-slate-400"><tr><th className="py-2">Letter</th><th>Subject</th><th>Status</th></tr></thead>
                        <tbody>
                          {message.result.letters.slice(0, 8).map((letter) => (
                            <tr key={letter.id} className="border-t border-slate-100">
                              <td className="py-2"><button className="font-semibold text-[#1769aa]" onClick={() => go(letter.id)}>{letter.number}</button></td>
                              <td className="text-slate-600">{letter.subject}</td>
                              <td>{letter.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          <AIStatusIndicator status={status === 'generating' ? 'generating' : status === 'error' ? 'error' : 'idle'} />
        </div>
        <form className="flex gap-2 border-t border-slate-100 p-3" onSubmit={(e) => { e.preventDefault(); void ask(input) }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about correspondence..." className="h-10 flex-1 rounded-md border border-slate-200 px-3 text-xs" />
          <Button type="submit">Ask</Button>
        </form>
      </section>
    </div>
  )
}

export function AIInsightsPage({ go }: { go: (page: string) => void }) {
  const { letters, departmentPerformance } = useAppData()
  const [status, setStatus] = useState<'idle' | 'analyzing' | 'error'>('analyzing')
  const [insights, setInsights] = useState<ManagementInsight[]>([])
  useEffect(() => {
    generateManagementInsights(letters, departmentPerformance).then((rows) => { setInsights(rows); setStatus('idle') }).catch(() => setStatus('error'))
  }, [letters, departmentPerformance])
  const groups = ['Operational', 'Risk', 'Management'] as const
  return (
    <div className="space-y-6">
      <AIAdvisoryNote />
      <AIStatusIndicator status={status === 'analyzing' ? 'analyzing' : status === 'error' ? 'error' : 'idle'} />
      {groups.map((group) => (
        <div key={group}>
          <h2 className="mb-3 text-sm font-bold text-slate-700">{group} insights</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {insights.filter((item) => item.group === group).map((insight) => (
              <AIInsightCard key={insight.id} insight={insight} onView={(ids) => go(ids[0] ? ids[0] : 'All Letters')} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function AIManagementInsights({ go }: { go: (page: string) => void }) {
  const { letters, departmentPerformance } = useAppData()
  const [insights, setInsights] = useState<ManagementInsight[]>([])
  useEffect(() => {
    generateManagementInsights(letters, departmentPerformance).then((rows) => setInsights(rows.slice(0, 5)))
  }, [letters, departmentPerformance])
  return (
    <section className="mt-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-700"><Sparkles className="size-4 text-[#1769aa]" /> AI Management Insights</h2>
          <p className="text-xs text-slate-400">Advisory observations from the current register</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => go('AI Insights')}>Open AI Insights</Button>
      </div>
      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {insights.map((insight) => <AIInsightCard key={insight.id} insight={insight} onView={(ids) => go(ids[0] || 'Monitoring')} />)}
      </div>
    </section>
  )
}

export function LetterAnalysisPage({ selectedId, go }: { selectedId?: string; go: (page: string) => void }) {
  const { letters } = useAppData()
  const [id, setId] = useState(selectedId || letters[0]?.id || '')
  const letter = useMemo(() => letters.find((item) => item.id === id) ?? letters[0], [letters, id])
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[10px] font-bold uppercase text-slate-400">
          Select correspondence
          <select value={letter?.id ?? ''} onChange={(e) => setId(e.target.value)} className="h-10 min-w-72 rounded-md border border-slate-200 bg-white px-3 text-xs font-normal text-slate-700">
            {letters.map((item) => <option key={item.id} value={item.id}>{item.number} · {item.subject}</option>)}
          </select>
        </label>
        {letter && <Button variant="outline" size="sm" onClick={() => go(letter.id)}>Open letter</Button>}
      </div>
      {letter ? <AIAnalysisPanel letter={letter} letters={letters} /> : <AIStatusIndicator status="empty" />}
    </div>
  )
}

export function AISearchBanner({ result, onClear, go }: { result: InterpretedQuery | null; onClear: () => void; go: (page: string) => void }) {
  if (!result) return null
  return (
    <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50/60 p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-[#1769aa]">Interpreted query</p>
        <Button size="sm" variant="ghost" onClick={onClear}>Clear AI Search</Button>
      </div>
      <p className="text-xs text-slate-600">{result.summary}</p>
      <div className="mt-2 flex flex-wrap gap-1">{Object.entries(result.filters).map(([key, value]) => <AiBadge key={key} tone="blue">{key} = {value}</AiBadge>)}</div>
      {result.letters[0] && <button className="mt-2 text-[11px] font-semibold text-[#1769aa]" onClick={() => go(result.letters[0].id)}>Open first match</button>}
    </div>
  )
}

export type { Letter }
