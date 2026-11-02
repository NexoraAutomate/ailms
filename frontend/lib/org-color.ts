import type { CSSProperties } from 'react'

/** Normalize organization color to `#RRGGBB` or empty. */
export function normalizeOrgColor(value?: string | null): string {
  const raw = (value || '').trim()
  if (!raw) return ''
  const hex = raw.startsWith('#') ? raw : `#${raw}`
  if (/^#[0-9A-Fa-f]{6}$/.test(hex)) return hex.toUpperCase()
  if (/^#[0-9A-Fa-f]{3}$/.test(hex)) {
    const [, r, g, b] = hex
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase()
  }
  return ''
}

function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase()
  return `${hex}${a}`
}

/** Soft tint for From/To correspondent cards. */
export function organizationCardStyle(color?: string | null): CSSProperties | undefined {
  const hex = normalizeOrgColor(color)
  if (!hex) return undefined
  return {
    borderColor: withAlpha(hex, 0.45),
    backgroundColor: withAlpha(hex, 0.12),
  }
}

export const ORG_COLOR_PRESETS = [
  '#1D4ED8',
  '#0369A1',
  '#0F766E',
  '#15803D',
  '#4F46E5',
  '#7C3AED',
  '#C2410C',
  '#B45309',
  '#BE123C',
  '#334155',
] as const
