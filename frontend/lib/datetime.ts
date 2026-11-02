/** App display timezone — keeps SSR and client hydration aligned. */
const DISPLAY_TZ = 'Asia/Karachi'

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

type CalendarDay = { year: number; month: number; day: number }

function calendarDayFromParts(date: Date): CalendarDay {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DISPLAY_TZ,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date)
  const num = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN)
  return { year: num('year'), month: num('month'), day: num('day') }
}

/** Parse ISO date-only or datetime into a calendar day in the display timezone. */
export function parseCalendarDay(value: string | Date | null | undefined): CalendarDay | null {
  if (value == null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed || trimmed === '—') return null
    const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (iso) {
      return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }
    }
    const date = new Date(trimmed)
    if (Number.isNaN(date.getTime())) return null
    return calendarDayFromParts(date)
  }
  if (Number.isNaN(value.getTime())) return null
  return calendarDayFromParts(value)
}

function todayCalendarDay(now = new Date()): CalendarDay {
  return calendarDayFromParts(now)
}

/** Signed day difference: positive when `to` is after `from`. */
export function calendarDayDiff(from: CalendarDay, to: CalendarDay): number {
  const a = Date.UTC(from.year, from.month - 1, from.day)
  const b = Date.UTC(to.year, to.month - 1, to.day)
  return Math.round((b - a) / 86_400_000)
}

export function formatHeaderDate(date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: DISPLAY_TZ,
  }).format(date)
}

/** `02-May-2025` */
export function formatDashDate(value: string | Date | null | undefined): string {
  const day = parseCalendarDay(value)
  if (!day) return '—'
  const dd = String(day.day).padStart(2, '0')
  const mon = MONTH_SHORT[day.month - 1] ?? 'Jan'
  return `${dd}-${mon}-${day.year}`
}

export function formatDate(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: DISPLAY_TZ,
  }).format(date)
}

export function formatDateTime(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: DISPLAY_TZ,
  }).format(date)
}

export type RelativeDateTone = 'green' | 'amber' | 'orange' | 'red' | 'slate'

export type RelativeDateInfo = {
  label: string
  tone: RelativeDateTone
  /** Class for a compact badge when orange (not in shared Badge tones). */
  badgeClassName?: string
}

const ORANGE_BADGE =
  'border border-orange-200 bg-orange-100 text-orange-900 dark:border-orange-700 dark:bg-orange-950/70 dark:text-orange-200'

function pluralDays(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural
}

/** Relative label for Letter Date / Receive Date (looking back from today). */
export function relativePastDateInfo(
  value: string | Date | null | undefined,
  now = new Date(),
): RelativeDateInfo | null {
  const day = parseCalendarDay(value)
  if (!day) return null
  const ago = calendarDayDiff(day, todayCalendarDay(now))
  if (ago < 0) {
    const ahead = Math.abs(ago)
    return {
      label: ahead === 1 ? 'tomorrow' : `in ${ahead} days`,
      tone: 'slate',
    }
  }
  if (ago === 0) return { label: 'today', tone: 'green' }
  if (ago === 1) return { label: 'yesterday', tone: 'green' }
  const label = `${ago} ${pluralDays(ago, 'day', 'days')} ago`
  if (ago < 7) return { label, tone: 'amber' }
  if (ago < 30) return { label, tone: 'orange', badgeClassName: ORANGE_BADGE }
  return { label, tone: 'red' }
}

/** Relative label for Due Date (remaining vs overdue). */
export function relativeDueDateInfo(
  value: string | Date | null | undefined,
  now = new Date(),
): RelativeDateInfo | null {
  const day = parseCalendarDay(value)
  if (!day) return null
  const remaining = calendarDayDiff(todayCalendarDay(now), day)
  if (remaining > 0) {
    const label =
      remaining === 1 ? '1 day remaining' : `${remaining} days remaining`
    if (remaining <= 7) return { label, tone: 'amber' }
    return { label, tone: 'green' }
  }
  if (remaining === 0) return { label: 'today', tone: 'amber' }
  const overdue = Math.abs(remaining)
  if (overdue === 1) {
    return { label: 'yesterday', tone: 'orange', badgeClassName: ORANGE_BADGE }
  }
  const label = `${overdue} ${pluralDays(overdue, 'day', 'days')} ago`
  if (overdue < 7) return { label, tone: 'orange', badgeClassName: ORANGE_BADGE }
  return { label, tone: 'red' }
}
