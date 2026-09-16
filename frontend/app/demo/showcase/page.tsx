'use client'

import { FilePlus2, Sparkles, SquarePen } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  MockAiInsightsWall,
  MockAnalyticsStudio,
  MockDepartmentHeatmap,
  MockExecutiveCommand,
  MockMontageStrip,
  MockReportsCenter,
} from './mock-screens'
import './showcase.css'

/** Extended showcase (~78s). Original 20s trailer stays at /demo/video */
const SCENES = [
  { id: 'logo', ms: 3500 },
  { id: 'rise', ms: 4000 },
  { id: 'liveDashboard', ms: 4500 },
  { id: 'mockCommand', ms: 4500 },
  { id: 'mockAnalytics', ms: 4500 },
  { id: 'mockDepartments', ms: 4000 },
  { id: 'liveDashboardWide', ms: 4000 },
  { id: 'aiAssistant', ms: 4000 },
  { id: 'mockAiInsights', ms: 4500 },
  { id: 'search', ms: 3500 },
  { id: 'workflow', ms: 4000 },
  { id: 'mockReports', ms: 4000 },
  { id: 'ringNew', ms: 2500 },
  { id: 'ringUpdates', ms: 2500 },
  { id: 'chatInput', ms: 3500 },
  { id: 'chatTyping', ms: 2500 },
  { id: 'chatResponse', ms: 4500 },
  { id: 'featurePanels', ms: 5000 },
  { id: 'montage', ms: 4500 },
  { id: 'sparkle', ms: 2000 },
  { id: 'outro', ms: 3500 },
] as const

const TOTAL_MS = SCENES.reduce((a, s) => a + s.ms, 0)
type SceneId = (typeof SCENES)[number]['id']

function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden>
      <path
        d="M24 4c1.2 8 8.8 14.8 16 16-7.2 1.2-14.8 8-16 16-1.2-8-8.8-14.8-16-16 7.2-1.2 14.8-8 16-16Z"
        fill="currentColor"
      />
    </svg>
  )
}

function CosmicBackdrop() {
  return (
    <div className="cin-cosmic">
      <div className="cin-cosmic-grid" />
      <div className="cin-cosmic-beam" />
      <div className="cin-planet-arc" />
      <div className="cin-dust" />
    </div>
  )
}

function HeadlineBeam({ title = 'Smart Control', sub = 'Customized Dashboard' }: { title?: string; sub?: string }) {
  return (
    <div className="cin-beam-icon-row mb-3 flex flex-col items-center gap-2">
      <div className="relative h-8 w-32">
        <div className="absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-transparent via-sky-400/80 to-transparent" />
        <SparkleIcon className="cin-sparkle-icon absolute left-1/2 top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 text-sky-100" />
      </div>
      <p className="cin-headline-main">{title}</p>
      <p className="cin-headline-sub">{sub}</p>
    </div>
  )
}

function SceneLayer({ active, exiting, children }: { active: boolean; exiting: boolean; children: React.ReactNode }) {
  return <div className={`cin-scene ${active ? 'is-active' : ''} ${exiting ? 'is-exiting' : ''}`}>{children}</div>
}

