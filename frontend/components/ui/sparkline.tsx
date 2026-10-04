'use client'

import { useId, useMemo } from 'react'

type Point = { x: number; y: number }

/** Catmull–Rom → cubic Bézier for a continuous smooth curve. */
function smoothLinePath(points: Point[]) {
  if (!points.length) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`
  }

  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
  }
  return d
}

function smoothAreaPath(points: Point[], bottom: number) {
  const line = smoothLinePath(points)
  if (!line || !points.length) return ''
  const first = points[0]
  const last = points[points.length - 1]
  return `${line} L ${last.x.toFixed(2)} ${bottom} L ${first.x.toFixed(2)} ${bottom} Z`
}

/** Minimal sparkline — smooth curve, no axes/grid/labels. */
export function Sparkline({
  values,
  className = '',
  stroke = '#1769aa',
  fill = 'rgba(23, 105, 170, 0.12)',
}: {
  values: number[]
  className?: string
  stroke?: string
  fill?: string
}) {
  const gradId = useId().replace(/:/g, '')
  const { line, area } = useMemo(() => {
    const series = values.length ? values : [0]
    const max = Math.max(...series, 1)
    const min = Math.min(...series, 0)
    const span = Math.max(max - min, 1)
    const w = 100
    const h = 28
    const pad = 2
    const points = series.map((v, i) => {
      const x = series.length === 1 ? w / 2 : (i / (series.length - 1)) * w
      const y = h - pad - ((v - min) / span) * (h - pad * 2)
      return { x, y }
    })
    return {
      line: smoothLinePath(points),
      area: smoothAreaPath(points, h),
    }
  }, [values])

  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fill} />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
