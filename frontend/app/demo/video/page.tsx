'use client'

import { Calendar, FilePlus2, MessageCircle, Sparkles, SquarePen } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './cinematic.css'

/** Matched to reference MP4 (~20.03s) — one beat per NeuraFlow cut. */
const SCENES = [
  { id: 'logo', ms: 2000 },
  { id: 'rise', ms: 2500 },
  { id: 'dashboard3d', ms: 3500 },
  { id: 'dashboardWide', ms: 2000 },
  { id: 'ringNew', ms: 1500 },
  { id: 'ringUpdates', ms: 1500 },
  { id: 'chatInput', ms: 2000 },
  { id: 'chatTyping', ms: 1500 },
  { id: 'chatResponse', ms: 2500 },
  { id: 'featurePanels', ms: 2000 },
  { id: 'sparkle', ms: 1000 },
  { id: 'outro', ms: 1033 },
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

function HeadlineBeam() {
  return (
    <div className="cin-beam-icon-row mb-3 flex flex-col items-center gap-2">
      <div className="relative h-8 w-32">
        <div className="absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-transparent via-sky-400/80 to-transparent" />
        <SparkleIcon className="cin-sparkle-icon absolute left-1/2 top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 text-sky-100" />
      </div>
      <p className="cin-headline-main">Smart Control</p>
      <p className="cin-headline-sub">Customized Dashboard</p>
    </div>
  )
}

function DashboardWindow({ rise }: { rise?: boolean }) {
  return (
    <div className={`cin-glass-window mx-auto w-[min(78vw,720px)] ${rise ? 'cin-glass-window-rise' : ''}`}>
      <div className="overflow-hidden rounded-[17px] border border-white/10 bg-[#f5f8fb]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/demo/dashboard.png" alt="" className="max-h-[34vh] w-full object-cover object-top" />
      </div>
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
            [0, 90, 180, 270].map((deg, i) => {
              const rad = (deg * Math.PI) / 180
              const x = 100 + Math.cos(rad) * 78
              const y = 100 + Math.sin(rad) * 78
              return <circle key={deg} cx={x} cy={y} r="10" fill="rgba(37,99,235,0.9)" stroke="#7dd3fc" strokeWidth="1.5" />
            })}
        </svg>
        <div className="cin-ring-label">{label}</div>
      </div>
    </div>
  )
}

function FeatureCarousel({ focus }: { focus: number }) {
  const panels = [
    { icon: Sparkles, title: 'AI Assistant', body: 'Natural-language answers for management and operations.' },
    { icon: SquarePen, title: 'Workflow', body: 'Approvals, escalations, and audit-ready transitions.' },
    { icon: FilePlus2, title: 'Register', body: 'Capture incoming and outgoing correspondence in seconds.' },
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
            <p className="text-[11px] leading-relaxed text-slate-400">{p.body}</p>
          </div>
        )
      })}
    </div>
  )
}

function SceneLayer({ active, exiting, children }: { active: boolean; exiting: boolean; children: React.ReactNode }) {
  return <div className={`cin-scene ${active ? 'is-active' : ''} ${exiting ? 'is-exiting' : ''}`}>{children}</div>
}

