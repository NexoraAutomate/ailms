'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart3,
  Bell,
  BriefcaseBusiness,
  Building2,
  Calendar,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Download,
  FileText,
  LayoutDashboard,
  LineChart,
  Maximize2,
  Pause,
  Play,
  ShieldCheck,
  Sparkles,
  Upload,
  Users,
} from 'lucide-react'

const SLIDE_MS = 9000

type Slide = {
  id: string
  kicker: string
  title: string
  subtitle: string
  highlights: string[]
  visual: 'hero' | 'dashboard' | 'lifecycle' | 'ai' | 'search' | 'workflow' | 'ops' | 'analytics' | 'admin' | 'close'
}

const slides: Slide[] = [
  {
    id: 'intro',
    kicker: 'Executive overview',
    title: 'Correspondence Management System',
    subtitle: 'AILMS unifies letter tracking, action accountability, and AI-assisted decision support in one enterprise workspace.',
    highlights: ['PostgreSQL-backed live register', 'Role-based governance', 'AI intelligence layer'],
    visual: 'hero',
  },
  {
    id: 'dashboard',
    kicker: 'Workspace',
    title: 'Command center for leadership',
    subtitle: 'Real-time KPIs, trend charts, department workload, and management alerts—sourced from live correspondence data.',
    highlights: ['7 KPI tiles with drill-down', 'Letters-by-month trend', 'Management alerts & audit trail'],
    visual: 'dashboard',
  },
  {
    id: 'lifecycle',
    kicker: 'Letters',
    title: 'End-to-end correspondence lifecycle',
    subtitle: 'Register, classify, track, and close incoming and outgoing letters with full visibility from inbox to archive.',
    highlights: ['Incoming · Outgoing · Pending · Overdue', 'Rich letter detail & documents', 'Correspondence threads & relations'],
    visual: 'lifecycle',
  },
  {
    id: 'ai',
    kicker: 'AI Intelligence',
    title: 'Advisory intelligence on demand',
    subtitle: 'Ask operational and management questions in plain language—powered by LLM when configured, with reliable local fallback.',
    highlights: ['Suggested question library', 'Letter-level AI panels', 'Management insights on dashboard'],
    visual: 'ai',
  },
  {
    id: 'search',
    kicker: 'Natural language',
    title: 'Search that understands intent',
    subtitle: 'Type questions like “Show overdue letters from SUPARCO”—the register interprets, filters, and surfaces results instantly.',
    highlights: ['Header search bar', 'Interpreted query banner', 'One-click clear & refine'],
    visual: 'search',
  },
  {
    id: 'workflow',
    kicker: 'Accountability',
    title: 'Workflow, approvals & escalations',
    subtitle: 'Status-driven actions, reviewer cycles, and escalation paths keep sensitive correspondence under control.',
    highlights: ['Configurable workflow transitions', 'Approval revisions & remarks', 'Escalation resolution'],
    visual: 'workflow',
  },
  {
    id: 'ops',
    kicker: 'Operations',
    title: 'Meetings tied to correspondence',
    subtitle: 'Link letters to meetings, track action items, and move data in bulk through import and export centers.',
    highlights: ['Meeting register & actions', 'Import Center', 'Export Center'],
    visual: 'ops',
  },
  {
    id: 'analytics',
    kicker: 'Management',
    title: 'Analytics & executive reporting',
    subtitle: 'Operational dashboards and exportable reports give leadership a consistent view of performance and risk.',
    highlights: ['Analytics workspace', 'Report generation', 'Letter Analysis timelines'],
    visual: 'analytics',
  },
  {
    id: 'admin',
    kicker: 'Administration',
    title: 'Enterprise control plane',
    subtitle: 'Departments, organizations, users, master data, audit log, notifications, and security settings—managed in one hub.',
    highlights: ['Users & roles · Access control', 'Audit log & compliance', 'Settings hub & master data'],
    visual: 'admin',
  },
  {
    id: 'close',
    kicker: 'Next steps',
    title: 'Ready for pilot and scale',
    subtitle: 'AILMS delivers a modern correspondence platform with AI augmentation—built for oversight, speed, and trust.',
    highlights: ['Live demo at localhost:3000', 'Backend API + PostgreSQL', 'Extensible AI via LLM_API_KEY'],
    visual: 'close',
  },
]

