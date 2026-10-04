'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'

export function personInitials(name: string) {
  const parts = name.trim().replace(/\./g, '').split(/\s+/).filter(Boolean)
  if (!parts.length) return 'U'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
}

function needsAuthFetch(src: string) {
  return src.startsWith('/api/') || src.includes('/api/users/')
}

type UserAvatarProps = {
  name: string
  avatarUrl?: string | null
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
  imgClassName?: string
  ring?: boolean
}

const SIZE: Record<NonNullable<UserAvatarProps['size']>, string> = {
  sm: 'size-8 text-[11px]',
  md: 'size-9 text-[11px]',
  lg: 'size-16 text-lg',
  xl: 'size-12 text-sm',
}

/**
 * Renders a profile photo. API avatar paths are fetched with the auth token
 * (plain <img src="/api/..."> cannot send Authorization and often 401s).
 * data:/blob:/http(s) URLs are shown directly.
 */
export function UserAvatar({
  name,
  avatarUrl,
  size = 'md',
  className,
  imgClassName,
  ring = true,
}: UserAvatarProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const src = (avatarUrl || '').trim()
  const initials = personInitials(name)

  useEffect(() => {
    setFailed(false)
    setObjectUrl(null)
    if (!src || !needsAuthFetch(src)) return

    let cancelled = false
    let created: string | null = null

    ;(async () => {
      try {
        const blob = await api.download(src)
        if (cancelled) return
        created = URL.createObjectURL(blob)
        setObjectUrl(created)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()

    return () => {
      cancelled = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [src])

  const displaySrc = !src || failed
    ? null
    : needsAuthFetch(src)
      ? objectUrl
      : src

  const shell = cn(
    'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#dce9f7] font-bold text-[#0d3763]',
    SIZE[size],
    ring && 'ring-1 ring-slate-200',
    className,
  )

  if (displaySrc) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={displaySrc}
        alt={name}
        className={cn(shell, 'object-cover', imgClassName)}
        onError={() => setFailed(true)}
      />
    )
  }

  // Auth fetch in progress — keep initials shell so layout does not jump.
  return <span className={shell}>{initials}</span>
}
