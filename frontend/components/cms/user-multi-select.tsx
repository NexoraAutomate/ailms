'use client'

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type UserOption = {
  name: string
  department?: string
}

type UserMultiSelectProps = {
  users: UserOption[]
  value: string[]
  onChange: (next: string[]) => void
  /** Names that cannot be selected (e.g. already in the other field, or self). */
  exclude?: string[]
  placeholder?: string
  disabled?: boolean
  className?: string
  'aria-label'?: string
  /** Highlighted badge (e.g. whose private editor is open). */
  activeValue?: string | null
  /** Fired when a badge is clicked (not the remove control). */
  onActiveChange?: (name: string) => void
  /** Optional content rendered inside each selected badge (e.g. action picker). */
  renderBadgeExtra?: (name: string) => ReactNode
}

function norm(s: string) {
  return (s || '').trim().toLowerCase()
}

export function UserMultiSelect({
  users,
  value,
  onChange,
  exclude = [],
  placeholder = 'Type a name…',
  disabled = false,
  className,
  'aria-label': ariaLabel,
  activeValue = null,
  onActiveChange,
  renderBadgeExtra,
}: UserMultiSelectProps) {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  const selectedSet = useMemo(() => new Set(value.map(norm)), [value])
  const excludeSet = useMemo(() => new Set(exclude.map(norm)), [exclude])

  const suggestions = useMemo(() => {
    const q = norm(query)
    return users
      .filter((u) => {
        const n = norm(u.name)
        if (!n || selectedSet.has(n) || excludeSet.has(n)) return false
        if (!q) return true
        return n.includes(q) || norm(u.department || '').includes(q)
      })
      .slice(0, 8)
  }, [excludeSet, query, selectedSet, users])

  useEffect(() => {
    setActiveIndex(0)
  }, [suggestions.length, query])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const add = (name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    if (selectedSet.has(norm(trimmed)) || excludeSet.has(norm(trimmed))) return
    onChange([...value, trimmed])
    onActiveChange?.(trimmed)
    setQuery('')
    setOpen(true)
    inputRef.current?.focus()
  }

  const remove = (name: string) => {
    const n = norm(name)
    const next = value.filter((v) => norm(v) !== n)
    onChange(next)
    if (activeValue && norm(activeValue) === n) {
      onActiveChange?.(next[next.length - 1] ?? '')
    }
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <div
        className={cn(
          'flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1.5',
          'focus-within:border-slate-400 focus-within:ring-1 focus-within:ring-slate-300',
          disabled && 'pointer-events-none opacity-60',
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((name) => {
          const isActive = Boolean(activeValue && norm(activeValue) === norm(name))
          return (
            <span
              key={name}
              role={onActiveChange ? 'button' : undefined}
              tabIndex={onActiveChange && !disabled ? 0 : undefined}
              aria-pressed={onActiveChange ? isActive : undefined}
              className={cn(
                'inline-flex max-w-full items-center gap-1 rounded-md py-0.5 pr-1 pl-2 text-xs font-medium',
                isActive
                  ? 'bg-sky-100 text-sky-900 ring-1 ring-sky-300'
                  : 'bg-slate-100 text-slate-800 hover:bg-slate-200/80',
                onActiveChange && 'cursor-pointer',
              )}
              onClick={(e) => {
                e.stopPropagation()
                onActiveChange?.(name)
              }}
              onKeyDown={(e) => {
                if (!onActiveChange) return
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  e.stopPropagation()
                  onActiveChange(name)
                }
              }}
            >
              <span className="truncate">{name}</span>
              {renderBadgeExtra?.(name)}
              <button
                type="button"
                className="rounded p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-800"
                aria-label={`Remove ${name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  remove(name)
                }}
              >
                <X className="size-3" />
              </button>
            </span>
          )
        })}
        <input
          ref={inputRef}
          type="text"
          value={query}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={open}
          role="combobox"
          placeholder={value.length ? '' : placeholder}
          className="min-w-[8rem] flex-1 border-0 bg-transparent py-0.5 text-sm outline-none placeholder:text-slate-400"
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !query && value.length) {
              remove(value[value.length - 1]!)
              return
            }
            if (e.key === 'Escape') {
              setOpen(false)
              return
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setOpen(true)
              setActiveIndex((i) => Math.min(i + 1, Math.max(0, suggestions.length - 1)))
              return
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActiveIndex((i) => Math.max(0, i - 1))
              return
            }
            if (e.key === 'Enter') {
              e.preventDefault()
              const pick = suggestions[activeIndex]
              if (pick) add(pick.name)
            }
          }}
        />
      </div>
      {open && suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {suggestions.map((u, idx) => (
            <li key={u.name} role="option" aria-selected={idx === activeIndex}>
              <button
                type="button"
                className={cn(
                  'flex w-full flex-col items-start px-3 py-1.5 text-left text-sm',
                  idx === activeIndex ? 'bg-slate-100' : 'hover:bg-slate-50',
                )}
                onMouseEnter={() => setActiveIndex(idx)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add(u.name)}
              >
                <span className="font-medium text-slate-800">{u.name}</span>
                {u.department ? (
                  <span className="text-[11px] text-slate-500">{u.department}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
