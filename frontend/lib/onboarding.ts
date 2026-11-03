/** Interactive onboarding for the simplified correspondence marking workflow. */

export type OnboardingChapterId =
  | 'welcome'
  | 'register'
  | 'mark'
  | 'work'
  | 'track-close'
  | 'workspace'
  | 'ai'
  | 'practice'

export type OnboardingActorColor = {
  hex: string
  soft: string
  border: string
}

export type OnboardingActor = {
  name: string
  summary: string
  color: OnboardingActorColor
}

export type OnboardingChapter = {
  id: OnboardingChapterId
  title: string
  subtitle: string
  minutes: number
}

/** Bumped so browsers do not restore obsolete enterprise-tour progress. */
export const ONBOARDING_STORAGE_KEY = 'cms-onboarding-progress-v2'

export const ONBOARDING_CHAPTERS: OnboardingChapter[] = [
  { id: 'welcome', title: 'Welcome', subtitle: 'Holdership, not role ladders', minutes: 2 },
  { id: 'register', title: 'Register', subtitle: 'Capture a letter and become initiator', minutes: 2 },
  { id: 'mark', title: 'Mark', subtitle: 'Forward, For Info, or Response Required', minutes: 3 },
  { id: 'work', title: 'Accept & work', subtitle: 'Inbox gate, notes, and Reply', minutes: 3 },
  { id: 'track-close', title: 'Track & close', subtitle: 'Batch trackers, Revoke, Close', minutes: 3 },
  { id: 'workspace', title: 'Workspace', subtitle: 'Inbox, Sent, Track, and Catalog', minutes: 2 },
  { id: 'ai', title: 'AI helpers', subtitle: 'Intake and discovery — not marking', minutes: 2 },
  { id: 'practice', title: 'Practice', subtitle: 'Walk a sample letter end to end', minutes: 4 },
]

/** Who acts on a letter — holdership, not Coordinator/Manager/Actionist tiers. */
export const ONBOARDING_ACTORS: OnboardingActor[] = [
  {
    name: 'Initiator',
    summary: 'Who registered the letter. Closes it when they hold it again.',
    color: { hex: '#0d9488', soft: '#f0fdfa', border: '#5eead4' },
  },
  {
    name: 'Current holder',
    summary: 'Who can Mark, add notes/files, Reply, or Close (if initiator).',
    color: { hex: '#1769aa', soft: '#eff6ff', border: '#93c5fd' },
  },
  {
    name: 'Marker',
    summary: 'Who sent a mark — can Track Response Required and Revoke when allowed.',
    color: { hex: '#c2410c', soft: '#fff7ed', border: '#fdba74' },
  },
  {
    name: 'Recipient',
    summary: 'Must Accept before working; then becomes the current holder.',
    color: { hex: '#15803d', soft: '#ecfdf5', border: '#6ee7b7' },
  },
  {
    name: 'Admin',
    summary: 'Can override letter actions and manage users/settings.',
    color: { hex: '#0d3763', soft: '#eff6ff', border: '#93c5fd' },
  },
  {
    name: 'Viewer',
    summary: 'Read-only — no Mark, notes, or Close.',
    color: { hex: '#475569', soft: '#f8fafc', border: '#cbd5e1' },
  },
]

const FALLBACK_ACTOR_COLOR: OnboardingActorColor = {
  hex: '#334155',
  soft: '#f8fafc',
  border: '#cbd5e1',
}

export function getActorColor(actorName: string): OnboardingActorColor {
  const key = actorName.trim().toLowerCase()
  const match = ONBOARDING_ACTORS.find((a) => {
    const name = a.name.toLowerCase()
    return key === name || key.includes(name) || name.includes(key.split('(')[0].trim())
  })
  return match?.color ?? FALLBACK_ACTOR_COLOR
}