function BrowserChrome({ children, url = 'localhost:3000' }: { children: React.ReactNode; url?: string }) {
  return (
    <div className="demo-browser-shot overflow-hidden rounded-xl border border-white/10 bg-[#f5f8fb] shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-red-400/90" />
          <span className="size-2.5 rounded-full bg-amber-400/90" />
          <span className="size-2.5 rounded-full bg-emerald-400/90" />
        </div>
        <div className="mx-auto max-w-md flex-1 truncate rounded-md bg-slate-100 px-3 py-1 text-center text-[11px] font-medium text-slate-500">
          {url}
        </div>
      </div>
      <div className="relative max-h-[min(52vh,420px)] overflow-hidden">{children}</div>
    </div>
  )
}

function Callout({ label, className }: { label: string; className: string }) {
  return (
    <div className={`demo-callout absolute z-10 rounded-lg border border-[#2d75b9] bg-[#102a43]/95 px-3 py-2 text-[11px] font-semibold text-white backdrop-blur-sm ${className}`}>
      <span className="mr-1.5 inline-block size-1.5 rounded-full bg-[#8fb7d9]" />
      {label}
    </div>
  )
}

function FeaturePill({ icon: Icon, label, delay }: { icon: React.ComponentType<{ className?: string }>; label: string; delay: number }) {
  return (
    <div
      data-animate="fade-up"
      data-delay={String(delay)}
      className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200"
    >
      <Icon className="size-3.5 text-[#8fb7d9]" />
      {label}
    </div>
  )
}

