'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import './landing.css'

const GradientWaves = dynamic(() => import('@/components/react-bits/gradient-waves'), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-[#061428]" aria-hidden />,
})

export default function LandingPage() {
  return (
    <div className="landing-root relative min-h-dvh overflow-hidden">
      <div className="absolute inset-0" aria-hidden>
        <GradientWaves
          className="h-full w-full"
          horizonColor="#04101f"
          waveColor="#1769aa"
          crestColor="#c5dff2"
          speed={0.35}
          amplitude={2.8}
          waveScale={0.55}
          swell={40}
          turbulence={18}
          tilt={1.05}
          zoom={1.05}
          fogDepth={16}
          brightness={0.95}
          detail="medium"
          mouseInteraction
          parallaxStrength={0.45}
          grain
          grainIntensity={0.04}
        />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_15%,rgba(23,105,170,0.28),transparent_45%),linear-gradient(to_bottom,rgba(6,20,40,0.15)_0%,rgba(6,20,40,0.55)_55%,rgba(6,20,40,0.92)_100%)]" />
        <div className="landing-glow pointer-events-none absolute left-1/2 top-[18%] h-[42vmin] w-[70vmin] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(126,182,224,0.22),transparent_68%)] blur-2xl" />
      </div>

      <header className="relative z-10 flex items-center justify-between px-6 py-5 sm:px-10 lg:px-14">
        <p className="landing-brand text-lg text-white/95 sm:text-xl">AILMS</p>
        <nav className="flex items-center gap-3 sm:gap-4">
          <Link
            href="/demo"
            className="text-sm font-medium text-(--landing-muted) transition hover:text-white"
          >
            Demo
          </Link>
          <Link
            href="/login"
            className="rounded-md bg-white/10 px-3.5 py-2 text-sm font-semibold text-white backdrop-blur-sm transition hover:bg-white/18"
          >
            Sign in
          </Link>
        </nav>
      </header>

      <main className="relative z-10 flex min-h-[calc(100dvh-4.5rem)] flex-col justify-end px-6 pb-16 pt-10 sm:px-10 sm:pb-20 lg:px-14 lg:pb-24">
        <div className="max-w-3xl">
          <p className="landing-rise landing-brand text-[clamp(3.75rem,14vw,8.5rem)] text-white">AILMS</p>
          <div className="landing-rule mt-5 h-px w-24 bg-(--landing-accent) sm:w-32" />
          <h1 className="landing-rise landing-rise-delay-1 landing-headline mt-6 max-w-2xl text-[clamp(1.65rem,4.2vw,2.75rem)] text-white">
            Correspondence, governed by intelligence.
          </h1>
          <p className="landing-rise landing-rise-delay-2 mt-4 max-w-xl text-base leading-relaxed text-(--landing-muted) sm:text-lg">
            Register, track, and close every letter with AI-assisted clarity across departments.
          </p>
          <div className="landing-rise landing-rise-delay-3 mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/login"
              className="inline-flex h-12 items-center justify-center rounded-md bg-(--landing-cta) px-6 text-sm font-semibold text-(--landing-cta-ink) transition hover:bg-white"
            >
              Enter workspace
            </Link>
            <Link
              href="/demo"
              className="inline-flex h-12 items-center justify-center rounded-md border border-white/25 bg-transparent px-6 text-sm font-semibold text-white transition hover:border-white/50 hover:bg-white/8"
            >
              Watch product demo
            </Link>
          </div>
          <p className="landing-rise landing-rise-delay-4 mt-8 text-xs font-medium uppercase tracking-[0.22em] text-white/45">
            Letter lifecycle · Workflow · AI insights
          </p>
        </div>
      </main>
    </div>
  )
}
