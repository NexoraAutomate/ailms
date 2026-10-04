'use client'

import type { ComponentType, MouseEventHandler } from 'react'
import { cn } from '@/lib/utils'

type IconActionButtonProps = {
  label: string
  icon: ComponentType<{ className?: string }>
  onClick?: MouseEventHandler<HTMLButtonElement>
  disabled?: boolean
  tone?: 'default' | 'danger'
  className?: string
}

/** Icon-only action: no default background; hover fills + native tooltip (label). */
export function IconActionButton({
  label,
  icon: Icon,
  onClick,
  disabled,
  tone = 'default',
  className,
}: IconActionButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex size-6 items-center justify-center rounded-md bg-transparent transition-colors disabled:pointer-events-none disabled:opacity-40',
        tone === 'danger'
          ? 'text-slate-400 hover:bg-red-50 hover:text-red-600'
          : 'text-slate-400 hover:bg-slate-100 hover:text-[#1769aa]',
        className,
      )}
    >
      <Icon className="size-3" />
    </button>
  )
}