function GlassImage({ src, alt = '', rise, camera = 'push' }: { src: string; alt?: string; rise?: boolean; camera?: 'push' | 'pan' }) {
  return (
    <div className={`cin-glass-window mx-auto w-[min(88vw,780px)] ${rise ? 'cin-glass-window-rise' : ''}`}>
      <div className={`overflow-hidden rounded-[17px] border border-white/10 bg-[#f5f8fb] ${camera === 'push' ? 'cin-camera-push' : 'cin-camera-pan-left'} max-h-[40vh]`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className="w-full object-cover object-top" />
      </div>
    </div>
  )
}

function GlassMock({ children, rise }: { children: React.ReactNode; rise?: boolean }) {
  return (
    <div className={`cin-glass-window mx-auto w-[min(88vw,780px)] ${rise ? 'cin-glass-window-rise' : ''}`}>
      <div className="cin-camera-push overflow-hidden rounded-[17px] border border-white/10">{children}</div>
    </div>
  )
}

function RingScene({ label, orbitIcons }: { label: string; orbitIcons?: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <div className="cin-ring-wrap">
        <svg className="cin-ring-svg" viewBox="0 0 200 200">
          <circle cx="100" cy="100" r="78" fill="none" stroke="rgba(56,189,248,0.35)" strokeWidth="2" />
          <circle cx="100" cy="100" r="58" fill="none" stroke="rgba(59,130,246,0.55)" strokeWidth="3" />
          {orbitIcons &&
            [0, 90, 180, 270].map((deg) => {
              const rad = (deg * Math.PI) / 180
              return (
                <circle
                  key={deg}
                  cx={100 + Math.cos(rad) * 78}
                  cy={100 + Math.sin(rad) * 78}
                  r="10"
                  fill="rgba(37,99,235,0.9)"
                  stroke="#7dd3fc"
                  strokeWidth="1.5"
                />
              )
            })}
        </svg>
        <div className="cin-ring-label">{label}</div>
      </div>
    </div>
  )
}

function WorkflowSteps() {
  return (
    <div className="mx-auto grid max-w-3xl grid-cols-3 gap-3 px-4">
      {[
        { step: '01', label: 'Register & assign', body: 'Capture correspondence with clear ownership.' },
        { step: '02', label: 'Approve & escalate', body: 'Reviewer cycles for sensitive items.' },
        { step: '03', label: 'Close with audit', body: 'Immutable trail for compliance.' },
      ].map((card) => (
        <div key={card.step} className="cin-step-card cin-glass rounded-xl p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#8fd0ff]">{card.step}</p>
          <p className="mt-2 text-sm font-semibold text-white">{card.label}</p>
          <p className="mt-1 text-[11px] text-slate-400">{card.body}</p>
        </div>
      ))}
    </div>
  )
}

function FeatureCarousel({ focus }: { focus: number }) {
  const panels = [
    { icon: Sparkles, title: 'AI Assistant', body: 'Natural-language operational intelligence.' },
    { icon: SquarePen, title: 'Workflow', body: 'Approvals, escalations, audit-ready actions.' },
    { icon: FilePlus2, title: 'Register', body: 'End-to-end incoming & outgoing letters.' },
  ]
  return (
    <div className="cin-carousel relative w-full">
      {panels.map((p, i) => {
        const pos = (i - focus + panels.length) % panels.length
        const slot = pos === 0 ? 'is-center' : pos === 1 ? 'is-right' : 'is-left'
        const Icon = p.icon
        return (
          <div key={p.title} className={`cin-carousel-panel ${slot}`}>
            <div className="flex size-14 items-center justify-center rounded-full border border-sky-400/40 bg-sky-500/20">
              <Icon className="size-7 text-sky-100" />
            </div>
            <p className="text-sm font-bold text-white">{p.title}</p>
            <p className="text-[11px] text-slate-400">{p.body}</p>
          </div>
        )
      })}
    </div>
  )
}

function SceneTitle({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div className="absolute inset-x-0 top-[6%] z-20 text-center">
      <p className="shw-scene-label">{kicker}</p>
      <h2 className="mt-2 text-xl font-bold text-white md:text-2xl">{title}</h2>
    </div>
  )
}

export default function ShowcaseVideoPage() {
  const [sceneIndex, setSceneIndex] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [recordMode, setRecordMode] = useState(false)
  const [prevIndex, setPrevIndex] = useState<number | null>(null)
  const [typed, setTyped] = useState('')
  const [carouselFocus, setCarouselFocus] = useState(0)
  const sceneStartRef = useRef(0)
  const scene = SCENES[sceneIndex]
  const prompt = 'How AILMS can help our leadership team?'

  const restart = useCallback(() => {
    setSceneIndex(0)
    setElapsed(0)
    setPrevIndex(null)
    setTyped('')
    setCarouselFocus(0)
    sceneStartRef.current = performance.now()
  }, [])

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('record') === '1') {
      setRecordMode(true)
      const t = window.setTimeout(() => void document.documentElement.requestFullscreen().catch(() => {}), 500)
      return () => window.clearTimeout(t)
    }
  }, [])

  useEffect(() => {
    sceneStartRef.current = performance.now()
  }, [sceneIndex])

  useEffect(() => {
    if (!playing) return
    let frame = 0
    const loop = (now: number) => {
      const sceneElapsed = now - sceneStartRef.current
      const totalBefore = SCENES.slice(0, sceneIndex).reduce((a, s) => a + s.ms, 0)
      setElapsed(totalBefore + Math.min(sceneElapsed, scene.ms))
      if (sceneElapsed >= scene.ms) {
        setPrevIndex(sceneIndex)
        if (sceneIndex + 1 >= SCENES.length) restart()
        else setSceneIndex(sceneIndex + 1)
        return
      }
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [playing, sceneIndex, scene.ms, restart])

  useEffect(() => {
    if (prevIndex === null) return
    const t = window.setTimeout(() => setPrevIndex(null), 450)
    return () => window.clearTimeout(t)
  }, [prevIndex, sceneIndex])

  useEffect(() => {
    if (scene.id !== 'chatInput') {
      setTyped('')
      return
    }
    setTyped('')
    let i = 0
    const tick = window.setInterval(() => {
      i += 1
      setTyped(prompt.slice(0, i))
      if (i >= prompt.length) window.clearInterval(tick)
    }, 38)
    return () => window.clearInterval(tick)
  }, [scene.id, sceneIndex, prompt])

  useEffect(() => {
    if (scene.id !== 'featurePanels') return
    setCarouselFocus(0)
    const t1 = window.setTimeout(() => setCarouselFocus(1), 900)
    const t2 = window.setTimeout(() => setCarouselFocus(2), 1800)
    const t3 = window.setTimeout(() => setCarouselFocus(0), 2700)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.clearTimeout(t3)
    }
  }, [scene.id, sceneIndex])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        e.preventDefault()
        setPlaying((p) => !p)
      }
      if (e.key === 'r' || e.key === 'R') restart()
      if (e.key === 'f' || e.key === 'F') {
        if (!document.fullscreenElement) void document.documentElement.requestFullscreen()
        else void document.exitFullscreen()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [restart])

  const globalProgress = useMemo(() => Math.min(100, (elapsed / TOTAL_MS) * 100), [elapsed])
  const isActive = (id: SceneId) => scene.id === id
  const isExiting = (id: SceneId) => prevIndex !== null && SCENES[prevIndex]?.id === id

  return (
    <div className="cin-root relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-[#020617]">
      <CosmicBackdrop />
      <p className="cin-watermark">AILMS · Extended showcase</p>

      <div className="cin-stage relative z-10">
        <SceneLayer active={isActive('logo')} exiting={isExiting('logo')}>
          <div className="flex h-full flex-col items-center justify-center">
            <div className="cin-logo-lockup flex items-center gap-3">
              <SparkleIcon className="cin-sparkle-icon size-10 text-sky-100 md:size-12" />
              <span className="text-4xl font-semibold text-sky-100 md:text-5xl">AILMS</span>
            </div>
            <p className="mt-4 text-sm text-slate-400">Correspondence Management System</p>
          </div>
        </SceneLayer>

        <SceneLayer active={isActive('rise')} exiting={isExiting('rise')}>
          <div className="flex h-full flex-col items-center justify-center px-4 pt-[8%]">
            <HeadlineBeam title="Enterprise correspondence" sub="One platform for every letter" />
            <GlassImage src="/demo/showcase/dashboard-live.png" rise />
          </div>
        </SceneLayer>

        <SceneLayer active={isActive('liveDashboard')} exiting={isExiting('liveDashboard')}>
          <SceneTitle kicker="Live workspace" title="Real dashboard — connected to PostgreSQL" />
          <div className="absolute inset-x-0 bottom-[5%] px-[4%]">
            <GlassImage src="/demo/showcase/dashboard-live.png" camera="push" />
          </div>
        </SceneLayer>

        <SceneLayer active={isActive('mockCommand')} exiting={isExiting('mockCommand')}>
          <SceneTitle kicker="Executive view" title="Leadership KPIs at a glance" />
          <div className="absolute inset-x-0 bottom-[4%] px-[3%]">
            <GlassMock rise>
              <MockExecutiveCommand />
            </GlassMock>
            <p className="shw-disclaimer mt-2 text-center">Illustrative metrics for demo storytelling</p>
          </div>
        </SceneLayer>

        <SceneLayer active={isActive('mockAnalytics')} exiting={isExiting('mockAnalytics')}>
          <SceneTitle kicker="Analytics" title="Trends, SLA, and register intelligence" />
          <div className="absolute inset-x-0 bottom-[4%] px-[3%]">
            <GlassMock>
              <MockAnalyticsStudio />
            </GlassMock>
          </div>
        </SceneLayer>

        <SceneLayer active={isActive('mockDepartments')} exiting={isExiting('mockDepartments')}>
          <SceneTitle kicker="Operations" title="Department workload & bottlenecks" />
          <div className="absolute inset-x-0 bottom-[4%] px-[3%]">
            <GlassMock>
              <MockDepartmentHeatmap />
            </GlassMock>
          </div>
        </SceneLayer>

        <SceneLayer active={isActive('liveDashboardWide')} exiting={isExiting('liveDashboardWide')}>
          <div className="relative flex h-full items-center justify-center">
            <p className="cin-brand-watermark">AILMS</p>
            <div className="absolute inset-x-[6%] top-[18%] opacity-25 blur-sm">
              <GlassImage src="/demo/showcase/dashboard.png" />
            </div>
            <div className="relative z-10 w-[min(75vw,680px)]">
              <GlassImage src="/demo/showcase/dashboard-live.png" />
            </div>
          </div>
        </SceneLayer>

        <SceneLayer active={isActive('aiAssistant')} exiting={isExiting('aiAssistant')}>
          <SceneTitle kicker="AI Intelligence" title="Ask management questions in plain language" />
          <div className="absolute inset-x-0 bottom-[5%] px-[4%]">
            <GlassImage src="/demo/showcase/ai-assistant.png" camera="pan" />
          </div>
        </SceneLayer>

        <SceneLayer active={isActive('mockAiInsights')} exiting={isExiting('mockAiInsights')}>
          <SceneTitle kicker="AI Insights" title="Advisory observations for leadership" />
          <div className="absolute inset-x-0 bottom-[4%] px-[3%]">
            <GlassMock>
              <MockAiInsightsWall />
            </GlassMock>
          </div>
        </SceneLayer>

        <SceneLayer active={isActive('search')} exiting={isExiting('search')}>
          <SceneTitle kicker="Natural language" title="Search the register by intent" />
          <div className="absolute inset-x-0 bottom-[5%] px-[4%]">
            <GlassImage src="/demo/showcase/letter-database.png" />
          </div>
        </SceneLayer>

        <SceneLayer active={isActive('workflow')} exiting={isExiting('workflow')}>
          <SceneTitle kicker="Accountability" title="Register · Review · Resolve" />
          <div className="flex h-full flex-col justify-center pt-[12%]">
            <WorkflowSteps />
          </div>
        </SceneLayer>

        <SceneLayer active={isActive('mockReports')} exiting={isExiting('mockReports')}>
          <SceneTitle kicker="Management" title="Reports & export center" />
          <div className="absolute inset-x-0 bottom-[4%] px-[3%]">
            <GlassMock>
              <MockReportsCenter />
            </GlassMock>
          </div>
        </SceneLayer>

        <SceneLayer active={isActive('ringNew')} exiting={isExiting('ringNew')}>
          <RingScene label="New" />
        </SceneLayer>
        <SceneLayer active={isActive('ringUpdates')} exiting={isExiting('ringUpdates')}>
          <RingScene label="New Updates" orbitIcons />
        </SceneLayer>

        <SceneLayer active={isActive('chatInput')} exiting={isExiting('chatInput')}>
          <div className="flex h-full flex-col items-center justify-center gap-4 px-6">
            <div className="flex w-full max-w-xl items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full border border-sky-400/50 bg-sky-950/80 text-[10px] font-bold text-sky-200">AR</div>
              <div>
                <p className="mb-1 text-[11px] text-slate-500">A. Rahman</p>
                <div className="cin-chat-user">
                  {typed}
                  <span className="ml-0.5 inline-block w-[2px] animate-pulse bg-sky-200">&nbsp;</span>
                </div>
              </div>
            </div>
          </div>
        </SceneLayer>

        <SceneLayer active={isActive('chatTyping')} exiting={isExiting('chatTyping')}>
          <div className="flex h-full flex-col items-center justify-center gap-8 px-6">
            <div className="cin-chat-user max-w-xl text-center">{prompt}</div>
            <div className="flex items-center gap-3">
              <div className="flex gap-1.5">
                <span className="cin-typing-dot" />
                <span className="cin-typing-dot" />
                <span className="cin-typing-dot" />
              </div>
              <div className="cin-ai-orb">
                <SparkleIcon className="size-6 text-white" />
              </div>
              <p className="text-xs text-slate-500">AI Agent</p>
            </div>
          </div>
        </SceneLayer>

        <SceneLayer active={isActive('chatResponse')} exiting={isExiting('chatResponse')}>
          <div className="flex h-full flex-col items-center justify-center gap-4 px-6">
            <div className="cin-chat-ai max-w-2xl">
              <p className="mb-2 font-semibold text-sky-100">AI Agent</p>
              <ul className="list-disc space-y-1 pl-4 text-[11px] text-slate-300 md:text-xs">
                <li>AILMS surfaces overdue SUPARCO & MOIT correspondence in under 2 seconds from natural language.</li>
                <li>Executive dashboard combines live PostgreSQL KPIs with AI-ranked risk signals.</li>
                <li>Workflow, approvals, and audit log satisfy oversight requirements without separate tools.</li>
              </ul>
            </div>
          </div>
        </SceneLayer>

        <SceneLayer active={isActive('featurePanels')} exiting={isExiting('featurePanels')}>
          <FeatureCarousel focus={carouselFocus} />
        </SceneLayer>

        <SceneLayer active={isActive('montage')} exiting={isExiting('montage')}>
          <div className="flex h-full flex-col items-center justify-center gap-4 px-4">
            <MockMontageStrip />
            <div className="shw-montage-grid w-full max-w-2xl">
              <GlassMock>
                <MockAnalyticsStudio />
              </GlassMock>
              <GlassMock>
                <MockExecutiveCommand />
              </GlassMock>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/demo/showcase/ai-assistant.png" alt="" className="col-span-2 max-h-32 w-full object-cover object-top" />
            </div>
          </div>
        </SceneLayer>

        <SceneLayer active={isActive('sparkle')} exiting={isExiting('sparkle')}>
          <div className="flex h-full items-center justify-center">
            <SparkleIcon className="cin-mega-sparkle size-24 text-sky-100 md:size-32" />
          </div>
        </SceneLayer>

        <SceneLayer active={isActive('outro')} exiting={isExiting('outro')}>
          <div className="flex h-full flex-col items-center justify-center">
            <div className="cin-logo-lockup flex items-center gap-3">
              <SparkleIcon className="size-10 text-sky-100" />
              <span className="text-4xl font-semibold text-sky-100 md:text-5xl">AILMS</span>
            </div>
            <p className="cin-outro-tag mt-4">Discover AILMS today</p>
            <p className="shw-disclaimer mt-3 max-w-md text-center px-4">
              Extended showcase includes illustrative metrics for presentation; live app data available at /.
            </p>
          </div>
        </SceneLayer>
      </div>

      <div className={`relative z-20 mt-3 w-full max-w-3xl px-4 ${recordMode ? 'cin-controls-hidden' : ''}`}>
        <div className="mb-2 h-0.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full bg-sky-500 transition-[width] duration-100 linear" style={{ width: `${globalProgress}%` }} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
          <span>
            Extended · {Math.round(TOTAL_MS / 1000)}s · scene {sceneIndex + 1}/{SCENES.length}
          </span>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded border border-white/10 px-2 py-0.5" onClick={() => setPlaying((p) => !p)}>
              {playing ? 'Pause' : 'Play'}
            </button>
            <button type="button" className="rounded border border-white/10 px-2 py-0.5" onClick={restart}>
              Restart
            </button>
            <Link href="/demo/video" className="rounded border border-white/10 px-2 py-0.5">
              20s trailer
            </Link>
            <Link href="/demo" className="rounded border border-white/10 px-2 py-0.5">
              Slide deck
            </Link>
            <Link href="/demo/showcase?record=1" className="rounded border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-sky-200">
              Record
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
