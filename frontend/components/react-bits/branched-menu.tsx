'use client'

import React, {
  isValidElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import {
  CursorPointer01Icon,
  Download04Icon,
  Layers01Icon,
  Notification03Icon,
  PaintBoardIcon,
  Rocket01Icon,
  Settings02Icon,
  TextFontIcon,
} from '@hugeicons/core-free-icons'

export interface BranchedMenuChild {
  value: string
  label: string
  icon?: ReactNode | IconSvgElement
}

export interface BranchedMenuItem {
  label: string
  value?: string
  children?: BranchedMenuChild[]
}

export interface BranchedMenuProps {
  items?: BranchedMenuItem[]
  defaultOpen?: number | number[]
  defaultActive?: string
  /** Controlled active child value */
  active?: string
  onSelect?: (value: string, item: BranchedMenuChild | BranchedMenuItem) => void
  onToggle?: (index: number, open: boolean) => void
  color?: string
  accentColor?: string
  lineColor?: string
  width?: number
  rowHeight?: number
  indent?: number
  trunk?: number
  radius?: number
  lineWidth?: number
  fontSize?: number
  drawDuration?: number
  foldDuration?: number
  /** Auto-cycle child nodes one-by-one with current-flow lines */
  autoCycle?: boolean
  /** Ms between each child current pulse (default 2200) */
  autoCycleInterval?: number
  /** Which open section index to auto-cycle (default first open with children) */
  autoCycleSection?: number
  className?: string
}

const DEFAULT_ITEMS: BranchedMenuItem[] = [
  {
    label: 'Getting started',
    children: [
      { value: 'install', label: 'Installation', icon: Download04Icon },
      { value: 'quick', label: 'Quick start', icon: Rocket01Icon },
      { value: 'config', label: 'Configuration', icon: Settings02Icon },
      { value: 'theming', label: 'Theming', icon: PaintBoardIcon },
    ],
  },
  {
    label: 'Components',
    children: [
      { value: 'buttons', label: 'Buttons', icon: CursorPointer01Icon },
      { value: 'typography', label: 'Typography', icon: TextFontIcon },
      { value: 'overlays', label: 'Overlays', icon: Layers01Icon },
      { value: 'toasts', label: 'Toasts', icon: Notification03Icon },
    ],
  },
]
const PAD = 6
const MARK = 16

const renderIcon = (icon: ReactNode | IconSvgElement) =>
  isValidElement(icon) ? icon : <HugeiconsIcon icon={icon as IconSvgElement} size={16} strokeWidth={1.8} />
const toSet = (open: number | number[]) => new Set(Array.isArray(open) ? open : open >= 0 ? [open] : [])

const BranchedMenu: React.FC<BranchedMenuProps> = ({
  items = DEFAULT_ITEMS,
  defaultOpen = 0,
  defaultActive = '',
  active: activeProp,
  onSelect,
  onToggle,
  color = '#f5f5f5',
  accentColor = '#f5f5f5',
  lineColor = '#3f3f46',
  width = 240,
  rowHeight = 36,
  indent = 40,
  trunk = 14,
  radius = 10,
  lineWidth = 1.5,
  fontSize = 14,
  drawDuration = 400,
  foldDuration = 300,
  autoCycle = false,
  autoCycleInterval = 2200,
  autoCycleSection,
  className = '',
}) => {
  const [open, setOpen] = useState<Set<number>>(() => toSet(defaultOpen))
  const [activeInternal, setActiveInternal] = useState(() => {
    if (defaultActive) return defaultActive
    const first = items.find((it, i) => it.children && toSet(defaultOpen).has(i))
    return first?.children?.[0]?.value ?? ''
  })
  const active = activeProp ?? activeInternal
  const setActive = (value: string) => {
    if (activeProp === undefined) setActiveInternal(value)
  }

  const navRef = useRef<HTMLElement>(null)
  const heads = useRef<(HTMLButtonElement | null)[]>([])
  const markerRef = useRef<HTMLSpanElement>(null)
  const latest = useRef<{ onSelect?: BranchedMenuProps['onSelect']; onToggle?: BranchedMenuProps['onToggle'] }>({})
  latest.current = { onSelect, onToggle }

  const cycleSection =
    autoCycleSection ?? items.findIndex((it, i) => open.has(i) && (it.children?.length ?? 0) > 0)

  useEffect(() => {
    if (!autoCycle || cycleSection < 0) return
    const kids = items[cycleSection]?.children
    if (!kids?.length) return

    setOpen((prev) => {
      if (prev.has(cycleSection)) return prev
      const next = new Set(prev)
      next.add(cycleSection)
      return next
    })

    let index = 0
    const apply = (i: number) => {
      const next = kids[i]
      setActive(next.value)
      latest.current.onSelect?.(next.value, next)
    }

    apply(0)

    const id = setInterval(() => {
      index = (index + 1) % kids.length
      apply(index)
    }, autoCycleInterval)

    return () => clearInterval(id)
    // Intentionally omit active — interval owns the cycle
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCycle, autoCycleInterval, cycleSection, items])

  const activeSection = items.findIndex((it) => it.children?.some((kid) => kid.value === active))
  const markerShown = activeSection >= 0 && open.has(activeSection)
  useLayoutEffect(() => {
    const place = (glide: boolean) => {
      const m = markerRef.current
      const el = heads.current[activeSection]
      if (!m) return
      const on = markerShown && el
      if (!glide) m.style.transition = 'none'
      if (on) m.style.top = `${el.offsetTop + (el.offsetHeight - MARK) / 2}px`
      m.toggleAttribute('data-on', Boolean(on))
      if (!glide) {
        void m.offsetHeight
        m.style.transition = ''
      }
    }
    place(true)
    let first = true
    const ro = new ResizeObserver(() => {
      if (first) {
        first = false
        return
      }
      place(false)
    })
    if (navRef.current) ro.observe(navRef.current)
    return () => ro.disconnect()
  }, [activeSection, markerShown, items, fontSize, rowHeight])

  const select = (value: string, item: BranchedMenuChild | BranchedMenuItem) => {
    setActive(value)
    latest.current.onSelect?.(value, item)
  }
  const toggle = (i: number) => {
    setOpen((prev) => {
      const next = new Set(prev)
      const isOpen = !next.has(i)
      if (isOpen) next.add(i)
      else next.delete(i)
      latest.current.onToggle?.(i, isOpen)
      return next
    })
  }

  const r = Math.min(radius, rowHeight / 2 - 2)
  const endX = indent - 8
  const rowY = (k: number) => PAD + k * rowHeight + rowHeight / 2
  const branch = (k: number) => `M ${trunk} ${rowY(k) - r} A ${r} ${r} 0 0 0 ${trunk + r} ${rowY(k)} H ${endX}`
  const reach = (k: number) => `M ${trunk} 0 V ${rowY(k) - r} A ${r} ${r} 0 0 0 ${trunk + r} ${rowY(k)} H ${endX}`
  const length = (k: number) => rowY(k) - r + (Math.PI * r) / 2 + (endX - trunk - r)

  return (
    <nav
      ref={navRef}
      className={`bm-nav relative flex w-full max-w-full min-w-0 flex-col pl-3.5 leading-[1.2] [color:var(--bm-ink)] [font-family:inherit] [font-size:var(--bm-font)] before:absolute before:top-2 before:bottom-0 before:left-0 before:w-0.5 before:rounded-[1px] before:[background:linear-gradient(to_bottom,var(--bm-line)_0%,var(--bm-line)_55%,transparent_100%)] before:content-['']${className ? ` ${className}` : ''}`}
      style={
        {
          '--bm-w': `${width}px`,
          '--bm-ink': color,
          '--bm-accent': accentColor,
          '--bm-line': lineColor,
          '--bm-font': `${fontSize}px`,
          '--bm-row': `${rowHeight}px`,
          '--bm-indent': `${indent}px`,
          '--bm-line-w': lineWidth,
          '--bm-draw': `${drawDuration}ms`,
          '--bm-muted': `color-mix(in srgb, ${color} 55%, transparent)`,
          '--bm-fold': `${foldDuration}ms`,
        } as CSSProperties
      }
    >
      <span
        ref={markerRef}
        className="absolute -top-px left-0 z-[1] h-4 w-0.5 rounded-[1px] opacity-0 [background:var(--bm-accent)] [transition:top_220ms_cubic-bezier(0.23,1,0.32,1),opacity_150ms_ease] data-[on]:opacity-100 motion-reduce:[transition:opacity_150ms_ease]"
        aria-hidden="true"
      />
      {items.map((item, i) => {
        const kids = item.children
        const isOpen = kids ? open.has(i) : false
        const leafValue = item.value ?? item.label
        const leafActive = !kids && leafValue === active
        const bodyH = kids ? PAD * 2 + kids.length * rowHeight : 0
        return (
          <div key={item.value ?? item.label} className="group/section flex flex-col" data-open={isOpen ? '' : undefined}>
            <button
              ref={(el) => {
                heads.current[i] = el
              }}
              type="button"
              className="m-0 block cursor-pointer border-0 bg-transparent py-[9px] text-left font-medium outline-none [color:var(--bm-muted)] [font-family:inherit] [font-size:calc(var(--bm-font)+1px)] [-webkit-tap-highlight-color:transparent] [transition:color_200ms_ease] group-data-[open]/section:[color:var(--bm-ink)] data-[active]:[color:var(--bm-ink)] hover:[color:var(--bm-ink)]"
              aria-expanded={kids ? isOpen : undefined}
              aria-current={leafActive ? 'true' : undefined}
              data-active={leafActive ? '' : undefined}
              onClick={() => (kids ? toggle(i) : select(leafValue, item))}
            >
              {item.label}
            </button>
            {kids ? (
              <div className="grid [grid-template-rows:0fr] [transition:grid-template-rows_var(--bm-fold)_cubic-bezier(0.23,1,0.32,1)] group-data-[open]/section:[grid-template-rows:1fr] motion-reduce:transition-none">
                <div className="min-h-0 overflow-hidden">
                  <div className="relative box-border py-1.5" style={{ height: bodyH }}>
                    <svg
                      className="pointer-events-none absolute top-0 left-0 overflow-visible opacity-0 [transition:opacity_200ms_ease] group-data-[open]/section:opacity-100 group-data-[open]/section:[transition:opacity_250ms_ease_100ms]"
                      width={indent}
                      height={bodyH}
                      aria-hidden="true"
                    >
                      <path
                        className="fill-none [stroke:var(--bm-line)] [stroke-width:var(--bm-line-w)] [stroke-linecap:round] [stroke-linejoin:round]"
                        d={`M ${trunk} 0 V ${rowY(kids.length - 1) - r}`}
                      />
                      {kids.map((kid, k) => (
                        <path
                          key={kid.value}
                          className="fill-none [stroke:var(--bm-line)] [stroke-width:var(--bm-line-w)] [stroke-linecap:round] [stroke-linejoin:round]"
                          d={branch(k)}
                        />
                      ))}
                      {kids.map((kid, k) => {
                        const isLit = kid.value === active
                        const len = length(k)
                        return (
                          <g key={`flow-${kid.value}`}>
                            <path
                              className="bm-current-draw fill-none [stroke:var(--bm-accent)] [stroke-width:calc(var(--bm-line-w)+0.75)] [stroke-linecap:round] [stroke-linejoin:round]"
                              d={reach(k)}
                              pathLength={100}
                              style={{
                                strokeDasharray: 100,
                                strokeDashoffset: isLit ? 0 : 100,
                                transition: `stroke-dashoffset var(--bm-draw) cubic-bezier(0.23, 1, 0.32, 1)`,
                                filter: isLit ? 'drop-shadow(0 0 4px var(--bm-accent))' : undefined,
                              }}
                            />
                            {isLit ? (
                              <path
                                className="bm-current-pulse fill-none [stroke:var(--bm-accent)] [stroke-width:calc(var(--bm-line-w)+1.5)] [stroke-linecap:round] [stroke-linejoin:round]"
                                d={reach(k)}
                                style={{
                                  strokeDasharray: `${Math.max(10, len * 0.18)} ${len}`,
                                  strokeDashoffset: 0,
                                }}
                              />
                            ) : null}
                          </g>
                        )
                      })}
                    </svg>
                    {kids.map((kid) => {
                      const isLit = kid.value === active
                      return (
                        <button
                          key={kid.value}
                          type="button"
                          className="bm-child m-0 box-border flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent py-0 pr-0 text-left outline-none [height:var(--bm-row)] [padding-left:var(--bm-indent)] [color:var(--bm-muted)] [font-family:inherit] [-webkit-tap-highlight-color:transparent] [transition:color_200ms_ease,opacity_250ms_ease,transform_250ms_ease] hover:[color:var(--bm-ink)] data-[active]:font-medium data-[active]:[color:var(--bm-accent)]"
                          aria-current={isLit ? 'true' : undefined}
                          data-active={isLit ? '' : undefined}
                          tabIndex={isOpen ? 0 : -1}
                          onClick={() => select(kid.value, kid)}
                        >
                          {kid.icon ? (
                            <span
                              className={`inline-flex flex-none transition-transform duration-300 ${isLit ? 'scale-110 drop-shadow-[0_0_6px_var(--bm-accent)]' : ''}`}
                              aria-hidden="true"
                            >
                              {renderIcon(kid.icon)}
                            </span>
                          ) : null}
                          <span className="min-w-0 truncate">{kid.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )
      })}
    </nav>
  )
}

export default BranchedMenu
