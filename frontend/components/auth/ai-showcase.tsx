'use client'

import { useEffect, useState } from 'react'
import ThoughtLine from '@/components/react-bits/thought-line'
import AiHologramOrbit from '@/components/auth/ai-hologram-orbit'

const AI_STEPS = [
  'Reading scanned correspondence…',
  'Extracting entities & deadlines…',
  'Classifying priority with Smart Analysis…',
  'Drafting management insights…',
  'Preparing for review…',
  'Reviewing draft…',
  'Summarizing insights…',
]

const STEP_MS = 800
const HOLD_MS = 1600
const RESTART_MS = 1400

type AiShowcaseProps = {
  className?: string
  /** When false, hide Thought Line (sequenced separately on login). */
  showThinking?: boolean
  /** When false, hide hologram visual. */
  showHologram?: boolean
}

/** AI showcase: holographic orbit visual + progressive Thought Line */
export default function AiShowcase({
  className = '',
  showThinking = true,
  showHologram = true,
}: AiShowcaseProps) {
  const [cycle, setCycle] = useState(0)
  const [visibleCount, setVisibleCount] = useState(0)
  const [working, setWorking] = useState(true)

  useEffect(() => {
    if (!showThinking) return

    setVisibleCount(0)
    setWorking(true)

    const timers: ReturnType<typeof setTimeout>[] = []

    AI_STEPS.forEach((_, index) => {
      timers.push(
        setTimeout(() => {
          setVisibleCount(index + 1)
        }, (index + 1) * STEP_MS),
      )
    })

    timers.push(
      setTimeout(() => {
        setWorking(false)
      }, AI_STEPS.length * STEP_MS + HOLD_MS),
    )

    timers.push(
      setTimeout(() => {
        setVisibleCount(0)
        setWorking(true)
        setCycle((c) => c + 1)
      }, AI_STEPS.length * STEP_MS + HOLD_MS + RESTART_MS),
    )

    return () => timers.forEach(clearTimeout)
  }, [cycle, showThinking])

  const visibleSteps = AI_STEPS.slice(0, visibleCount)

  if (!showHologram && !showThinking) return null

  return (
    <div className={`w-full max-w-full overflow-hidden rounded-xl border border-sky-300/25 bg-[#061830]/55 ${className}`.trim()}>
      {showHologram && <AiHologramOrbit className="mx-auto max-h-[min(52vw,22rem)] w-full max-w-full" />}

      {showThinking && (
        <div className={`min-h-34 px-3 py-3 ${showHologram ? 'border-t border-white/10' : ''}`.trim()}>
          <ThoughtLine
            key={cycle}
            label="AI thinking…"
            doneLabel="Smart Analysis ready"
            glyph="sparkle"
            color="#e0f2fe"
            glyphColor="#7dd3fc"
            fontSize={10}
            collapseOnSettle={false}
            collapsible={false}
            working={working}
            settleAfter={0}
            showTimer
            steps={visibleSteps}
            className="w-full max-w-full"
          />
        </div>
      )}
    </div>
  )
}
