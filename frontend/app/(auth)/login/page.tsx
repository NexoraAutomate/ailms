'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { FormEvent, Suspense, useState } from 'react'
import { AlertCircle, Eye, EyeOff, Lock, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/cms/ui'
import { login } from '@/services/auth'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get('next') || '/'

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await login(username.trim(), password)
      router.replace(next.startsWith('/') ? next : '/')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      <label className="block space-y-1.5">
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Username</span>
        <div className="relative">
          <User className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            autoComplete="username"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="h-11 w-full rounded-md border border-slate-200 bg-white pl-10 pr-3 text-sm text-slate-800 outline-none ring-[#0d3763]/focus:ring-2"
            placeholder="arahman"
          />
        </div>
      </label>
      <label className="block space-y-1.5">
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Password</span>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11 w-full rounded-md border border-slate-200 bg-white pl-10 pr-10 text-sm text-slate-800 outline-none ring-[#0d3763]/focus:ring-2"
            placeholder="••••••••"
          />
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </label>
      <Button type="submit" className="h-11 w-full" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>
      <p className="text-center text-xs text-slate-500">
        No account?{' '}
        <Link href="/signup" className="font-semibold text-[#1769aa] hover:underline">
          Create one
        </Link>
      </p>
      <p className="rounded-md bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
        Demo admin: <span className="font-semibold text-slate-700">admin</span> /{' '}
        <span className="font-semibold text-slate-700">Password1</span>
      </p>
    </form>
  )
}

export default function LoginPage() {
  return (
    <div className="flex min-h-dvh">
      <aside className="relative hidden w-[44%] overflow-hidden bg-[#0d3763] lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              'radial-gradient(ellipse at 20% 20%, rgba(59,130,246,0.45), transparent 50%), radial-gradient(ellipse at 80% 80%, rgba(14,165,233,0.25), transparent 45%)',
          }}
        />
        <div className="relative">
          <Logo />
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-blue-200/80">AILMS</p>
          <h1 className="mt-3 max-w-sm text-3xl font-bold leading-tight text-white">
            Correspondence Management System
          </h1>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-blue-100/80">
            Secure access to letter registration, workflow, and departmental correspondence.
          </p>
        </div>
        <p className="relative text-xs text-blue-200/60">Authorized personnel only</p>
      </aside>

      <main className="flex flex-1 flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Logo />
            <div>
              <p className="text-sm font-bold text-[#102a43]">Correspondence</p>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400">Management System</p>
            </div>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-[#102a43]">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">Enter your credentials to continue</p>
          <div className="mt-8">
            <Suspense fallback={<div className="h-48 animate-pulse rounded-md bg-slate-100" />}>
              <LoginForm />
            </Suspense>
          </div>
        </div>
      </main>
    </div>
  )
}
