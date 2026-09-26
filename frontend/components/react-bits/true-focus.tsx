'use client'

import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'

interface TrueFocusProps {
  sentence?: string
  separator?: string
  manualMode?: boolean
  blurAmount?: number
  borderColor?: string
  glowColor?: string
  animationDuration?: number
  pauseBetweenAnimations?: number
  className?: string
  wordClassName?: string
}

interface FocusRect {
  x: number
  y: number
  width: number
  height: number
}

export default function TrueFocus({
  sentence = 'True Focus',
  separator = ' ',
  manualMode = false,
  blurAmount = 5,
  borderColor = 'green',
  glowColor = 'rgba(0, 255, 0, 0.6)',
  animationDuration = 0.5,
  pauseBetweenAnimations = 1,
  className = '',
  wordClassName = 'text-[3rem] font-black',
}: TrueFocusProps) {
  const words = sentence.split(separator)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [lastActiveIndex, setLastActiveIndex] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([])
  const [focusRect, setFocusRect] = useState<FocusRect>({ x: 0, y: 0, width: 0, height: 0 })

  useEffect(() => {
    if (manualMode) return
    const interval = setInterval(
      () => setCurrentIndex((prev) => (prev + 1) % words.length),
      (animationDuration + pauseBetweenAnimations) * 1000,
    )
    return () => clearInterval(interval)
  }, [manualMode, animationDuration, pauseBetweenAnimations, words.length])

  useEffect(() => {
    if (!wordRefs.current[currentIndex] || !containerRef.current) return
    const parentRect = containerRef.current.getBoundingClientRect()
    const activeRect = wordRefs.current[currentIndex]!.getBoundingClientRect()
    setFocusRect({
      x: activeRect.left - parentRect.left,
      y: activeRect.top - parentRect.top,
      width: activeRect.width,
      height: activeRect.height,
    })
  }, [currentIndex, words.length])

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-wrap items-center justify-start gap-x-4 gap-y-3 ${className}`.trim()}
      style={{ outline: 'none', userSelect: 'none' }}
    >
      {words.map((word, index) => {
        const isActive = index === currentIndex
        return (
          <span
            key={index}
            ref={(el) => {
              wordRefs.current[index] = el
            }}
            className={`relative cursor-pointer ${wordClassName}`}
            style={{
              filter: isActive ? 'blur(0px)' : `blur(${blurAmount}px)`,
              transition: `filter ${animationDuration}s ease`,
              outline: 'none',
              userSelect: 'none',
            }}
            onMouseEnter={() => {
              if (manualMode) {
                setLastActiveIndex(index)
                setCurrentIndex(index)
              }
            }}
            onMouseLeave={() => {
              if (manualMode && lastActiveIndex !== null) setCurrentIndex(lastActiveIndex)
            }}
          >
            {word}
          </span>
        )
      })}

      <motion.div
        className="pointer-events-none absolute top-0 left-0 box-border border-0"
        animate={{
          x: focusRect.x,
          y: focusRect.y,
          width: focusRect.width,
          height: focusRect.height,
          opacity: currentIndex >= 0 ? 1 : 0,
        }}
        transition={{ duration: animationDuration }}
        style={
          {
            '--border-color': borderColor,
            '--glow-color': glowColor,
          } as React.CSSProperties
        }
      >
        <span
          className="absolute top-[-8px] left-[-8px] h-3 w-3 rounded-[3px] border-[2.5px] border-r-0 border-b-0"
          style={{
            borderColor: 'var(--border-color)',
            filter: 'drop-shadow(0 0 4px var(--border-color))',
          }}
        />
        <span
          className="absolute top-[-8px] right-[-8px] h-3 w-3 rounded-[3px] border-[2.5px] border-l-0 border-b-0"
          style={{
            borderColor: 'var(--border-color)',
            filter: 'drop-shadow(0 0 4px var(--border-color))',
          }}
        />
        <span
          className="absolute bottom-[-8px] left-[-8px] h-3 w-3 rounded-[3px] border-[2.5px] border-r-0 border-t-0"
          style={{
            borderColor: 'var(--border-color)',
            filter: 'drop-shadow(0 0 4px var(--border-color))',
          }}
        />
        <span
          className="absolute right-[-8px] bottom-[-8px] h-3 w-3 rounded-[3px] border-[2.5px] border-l-0 border-t-0"
          style={{
            borderColor: 'var(--border-color)',
            filter: 'drop-shadow(0 0 4px var(--border-color))',
          }}
        />
      </motion.div>
    </div>
  )
}