export default function CinematicDemoVideoPage() {
  const [sceneIndex, setSceneIndex] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [recordMode, setRecordMode] = useState(false)
  const [prevIndex, setPrevIndex] = useState<number | null>(null)
  const [typed, setTyped] = useState('')
  const [carouselFocus, setCarouselFocus] = useState(0)
  const sceneStartRef = useRef(0)

  const scene = SCENES[sceneIndex]
  const prompt = 'How AILMS can help?'

  const restart = useCallback(() => {
    setSceneIndex(0)
    setElapsed(0)
    setPrevIndex(null)
    setTyped('')
    setCarouselFocus(0)
    sceneStartRef.current = performance.now()
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('record') === '1') {
      setRecordMode(true)
      setPlaying(true)
      const t = window.setTimeout(() => {
        void document.documentElement.requestFullscreen().catch(() => {})
      }, 500)
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
    }, 45)
    return () => window.clearInterval(tick)
  }, [scene.id, sceneIndex])

  useEffect(() => {
    if (scene.id !== 'featurePanels') return
    setCarouselFocus(0)
    const t1 = window.setTimeout(() => setCarouselFocus(1), 700)
    const t2 = window.setTimeout(() => setCarouselFocus(2), 1400)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
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
    <div className="cin-root relative flex min-h-dvh flex-col items-center justify-center overflow-hidden">
      <CosmicBackdrop />
      <p className="cin-watermark">AILMS</p>

      <div className="cin-stage relative z-10">
        {/* 1 · Logo lockup (0:00) */}
        <SceneLayer active={isActive('logo')} exiting={isExiting('logo')}>
          <div className="flex h-full flex-col items-center justify-center">
            <div className="cin-logo-lockup flex items-center gap-3">
              <SparkleIcon className="cin-sparkle-icon size-10 text-sky-100 md:size-12" />
              <span className="text-4xl font-semibold tracking-tight text-sky-100 md:text-5xl">AILMS</span>
            </div>
          </div>
        </SceneLayer>

        {/* 2 · Smart Control + dashboard rise (0:02) */}
        <SceneLayer active={isActive('rise')} exiting={isExiting('rise')}>
          <div className="flex h-full flex-col items-center justify-center px-4 pt-[8%]">
            <HeadlineBeam />
            <DashboardWindow rise />
          </div>
        </SceneLayer>

        {/* 3 · 3D dashboard + floating chips (0:04–0:07) */}
        <SceneLayer active={isActive('dashboard3d')} exiting={isExiting('dashboard3d')}>
          <div className="relative flex h-full flex-col items-center justify-center px-4 pt-[6%]">
            <HeadlineBeam />
            <div className="relative w-full max-w-4xl">
              <div className="cin-float-chip cin-float-left absolute -left-2 top-[38%] z-20 hidden sm:flex sm:items-center sm:gap-2">
                <Calendar className="size-3.5 text-sky-300" /> Calendar
              </div>
              <div className="cin-float-chip cin-float-left absolute -left-2 top-[52%] z-20 hidden sm:flex sm:items-center sm:gap-2">
                <MessageCircle className="size-3.5 text-sky-300" /> Chat
              </div>
              <div className="cin-float-chip cin-float-right absolute -right-2 top-[42%] z-20 max-w-[160px] text-left leading-snug">
                <span className="text-sky-300">New task</span>
                <br />
                Analyze overdue correspondence by department
              </div>
              <DashboardWindow />
            </div>
          </div>
        </SceneLayer>

        {/* 4 · Wide parallax brand (0:07–0:09) */}
        <SceneLayer active={isActive('dashboardWide')} exiting={isExiting('dashboardWide')}>
          <div className="relative flex h-full items-center justify-center">
            <p className="cin-brand-watermark">AILMS</p>
            <div className="cin-bg-blur-stack absolute inset-x-[8%] top-[22%] opacity-30">
              <DashboardWindow />
            </div>
            <div className="relative z-10 w-[min(70vw,640px)]">
              <DashboardWindow />
            </div>
          </div>
        </SceneLayer>

        {/* 5 · “New” ring (0:09) */}
        <SceneLayer active={isActive('ringNew')} exiting={isExiting('ringNew')}>
          <RingScene label="New" />
        </SceneLayer>

        {/* 6 · “New Updates” orbit (0:10–0:11) */}
        <SceneLayer active={isActive('ringUpdates')} exiting={isExiting('ringUpdates')}>
          <RingScene label="New Updates" orbitIcons />
        </SceneLayer>

        {/* 7 · Chat prompt typewriter (0:11–0:13) */}
        <SceneLayer active={isActive('chatInput')} exiting={isExiting('chatInput')}>
          <div className="flex h-full flex-col items-center justify-center gap-4 px-6">
            <div className="flex w-full max-w-xl items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full border border-sky-400/50 bg-sky-950/80">
                <span className="text-[10px] font-bold text-sky-200">AR</span>
              </div>
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

        {/* 8 · AI typing (0:13–0:14.5) */}
        <SceneLayer active={isActive('chatTyping')} exiting={isExiting('chatTyping')}>
          <div className="flex h-full flex-col items-center justify-center gap-8 px-6">
            <div className="cin-chat-user w-full max-w-xl text-center">{prompt}</div>
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

        {/* 9 · AI response bubble (0:14.5–0:17) */}
        <SceneLayer active={isActive('chatResponse')} exiting={isExiting('chatResponse')}>
          <div className="flex h-full flex-col items-center justify-center gap-5 px-6">
            <div className="cin-chat-user max-w-xl">{prompt}</div>
            <div className="flex w-full max-w-2xl items-start gap-3">
              <div className="cin-chat-ai flex-1">
                <p className="mb-2 font-semibold text-sky-100">AI Agent</p>
                <ul className="list-disc space-y-1.5 pl-4 text-slate-300">
                  <li>AILMS interprets natural language to filter overdue, pending, and organization-specific correspondence.</li>
                  <li>Real-time answers from your PostgreSQL register—dashboard KPIs, alerts, and letter detail.</li>
                  <li>Workflow, approvals, and audit trail keep every action accountable.</li>
                </ul>
              </div>
              <div className="cin-ai-orb shrink-0">
                <SparkleIcon className="size-6 text-white" />
              </div>
            </div>
          </div>
        </SceneLayer>

        {/* 10 · 3-panel carousel (0:17–0:19) */}
        <SceneLayer active={isActive('featurePanels')} exiting={isExiting('featurePanels')}>
          <div className="flex h-full flex-col items-center justify-center pt-[6%]">
            <FeatureCarousel focus={carouselFocus} />
          </div>
        </SceneLayer>

        {/* 11 · Mega sparkle transition (0:19) */}
        <SceneLayer active={isActive('sparkle')} exiting={isExiting('sparkle')}>
          <div className="flex h-full items-center justify-center">
            <SparkleIcon className="cin-mega-sparkle size-24 text-sky-100 md:size-32" />
          </div>
        </SceneLayer>

        {/* 12 · Outro (0:19–0:20) */}
        <SceneLayer active={isActive('outro')} exiting={isExiting('outro')}>
          <div className="flex h-full flex-col items-center justify-center">
            <div className="cin-logo-lockup flex items-center gap-3">
              <SparkleIcon className="cin-sparkle-icon size-10 text-sky-100 md:size-11" />
              <span className="text-4xl font-semibold text-sky-100 md:text-5xl">AILMS</span>
            </div>
            <p className="cin-outro-tag mt-4">Discover AILMS today</p>
          </div>
        </SceneLayer>
      </div>

      <div className={`relative z-20 mt-3 w-full max-w-3xl px-4 ${recordMode ? 'cin-controls-hidden' : ''}`}>
        <div className="mb-2 h-0.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full bg-sky-500 transition-[width] duration-100 linear" style={{ width: `${globalProgress}%` }} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
          <span>
            NeuraFlow-matched cut · {sceneIndex + 1}/{SCENES.length} · {(TOTAL_MS / 1000).toFixed(1)}s
          </span>
          <div className="flex gap-2">
            <button type="button" className="rounded border border-white/10 px-2 py-0.5" onClick={() => setPlaying((p) => !p)}>
              {playing ? 'Pause' : 'Play'}
            </button>
            <button type="button" className="rounded border border-white/10 px-2 py-0.5" onClick={restart}>
              Restart
            </button>
            <Link href="/demo/video?record=1" className="rounded border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-sky-200">
              Record MP4
            </Link>
          </div>
        </div>
        <p className="mt-1 text-[10px] text-slate-600">
          Fullscreen (F) · Space · R. Record one loop at 1920×1080, then trim to 20s. Reference frames saved under{' '}
          <code className="text-slate-500">public/demo/neuraflow-ref/</code>.
        </p>
      </div>
    </div>
  )
}