export const WORKFLOW_PIPELINE = [
  {
    status: 'Register',
    meaning: 'Create the letter (manual or OCR-assisted). You become initiator and initial holder.',
    actors: ['Any user'],
  },
  {
    status: 'Mark',
    meaning: 'Send to people as Forward, For Information, or Response Required.',
    actors: ['Current holder'],
  },
  {
    status: 'Accept',
    meaning: 'Inbound recipient accepts (or rejects) before working the letter.',
    actors: ['Recipient'],
  },
  {
    status: 'Notes & work',
    meaning: 'Holders add comments and attachments; may Mark onward or Reply.',
    actors: ['Current holder'],
  },
  {
    status: 'Track & Revoke',
    meaning: 'Marker tracks pending Response Required; may Revoke if the recipient has not remade.',
    actors: ['Marker'],
  },
  {
    status: 'Close',
    meaning: 'When the initiator holds again, they close the correspondence.',
    actors: ['Initiator'],
  },
] as const

export const MARK_TYPES = [
  {
    id: 'forward',
    title: 'Forward',
    slot: 'To',
    meaning: 'Pass the letter onward. The recipient becomes the next holder after Accept.',
  },
  {
    id: 'response_required',
    title: 'Response Required',
    slot: 'To',
    meaning: 'Ask for a response (draft letter, presentation, nominations, comments, or other). Track until fulfilled.',
  },
  {
    id: 'for_info',
    title: 'For Information',
    slot: 'Info',
    meaning: 'FYI only — awareness without a response obligation.',
  },
  {
    id: 'reply',
    title: 'Reply',
    slot: 'Back',
    meaning: 'Send the letter back up the chain to the previous marker.',
  },
] as const

export type PracticeAction = {
  id: string
  label: string
  /** Who performs this practice click (holdership labels, not legacy roles). */
  actors: string[]
  nextStatus: string
  note: string
}

export type PracticeStep = {
  status: string
  prompt: string
  actions: PracticeAction[]
}

/** Guided sandbox for the simplified marking path. */
export const PRACTICE_STEPS: PracticeStep[] = [
  {
    status: 'Open',
    prompt:
      'You registered this letter. You are the initiator and current holder. Open the Workflow tab and Mark it to a colleague.',
    actions: [
      {
        id: 'mark-forward',
        label: 'Mark — Forward to Sara',
        actors: ['Current holder'],
        nextStatus: 'Awaiting Accept',
        note: 'Forwarded to Sara. She must Accept before working on it.',
      },
      {
        id: 'mark-rr',
        label: 'Mark — Response Required to Finance',
        actors: ['Current holder'],
        nextStatus: 'Awaiting Accept (RR)',
        note: 'Response Required sent. You can track this batch until Finance replies.',
      },
    ],
  },
  {
    status: 'Awaiting Accept',
    prompt: 'Sara sees the letter in Inbox. She must Accept before she can Mark, note, or Reply.',
    actions: [
      {
        id: 'accept',
        label: 'Accept — I will work on it',
        actors: ['Recipient'],
        nextStatus: 'Holding',
        note: 'Sara accepted and now holds the letter.',
      },
      {
        id: 'reject',
        label: 'Reject',
        actors: ['Recipient'],
        nextStatus: 'Open',
        note: 'Rejected — hold returns. Try Marking again.',
      },
    ],
  },
  {
    status: 'Awaiting Accept (RR)',
    prompt: 'Finance received a Response Required mark. Accept to start the response work.',
    actions: [
      {
        id: 'accept-rr',
        label: 'Accept — I will work on it',
        actors: ['Recipient'],
        nextStatus: 'Holding (RR)',
        note: 'Finance accepted. Your batch tracker still shows this RR as open until they Reply.',
      },
    ],
  },
  {
    status: 'Holding',
    prompt: 'Sara holds the letter. She can add notes, Mark onward, or Reply back to you.',
    actions: [
      {
        id: 'reply',
        label: 'Send Reply to initiator',
        actors: ['Current holder'],
        nextStatus: 'Back with Initiator',
        note: 'Replied with comments. Hold returns to the previous marker (you).',
      },
      {
        id: 'mark-onward',
        label: 'Mark onward (Forward)',
        actors: ['Current holder'],
        nextStatus: 'Onward Marked',
        note: 'Marked to the next person. Sara can Revoke until they remake or add content.',
      },
    ],
  },
  {
    status: 'Holding (RR)',
    prompt: 'Finance holds a Response Required mark. Complete the response and Reply back.',
    actions: [
      {
        id: 'reply-rr',
        label: 'Reply with response',
        actors: ['Current holder'],
        nextStatus: 'Back with Initiator',
        note: 'Response sent. The RR batch clears for the marker; you hold the letter again.',
      },
    ],
  },
  {
    status: 'Onward Marked',
    prompt:
      'After Marking onward you are mostly revoke-only until hold returns. Practice Revoke, or skip ahead as if the next person replied.',
    actions: [
      {
        id: 'revoke',
        label: 'Revoke mark',
        actors: ['Marker'],
        nextStatus: 'Holding',
        note: 'Mark revoked. Sara holds again and can choose a different next step.',
      },
      {
        id: 'recipient-replied',
        label: 'Recipient replies back',
        actors: ['Recipient'],
        nextStatus: 'Back with Initiator',
        note: 'Chain returned. You hold the letter as initiator.',
      },
    ],
  },
  {
    status: 'Back with Initiator',
    prompt: 'You hold the letter again as initiator. Close when the work is finished (optional Archive later).',
    actions: [
      {
        id: 'close',
        label: 'Close correspondence',
        actors: ['Initiator'],
        nextStatus: 'Closed',
        note: 'Letter Closed. Catalog retains the record; Archive is available when policy requires it.',
      },
    ],
  },
  {
    status: 'Closed',
    prompt: 'Practice complete. Restart anytime and try the other Mark type (Forward vs Response Required).',
    actions: [],
  },
]

