'use client'

import { cn } from '@/lib/utils'
import { isRichTextEmpty, sanitizeRichHtml } from '@/lib/rich-text'

type RichTextHtmlProps = {
  html: string | null | undefined
  className?: string
  emptyFallback?: string
}

/** Safe HTML renderer for drafted / published rich-text messages. */
export function RichTextHtml({ html, className, emptyFallback }: RichTextHtmlProps) {
  if (isRichTextEmpty(html)) {
    if (!emptyFallback) return null
    return <p className={cn('text-sm text-slate-400', className)}>{emptyFallback}</p>
  }

  const safe = sanitizeRichHtml(html)
  return (
    <div
      className={cn(
        'rich-text-body prose prose-sm max-w-none text-sm leading-relaxed text-slate-700',
        '[&_a]:text-sky-700 [&_a]:underline',
        '[&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5',
        '[&_p]:my-1 [&_h1]:my-1.5 [&_h1]:text-lg [&_h1]:font-bold',
        '[&_h2]:my-1 [&_h2]:text-base [&_h2]:font-bold [&_h3]:my-1 [&_h3]:text-sm [&_h3]:font-semibold',
        '[&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_blockquote]:text-slate-600',
        '[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse',
        '[&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-100 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold',
        '[&_td]:border [&_td]:border-slate-300 [&_td]:px-2 [&_td]:py-1',
        'dark:[&_th]:border-slate-600 dark:[&_th]:bg-slate-800 dark:[&_td]:border-slate-600',
        className,
      )}
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  )
}
