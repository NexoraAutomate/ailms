import { redirect } from 'next/navigation'

/** Monitoring merged into Analytics → Needs action (Option B). */
export default function MonitoringRedirect() {
  redirect('/analytics?view=needs-action')
}
