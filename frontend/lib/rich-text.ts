import DOMPurify from 'isomorphic-dompurify'

const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'strike',
  'a',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'blockquote',
  'span',
  'mark',
  'div',
]

const ALLOWED_ATTR = ['href', 'target', 'rel', 'style', 'class']

/** True when HTML has no visible text. */
export function isRichTextEmpty(html: string | null | undefined): boolean {
  const raw = (html || '').trim()
  if (!raw) return true
  const text = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return !text
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Convert legacy plain-text notes to simple HTML for the editor / display. */
export function normalizeRichHtml(raw: string | null | undefined): string {
  const s = (raw || '').trim()
  if (!s) return ''
  if (/<[a-z][\s\S]*>/i.test(s)) return s
  const escaped = escapeHtml(s).replace(/\r\n|\r|\n/g, '<br>')
  return `<p>${escaped}</p>`
}

/** Sanitize HTML for safe rendering of composed messages. */
export function sanitizeRichHtml(html: string | null | undefined): string {
  const normalized = normalizeRichHtml(html)
  if (!normalized) return ''
  return DOMPurify.sanitize(normalized, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  })
}

/** Stable key for deduping common notes that may differ only by whitespace in HTML. */
export function richTextDedupeKey(html: string | null | undefined): string {
  return (html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}
