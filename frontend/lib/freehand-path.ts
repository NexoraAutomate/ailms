import getStroke from 'perfect-freehand'

export type FreehandPoint = [number, number, number]

/** Convert pointer samples into an SVG path using perfect-freehand. */
export function strokeToSvgPath(
  points: FreehandPoint[],
  options?: {
    size?: number
    thinning?: number
    smoothing?: number
    streamline?: number
  },
): string {
  if (points.length === 0) return ''
  const input = points.map(([x, y, pressure]) => [x, y, pressure] as number[])
  const outline = getStroke(input, {
    size: options?.size ?? 6,
    thinning: options?.thinning ?? 0.55,
    smoothing: options?.smoothing ?? 0.5,
    streamline: options?.streamline ?? 0.5,
    last: true,
  })
  if (!outline.length) return ''
  const [first, ...rest] = outline
  if (!first) return ''
  let d = `M ${first[0]} ${first[1]}`
  for (const [x, y] of rest) {
    d += ` L ${x} ${y}`
  }
  d += ' Z'
  return d
}
