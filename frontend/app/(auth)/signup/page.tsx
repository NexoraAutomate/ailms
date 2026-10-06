'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'
import { AlertCircle, Building2, Eye, EyeOff, Lock, Mail, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/cms/ui'
import { signup } from '@/services/auth'

export default function SignupPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [department, setDepartment] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    setBusy(true)
    try {
      await signup({
        name: name.trim(),
        username: username.trim().toLowerCase(),
        password,
        email: email.trim(),
        department: department.trim(),
      })
      router.replace('/')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create account')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh">
      <aside className="relative hidden w-[44%] overflow-hidden bg-[#0d3763] lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              'radial-gradient(ellipse at 30% 30%, rgba(59,130,246,0.4), transparent 55%), radial-gradient(ellipse at 70% 70%, rgba(14,165,233,0.2), transparent 50%)',
          }}
        />
        <div className="relative">
          <Logo />
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-blue-200/80">AILMS</p>
          <h1 className="mt-3 max-w-sm text-3xl font-bold leading-tight text-white">Create your workspace access</h1>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-blue-100/80">
            New accounts join as Actionist. Admins can elevate roles after signup.
          </p>
        </div>
        <p className="relative text-xs text-blue-200/60">Password policy enforced by system security settings</p>
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
          <h2 className="text-2xl font-bold tracking-tight text-[#102a43]">Create account</h2>
          <p className="mt-1 text-sm text-slate-500">Register with a username and strong password</p>

          <form onSubmit={onSubmit} className="mt-8 space-y-3.5">
            {error && (
              <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <label className="block space-y-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Full name</span>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-11 w-full rounded-md border border-slate-200 bg-white pl-10 pr-3 text-sm outline-none ring-[#0d3763]/focus:ring-2"
                  placeholder="A. Rahman"
                />
              </div>
            </label>
            <label className="block space-y-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Username</span>
              <input
                required
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-[#0d3763]/focus:ring-2"
                placeholder="arahman"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Email</span>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 w-full rounded-md border border-slate-200 bg-white pl-10 pr-3 text-sm outline-none ring-[#0d3763]/focus:ring-2"
                  placeholder="you@office.gov"
                />
              </div>
            </label>
            <label className="block space-y-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Department</span>
              <div className="relative">
                <Building2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="h-11 w-full rounded-md border border-slate-200 bg-white pl-10 pr-3 text-sm outline-none ring-[#0d3763]/focus:ring-2"
                  placeholder="Coordination"
                />
              </div>
            </label>
            <label className="block space-y-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Password</span>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 w-full rounded-md border border-slate-200 bg-white pl-10 pr-10 text-sm outline-none ring-[#0d3763]/focus:ring-2"
                  placeholder="Min. 8 chars, upper, lower, number"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </label>
            <label className="block space-y-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Confirm password</span>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-[#0d3763]/focus:ring-2"
              />
            </label>
            <Button type="submit" className="mt-2 h-11 w-full" disabled={busy}>
              {busy ? 'Creating account…' : 'Create account'}
            </Button>
            <p className="text-center text-xs text-slate-500">
              Already registered?{' '}
              <Link href="/login" className="font-semibold text-[#1769aa] hover:underline">
                Sign in
              </Link>
            </p>
          </form>
        </div>
      </main>
    </div>
  )
}
