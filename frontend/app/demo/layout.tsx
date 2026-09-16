import type { Metadata } from 'next'
import './demo.css'

export const metadata: Metadata = {
  title: 'AILMS — Executive Product Demo',
  description: 'Animated leadership presentation for the Correspondence Management System.',
}

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children
}