function LifecycleVisual({ active }: { active: boolean }) {
  const steps = ['Register', 'Assign', 'Action', 'Approve', 'Close']
  return (
    <div className="relative rounded-xl border border-white/10 bg-white/[0.03] p-6">
      <svg viewBox="0 0 520 120" className="mx-auto w-full max-w-lg" aria-hidden>
        <line
          x1="40"
          y1="60"
          x2="480"
          y2="60"
          stroke="#2d75b9"
          strokeWidth="2"
          strokeDasharray="120"
          strokeDashoffset={active ? 0 : 120}
          style={{ animation: active ? 'demo-draw-line 1.2s ease forwards' : undefined }}
        />
        {steps.map((step, i) => (
          <g key={step} transform={`translate(${40 + i * 110}, 60)`}>
            <circle r="18" fill="#0d3763" stroke="#8fb7d9" strokeWidth="2" />
            <text textAnchor="middle" y="5" fill="white" fontSize="11" fontWeight="600">
              {i + 1}
            </text>
            <text textAnchor="middle" y="38" fill="#94a3b8" fontSize="10">
              {step}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

function WorkflowVisual({ active }: { active: boolean }) {
  const cards = [
    { title: 'Draft', tone: 'border-slate-500/40' },
    { title: 'In review', tone: 'border-amber-400/50' },
    { title: 'Approved', tone: 'border-emerald-400/50' },
  ]
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {cards.map((c, i) => (
        <div
          key={c.title}
          data-animate="scale-in"
          data-delay={String(i + 1)}
          className={`rounded-lg border bg-white/[0.04] p-4 ${c.tone} ${active ? '' : 'opacity-40'}`}
        >
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#8fb7d9]">Stage {i + 1}</p>
          <p className="mt-2 text-sm font-semibold text-white">{c.title}</p>
          <p className="mt-1 text-[11px] text-slate-400">Audit trail · Assignee · Timestamps</p>
        </div>
      ))}
    </div>
  )
}

function HeroVisual() {
  return (
    <div className="relative flex flex-col items-center justify-center py-8">
      <div
        data-animate="scale-in"
        className="flex size-20 items-center justify-center rounded-2xl bg-[#0d3763] text-white shadow-[0_0_60px_rgba(45,117,185,0.35)]"
      >
        <BriefcaseBusiness className="size-10" />
      </div>
      <p data-animate="fade-up" data-delay="2" className="demo-shimmer-text mt-6 text-lg font-semibold tracking-wide">
        AI-Augmented Letter Management
      </p>
      <div data-animate="fade-up" data-delay="3" className="mt-8 grid grid-cols-3 gap-4 text-center">
        {[
          { n: '9+', l: 'Live letters' },
          { n: '12', l: 'Alert signals' },
          { n: '100%', l: 'Audit coverage' },
        ].map((s) => (
          <div key={s.l} className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
            <p className="demo-count-pop text-2xl font-bold text-white">
              {s.n}
            </p>
            <p className="text-[10px] uppercase tracking-wider text-slate-400">{s.l}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function SlideVisual({ slide, active }: { slide: Slide; active: boolean }) {
  switch (slide.visual) {
    case 'hero':
      return <HeroVisual />
    case 'dashboard':
      return (
        <div className="relative">
          <BrowserChrome>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/demo/dashboard.png" alt="Dashboard overview" className="w-full object-cover object-top" />
          </BrowserChrome>
          <Callout label="Live PostgreSQL KPIs" className="left-[8%] top-[28%]" />
          <Callout label="Management alerts" className="right-[6%] top-[55%]" />
        </div>
      )
    case 'lifecycle':
      return (
        <div className="space-y-4">
          <LifecycleVisual active={active} />
          <div className="flex flex-wrap justify-center gap-2">
            <FeaturePill icon={FileText} label="Register Letter" delay={4} />
            <FeaturePill icon={CircleAlert} label="Overdue queue" delay={5} />
            <FeaturePill icon={BriefcaseBusiness} label="Archive" delay={6} />
          </div>
        </div>
      )
    case 'ai':
      return (
        <div className="relative">
          <BrowserChrome url="localhost:3000 · AI Assistant">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/demo/ai-assistant.png" alt="AI Assistant" className="w-full object-cover object-top" />
          </BrowserChrome>
          <Callout label="Suggested management questions" className="left-[10%] top-[32%]" />
          <Callout label="LLM + fallback intelligence" className="right-[5%] bottom-[18%]" />
        </div>
      )
    case 'search':
      return (
        <div className="relative">
          <BrowserChrome url="localhost:3000 · Letter database">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/demo/letter-database.png" alt="Natural language search" className="w-full object-cover object-top" />
          </BrowserChrome>
          <Callout label="Natural language query" className="left-[12%] top-[8%]" />
          <Callout label="Smart register filters" className="right-[8%] top-[38%]" />
        </div>
      )
    case 'workflow':
      return <WorkflowVisual active={active} />
    case 'ops':
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <FeaturePill icon={Calendar} label="Meetings & actions" delay={1} />
          <FeaturePill icon={Upload} label="Import Center" delay={2} />
          <FeaturePill icon={Download} label="Export Center" delay={3} />
          <div data-animate="fade-in" data-delay="4" className="sm:col-span-3 rounded-xl border border-white/10 bg-gradient-to-br from-[#0d3763]/40 to-transparent p-5 text-sm text-slate-300">
            Link correspondence to committee meetings, track follow-ups, and exchange bulk data with external systems—without leaving the workspace.
          </div>
        </div>
      )
    case 'analytics':
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <div data-animate="slide-right" data-delay="1" className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
            <BarChart3 className="size-8 text-[#8fb7d9]" />
            <p className="mt-3 font-semibold text-white">Analytics</p>
            <p className="mt-1 text-xs text-slate-400">Volume, SLA, and department performance views.</p>
          </div>
          <div data-animate="slide-right" data-delay="2" className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
            <LineChart className="size-8 text-[#8fb7d9]" />
            <p className="mt-3 font-semibold text-white">Letter Analysis</p>
            <p className="mt-1 text-xs text-slate-400">Timelines, delays, and relationship graphs.</p>
          </div>
        </div>
      )
    case 'admin':
      return (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <FeaturePill icon={Building2} label="Departments" delay={1} />
          <FeaturePill icon={Users} label="Users & roles" delay={2} />
          <FeaturePill icon={ShieldCheck} label="Audit log" delay={3} />
          <FeaturePill icon={Bell} label="Notifications" delay={4} />
          <FeaturePill icon={LayoutDashboard} label="Settings hub" delay={5} />
          <FeaturePill icon={Sparkles} label="AI Insights" delay={6} />
        </div>
      )
    case 'close':
      return (
        <div data-animate="scale-in" className="rounded-2xl border border-[#2d75b9]/40 bg-[#0d3763]/30 p-8 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#8fb7d9]">Thank you</p>
          <p className="mt-4 text-2xl font-bold text-white">Explore the live workspace</p>
          <a
            href="/"
            className="mt-6 inline-flex items-center justify-center rounded-lg bg-[#2d75b9] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#1769aa]"
          >
            Open AILMS application
          </a>
          <p className="mt-4 text-xs text-slate-400">Press F for fullscreen · Space to pause · Arrow keys to navigate</p>
        </div>
      )
    default:
      return null
  }
}

export default function DemoPresentationPage() {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [progress, setProgress] = useState(0)
  const tickRef = useRef(0)
  const slide = slides[index]
  const slideKey = useMemo(() => `${slide.id}-${index}`, [slide.id, index])

  const go = useCallback((delta: number) => {
    setIndex((i) => (i + delta + slides.length) % slides.length)
    setProgress(0)
    tickRef.current = 0
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) void document.documentElement.requestFullscreen()
    else void document.exitFullscreen()
  }, [])

  useEffect(() => {
    if (!playing) return
    const interval = window.setInterval(() => {
      tickRef.current += 100
      setProgress(Math.min(100, (tickRef.current / SLIDE_MS) * 100))
      if (tickRef.current >= SLIDE_MS) go(1)
    }, 100)
    return () => window.clearInterval(interval)
  }, [playing, index, go])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1)
      if (e.key === 'ArrowLeft') go(-1)
      if (e.key === ' ') {
        e.preventDefault()
        setPlaying((p) => !p)
      }
      if (e.key === 'f' || e.key === 'F') toggleFullscreen()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, toggleFullscreen])

  return (
    <div className="demo-root relative flex min-h-dvh flex-col overflow-hidden bg-[#060d18] text-white antialiased">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(45,117,185,0.25),transparent)]" />

      <header className="relative z-20 flex items-center justify-between gap-4 px-6 py-4 sm:px-10">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-[#0d3763]">
            <BriefcaseBusiness className="size-5 text-white" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-[#8fb7d9]">AILMS</p>
            <p className="text-[11px] text-slate-500">
              Executive deck ·{' '}
              <a href="/demo/video" className="text-[#8fb7d9] hover:underline">
                Cinematic video
              </a>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            className="flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
            title={playing ? 'Pause (Space)' : 'Play (Space)'}
          >
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
            title="Fullscreen (F)"
          >
            <Maximize2 className="size-4" />
          </button>
        </div>
      </header>

      <div className="relative z-20 h-0.5 bg-white/5">
        <div className="demo-progress-fill h-full bg-[#2d75b9]" style={{ width: `${progress}%` }} />
      </div>

      <main key={slideKey} className="demo-slide-active relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center gap-8 px-6 py-8 sm:px-10 lg:grid lg:grid-cols-[1fr_1.05fr] lg:items-center lg:gap-12">
        <div>
          <p data-animate="fade-in" className="text-xs font-bold uppercase tracking-[0.25em] text-[#8fb7d9]">
            {slide.kicker}
          </p>
          <h1 data-animate="fade-up" data-delay="1" className="mt-3 text-3xl font-bold leading-tight text-white sm:text-4xl lg:text-[2.65rem]">
            {slide.title}
          </h1>
          <p data-animate="fade-up" data-delay="2" className="mt-4 max-w-xl text-sm leading-relaxed text-slate-400 sm:text-base">
            {slide.subtitle}
          </p>
          <ul className="mt-6 space-y-2">
            {slide.highlights.map((h, i) => (
              <li
                key={h}
                data-animate="slide-right"
                data-delay={String(Math.min(i + 3, 6))}
                className="flex items-start gap-2 text-sm text-slate-300"
              >
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#2d75b9]" />
                {h}
              </li>
            ))}
          </ul>
        </div>
        <div className="min-w-0">
          <SlideVisual slide={slide} active />
        </div>
      </main>

      <footer className="relative z-20 flex flex-wrap items-center justify-between gap-4 border-t border-white/5 px-6 py-4 sm:px-10">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => go(-1)}
            className="flex size-8 items-center justify-center rounded-md border border-white/10 text-slate-400 hover:bg-white/5 hover:text-white"
            aria-label="Previous slide"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            className="flex size-8 items-center justify-center rounded-md border border-white/10 text-slate-400 hover:bg-white/5 hover:text-white"
            aria-label="Next slide"
          >
            <ChevronRight className="size-4" />
          </button>
          <span className="ml-2 text-xs text-slate-500">
            {index + 1} / {slides.length}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {slides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setIndex(i)
                setProgress(0)
                tickRef.current = 0
              }}
              className={`h-1.5 rounded-full transition-all ${i === index ? 'w-8 bg-[#2d75b9]' : 'w-3 bg-white/15 hover:bg-white/30'}`}
              aria-label={`Go to slide ${i + 1}: ${s.title}`}
            />
          ))}
        </div>
      </footer>
    </div>
  )
}
