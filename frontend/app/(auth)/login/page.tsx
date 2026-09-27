'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { FormEvent, Suspense, useEffect, useState } from 'react'
import {
  AlertCircle,
  Brain,
  Eye,
  EyeOff,
  FileSearch,
  Lock,
  Sparkles,
  User,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/cms/ui'
import { login } from '@/services/auth'
import AiShowcase from '@/components/auth/ai-showcase'
import BranchedMenu from '@/components/react-bits/branched-menu'
import CircularText from '@/components/react-bits/circular-text'
import LetterFlowStepper from '@/components/react-bits/letter-flow-stepper'
import RotatingText from '@/components/react-bits/rotating-text'
import TextType from '@/components/react-bits/text-type'
import TrueFocus from '@/components/react-bits/true-focus'
import './login-animations.css'

const CAPABILITY_WORDS = [
  'Artificial Intelligence',
  'Smart Analysis',
  'AI Insights',
  'OCR',
  'Intelligent Search',
  'Follow-ups',
  'Workflow',
]

const CAPABILITY_PHRASES = [
  'Artificial Intelligence that reads every letter',
  'Smart Analysis for priorities and risks',
  'AI-assisted OCR registration from scans',
  'Intelligent correspondence search',
  'Linked letters, reminders, and follow-ups',
  'Department routing with live status',
]

const MARQUEE_ITEMS = [
  'Artificial Intelligence',
  'Smart Analysis',
  'AI Insights',
  'OCR',
  'Correspondence',
  'Searching',
  'Links',
  'Reminders',
  'Follow-ups',
  'Status',
  'Workflow',
]

const BRANCH_ITEMS = [
  {
    label: 'Artificial Intelligence',
    children: [
      { value: 'smart-analysis', label: 'Smart Analysis', icon: <Brain className="size-4" /> },
      { value: 'ai-insights', label: 'AI Insights', icon: <Sparkles className="size-4" /> },
      { value: 'ocr', label: 'OCR Intake', icon: <FileSearch className="size-4" /> },
    ],
  },
]

/** Reveal order for left showcase (keeps layout calm at narrow widths). */
const REVEAL_MS = 12000

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get('next') || '/'

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await login(username.trim(), password)
      router.replace(next.startsWith('/') ? next : '/')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      <label className="block space-y-1.5">
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Username</span>
        <div className="relative">
          <User className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            autoComplete="username"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="h-11 w-full rounded-md border border-slate-200 bg-white pl-10 pr-3 text-sm text-slate-800 outline-none ring-[#0d3763]/focus:ring-2"
            placeholder="arahman"
          />
        </div>
      </label>
      <label className="block space-y-1.5">
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Password</span>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11 w-full rounded-md border border-slate-200 bg-white pl-10 pr-10 text-sm text-slate-800 outline-none ring-[#0d3763]/focus:ring-2"
            placeholder="••••••••"
          />
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </label>
      <Button type="submit" className="h-11 w-full" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>
      <p className="text-center text-xs text-slate-500">
        No account?{' '}
        <Link href="/signup" className="font-semibold text-[#1769aa] hover:underline">
          Create one
        </Link>
      </p>
      <p className="rounded-md bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
        Demo admin: <span className="font-semibold text-slate-700">admin</span> /{' '}
        <span className="font-semibold text-slate-700">Password1</span>
      </p>
    </form>
  )
}

