import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'AILMS — Cinematic Product Video',
  description: 'NeuraFlow-style SaaS marketing trailer for the Correspondence Management System.',
}

export default function CinematicLayout({ children }: { children: React.ReactNode }) {
  return children
}
