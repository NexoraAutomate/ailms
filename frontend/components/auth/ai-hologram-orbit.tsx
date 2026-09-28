'use client'

/** 15s AI animation clip for login showcase (step 1 only). */
export default function AiHologramOrbit({ className = '' }: { className?: string }) {
  return (
    <div
      className={`ai-holo relative isolate aspect-square w-full overflow-hidden rounded-xl bg-black ${className}`.trim()}
      role="img"
      aria-label="AI hologram animation"
    >
      <video
        className="absolute inset-0 size-full object-contain"
        src="/auth/ai-animation-15s.mp4"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
      />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-4 bg-linear-to-t from-[#040a14]/90 via-[#040a14]/20 to-transparent px-3 pb-2.5 pt-10">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-sky-200/80">Artificial Intelligence</p>
        <p className="mt-0.5 text-sm font-bold leading-tight text-white sm:text-base">Smart Analysis for every letter</p>
      </div>
    </div>
  )
}