export type PracticeLogEntry = {
  actors: string[]
  text: string
}

export type OnboardingProgress = {
  completed: OnboardingChapterId[]
  current: OnboardingChapterId
  practiceStatus: string
  practiceLog: PracticeLogEntry[]
}

export function defaultOnboardingProgress(): OnboardingProgress {
  return {
    completed: [],
    current: 'welcome',
    practiceStatus: 'Open',
    practiceLog: [],
  }
}

function normalizePracticeLog(raw: unknown): PracticeLogEntry[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((entry): PracticeLogEntry | null => {
      if (typeof entry === 'string') {
        return { actors: [], text: entry }
      }
      if (entry && typeof entry === 'object' && 'text' in entry) {
        const legacyRoles = Array.isArray((entry as { roles?: unknown }).roles)
          ? ((entry as { roles: unknown[] }).roles.filter((r): r is string => typeof r === 'string'))
          : []
        const actors = Array.isArray((entry as PracticeLogEntry).actors)
          ? (entry as PracticeLogEntry).actors.filter((r): r is string => typeof r === 'string')
          : legacyRoles
        const text = String((entry as PracticeLogEntry).text ?? '')
        return text ? { actors, text } : null
      }
      return null
    })
    .filter((entry): entry is PracticeLogEntry => entry !== null)
}

export function loadOnboardingProgress(): OnboardingProgress {
  if (typeof window === 'undefined') return defaultOnboardingProgress()
  try {
    const raw = localStorage.getItem(ONBOARDING_STORAGE_KEY)
    if (!raw) return defaultOnboardingProgress()
    const parsed = JSON.parse(raw) as Partial<OnboardingProgress>
    const base = defaultOnboardingProgress()
    return {
      ...base,
      ...parsed,
      completed: Array.isArray(parsed.completed)
        ? parsed.completed.filter((id): id is OnboardingChapterId =>
            ONBOARDING_CHAPTERS.some((c) => c.id === id),
          )
        : [],
      current: ONBOARDING_CHAPTERS.some((c) => c.id === parsed.current)
        ? (parsed.current as OnboardingChapterId)
        : 'welcome',
      practiceLog: normalizePracticeLog(parsed.practiceLog),
      practiceStatus:
        typeof parsed.practiceStatus === 'string' &&
        PRACTICE_STEPS.some((s) => s.status === parsed.practiceStatus)
          ? parsed.practiceStatus
          : 'Open',
    }
  } catch {
    return defaultOnboardingProgress()
  }
}

export function saveOnboardingProgress(progress: OnboardingProgress) {
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(progress))
  } catch {
    /* ignore quota / private mode */
  }
}