function FullWidthMarquee() {
  const sequence = [...MARQUEE_ITEMS, ...MARQUEE_ITEMS]
  return (
    <div className="login-footer-marquee relative w-full overflow-hidden border-t border-black/10" aria-hidden>
      {/* Split plate: dark under aside, light under form — text uses mix-blend for contrast */}
      <div className="pointer-events-none absolute inset-0 flex">
        <div className="hidden bg-[#0d3763] lg:block lg:w-[46%] xl:w-[42%]" />
        <div className="flex-1 bg-white" />
      </div>
      <div className="login-marquee-mask relative py-3">
        <div className="login-marquee flex w-max gap-8 whitespace-nowrap">
          {sequence.map((item, i) => (
            <span
              key={`${item}-${i}`}
              className="login-footer-marquee-text text-[11px] font-semibold uppercase tracking-[0.22em]"
            >
              {item}
              <span className="ml-8 opacity-50">·</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function ShowcaseColumn() {
  const [step, setStep] = useState(1)
  const totalSteps = 6

  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return
    }
    const id = setTimeout(() => {
      setStep((s) => (s >= totalSteps ? 1 : s + 1))
    }, REVEAL_MS)
    return () => clearTimeout(id)
  }, [step, totalSteps])

  return (
    <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto p-5 xl:p-8">
      <div className="min-w-0 shrink-0">
        <Logo />
        <p className="mt-4 text-xs font-semibold uppercase tracking-[0.2em] text-sky-300/90">
          AILMS · AI Letter Management
        </p>
        <h1 className="mt-3 text-xl font-bold leading-tight break-words text-white xl:text-3xl">
          Correspondence powered by{' '}
          <span className="bg-linear-to-r from-sky-200 to-cyan-300 bg-clip-text text-transparent">
            Artificial Intelligence
          </span>
        </h1>

        <p className="mt-3 flex min-w-0 flex-wrap items-center gap-2 text-sm text-blue-100/90">
          <span className="shrink-0">Highlighting</span>
          <RotatingText
            texts={CAPABILITY_WORDS}
            rotationInterval={2400}
            staggerDuration={0.018}
            staggerFrom="last"
            splitBy="characters"
            mainClassName="max-w-full overflow-hidden rounded-md bg-sky-400/20 px-2.5 py-1 font-semibold text-sky-100 ring-1 ring-sky-300/30"
            elementLevelClassName="text-sky-100"
          />
        </p>

        <div className="mt-2 min-h-7 min-w-0 overflow-hidden">
          <TextType
            text={CAPABILITY_PHRASES}
            typingSpeed={38}
            deletingSpeed={22}
            pauseDuration={1700}
            loop
            showCursor
            cursorCharacter="|"
            cursorClassName="text-sky-300"
            className="max-w-full break-words whitespace-normal text-sm text-blue-100/75"
            textColors={['#bae6fd', '#7dd3fc', '#e0f2fe']}
          />
        </div>
      </div>

      {/* One panel at a time — each step replaces the previous */}
      <div className="relative mt-4 min-h-[22rem] min-w-0 flex-1 pb-2">
        {step === 1 && (
          <div key="holo" className="login-reveal-in absolute inset-x-0 top-0">
            <AiShowcase showHologram showThinking={false} />
          </div>
        )}

        {step === 2 && (
          <div key="thinking" className="login-reveal-in absolute inset-x-0 top-0">
            <AiShowcase showHologram={false} showThinking />
          </div>
        )}

        {step === 3 && (
          <div key="flow" className="login-reveal-in absolute inset-x-0 top-0">
            <LetterFlowStepper />
          </div>
        )}

        {step === 4 && (
          <div key="focus" className="login-reveal-in absolute inset-x-0 top-0">
            <TrueFocus
              sentence="AI Smart Analysis Insights OCR Search"
              separator=" "
              blurAmount={4}
              borderColor="#7dd3fc"
              glowColor="rgba(125, 211, 252, 0.55)"
              animationDuration={0.55}
              pauseBetweenAnimations={1.05}
              className="!justify-start gap-x-3 gap-y-2"
              wordClassName="text-sm font-bold tracking-tight text-white xl:text-base"
            />
          </div>
        )}

        {step === 5 && (
          <div key="branch" className="login-reveal-in absolute inset-x-0 top-0 overflow-hidden">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-200/70">Capabilities</p>
            <BranchedMenu
              items={BRANCH_ITEMS}
              defaultOpen={0}
              defaultActive="smart-analysis"
              autoCycle
              autoCycleSection={0}
              autoCycleInterval={2800}
              drawDuration={900}
              color="#e0f2fe"
              accentColor="#7dd3fc"
              lineColor="rgba(125, 211, 252, 0.35)"
              width={240}
              fontSize={13}
              rowHeight={32}
              indent={36}
              className="max-w-full"
            />
          </div>
        )}

        {step === 6 && (
          <div key="circular" className="login-reveal-in absolute inset-x-0 top-0 flex justify-center pt-4">
            <CircularText
              text="AI • SMART ANALYSIS • AILMS • OCR • "
              spinDuration={16}
              onHover="speedUp"
              className="size-36 shrink-0 text-[10px] font-bold tracking-wide text-sky-100/90"
            />
          </div>
        )}
      </div>

      <p className="mt-auto pt-4 text-xs text-blue-200/55">Authorized personnel only</p>
    </div>
  )
}

export default function LoginPage() {
  return (
    <div className="flex min-h-dvh max-w-[100vw] flex-col overflow-x-hidden">
      <div className="flex min-h-0 flex-1">
        <aside className="relative hidden min-w-0 overflow-x-hidden bg-[#0d3763] lg:flex lg:w-[46%] lg:max-w-[46%] lg:flex-col xl:w-[42%] xl:max-w-[42%]">
          <div
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{
              background:
                'radial-gradient(ellipse at 20% 20%, rgba(59,130,246,0.45), transparent 50%), radial-gradient(ellipse at 80% 80%, rgba(14,165,233,0.25), transparent 45%)',
            }}
          />
          <ShowcaseColumn />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col justify-center overflow-x-hidden px-6 py-10 sm:px-12">
          <div className="mx-auto w-full max-w-md min-w-0">
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <Logo />
              <div className="min-w-0">
                <p className="text-sm font-bold text-[#102a43]">AI Letter Management</p>
                <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400">Smart Analysis</p>
              </div>
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-[#102a43]">Sign in</h2>
            <p className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-sm text-slate-500">
              <span>Enter the</span>
              <RotatingText
                texts={['AI workspace', 'Smart Analysis hub', 'intelligent register']}
                rotationInterval={2600}
                splitBy="words"
                mainClassName="max-w-full overflow-hidden rounded bg-sky-50 px-1.5 py-0.5 font-semibold text-[#1769aa]"
                elementLevelClassName="text-[#1769aa]"
              />
            </p>
            <div className="mt-8">
              <Suspense fallback={<div className="h-48 animate-pulse rounded-md bg-slate-100" />}>
                <LoginForm />
              </Suspense>
            </div>
          </div>
        </main>
      </div>

      <FullWidthMarquee />
    </div>
  )
}
