'use client'

import Image from 'next/image'

/** Hand + Ai base with exact photo ring/icons rotating around center. */
export default function AiHologramOrbit({ className = '' }: { className?: string }) {
  return (
    <div
      className={`ai-holo relative isolate aspect-square w-full overflow-hidden rounded-xl bg-[#040a14] ${className}`.trim()}
      role="img"
      aria-label="AI hologram with orbiting analysis icons"
    >
      <Image
        src="/auth/ai-hologram-base.png"
        alt=""
        fill
        priority={false}
        sizes="(max-width: 1024px) 90vw, 420px"
        className="object-contain"
      />

      {/* Pulsing core glow over Ai chip (center of square crop) */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-2 -translate-x-1/2 -translate-y-1/2">
        <div className="ai-holo-core-bloom size-24 rounded-full bg-sky-300/25 blur-2xl sm:size-28" />
      </div>

      {/* Exact ring + icons from photo — spins around Ai (image center) */}
      <div className="ai-holo-spin pointer-events-none absolute inset-0 z-3">
        <Image
          src="/auth/ai-hologram-orbit.png"
          alt=""
          fill
          priority={false}
          sizes="(max-width: 1024px) 90vw, 420px"
          className="object-contain drop-shadow-[0_0_12px_rgba(125,211,252,0.35)]"
        />
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-4 bg-linear-to-t from-[#040a14]/90 via-[#040a14]/20 to-transparent px-3 pb-2.5 pt-10">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-sky-200/80">Artificial Intelligence</p>
        <p className="mt-0.5 text-sm font-bold leading-tight text-white sm:text-base">Smart Analysis for every letter</p>
      </div>
    </div>
  )
}
