import type { Metadata } from 'next'
import { Figtree, Syne } from 'next/font/google'

const syne = Syne({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-landing-display',
  display: 'swap',
})

const figtree = Figtree({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-landing-body',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'AILMS — AI Letter Management System',
  description:
    'Enterprise correspondence management with AI-assisted registration, workflow tracking, and executive oversight.',
}

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${syne.variable} ${figtree.variable}`}>{children}</div>
}
