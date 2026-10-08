/** Interactive onboarding content for the Correspondence Management System. */

export type OnboardingChapterId =
  | 'welcome'
  | 'roles'
  | 'register'
  | 'marking'
  | 'routing'
  | 'action-items'
  | 'response'
  | 'workspace'
  | 'ai'
  | 'practice'

export type OnboardingRoleColor = {
  /** Solid accent used for bold role names and selected chips. */
  hex: string
  /** Soft fill for badges / chips. */
  soft: string
  /** Soft border paired with soft fill. */
  border: string
}

export type OnboardingRole = {
  name: string
  summary: string
  focus: string
  permissions: string[]
  color: OnboardingRoleColor
}

export type OnboardingChapter = {
  id: OnboardingChapterId
  title: string
  subtitle: string
  minutes: number
}

export const ONBOARDING_STORAGE_KEY = 'cms-onboarding-progress'

export const ONBOARDING_CHAPTERS: OnboardingChapter[] = [
  { id: 'welcome', title: 'Welcome', subtitle: 'How correspondence moves through the system', minutes: 2 },
  { id: 'roles', title: 'Roles', subtitle: 'Who can do what', minutes: 3 },
  { id: 'register', title: 'Register', subtitle: 'Capture an incoming or outgoing letter', minutes: 2 },
  { id: 'marking', title: 'Marking', subtitle: 'Classify as Information or Actionable', minutes: 3 },
  { id: 'routing', title: 'Routing', subtitle: 'Validate, classify, and hand off', minutes: 3 },
  { id: 'action-items', title: 'Action items', subtitle: 'Accept, start, block, and complete work', minutes: 3 },
  { id: 'response', title: 'Response & close', subtitle: 'Draft, approve, dispatch, archive', minutes: 3 },
  { id: 'workspace', title: 'Workspace', subtitle: 'Inbox, My Actions, Monitoring', minutes: 2 },
  { id: 'ai', title: 'AI helpers', subtitle: 'OCR, analysis, and search assistants', minutes: 2 },
  { id: 'practice', title: 'Practice', subtitle: 'Walk a sample letter end to end', minutes: 4 },
]

/** Roles in letter lifecycle order: entry → routing → work → close → read-only. */
export const ONBOARDING_ROLES: OnboardingRole[] = [
  {
    name: 'Coordinator',
    summary: 'Correspondence officer who validates intake and keeps letters moving.',
    focus: 'First touch — registration, classification, and handoffs.',
    permissions: [
      'Validate OCR / registration data',
      'Classify Information vs Actionable',
      'Assign, forward, and reassign',
      'Route FYI and close information letters',
    ],
    color: { hex: '#0d9488', soft: '#f0fdfa', border: '#5eead4' },
  },
  {
    name: 'Management',
    summary: 'Executive oversight with the same workflow powers as Admin on letters.',
    focus: 'Routing approval, escalations, and dispatch authority.',
    permissions: [
      'Approve routing and response steps',
      'Escalate overdue or blocked work',
      'Close and archive correspondence',
      'Monitor department performance',
    ],
    color: { hex: '#9f1239', soft: '#fff1f2', border: '#fda4af' },
  },
  {
    name: 'Manager',
    summary: 'Department lead who routes work, delegates, and reviews responses.',
    focus: 'Delegation, department approvals, and completion.',
    permissions: [
      'Classify and route letters',
      'Delegate or handle at this tier',
      'Approve response steps',
      'Escalate, reopen, and close',
    ],
    color: { hex: '#c2410c', soft: '#fff7ed', border: '#fdba74' },
  },
  {
    name: 'Actionist',
    summary: 'The person who executes assigned work on a letter.',
    focus: 'Action items and drafting the reply.',
    permissions: [
      'Accept / start / block / complete action items',
      'Add notes and request clarification',
      'Draft a response and submit for approval',
      'Acknowledge information (FYI) letters',
    ],
    color: { hex: '#15803d', soft: '#ecfdf5', border: '#6ee7b7' },
  },
  {
    name: 'Admin',
    summary: 'Full control of users, configuration, and every workflow transition.',
    focus: 'Overrides, dispatch, and system ownership.',
    permissions: [
      'Validate & classify letters',
      'Approve routing and dispatch',
      'Assign, reassign, escalate, close, archive',
      'Manage users, roles, and master data',
    ],
    color: { hex: '#0d3763', soft: '#eff6ff', border: '#93c5fd' },
  },
  {
    name: 'Viewer',
    summary: 'Read-only access for stakeholders who need visibility without edits.',
    focus: 'Search, catalog, and status tracking.',
    permissions: ['View letters they can access', 'No workflow transitions'],
    color: { hex: '#475569', soft: '#f8fafc', border: '#cbd5e1' },
  },
]

const FALLBACK_ROLE_COLOR: OnboardingRoleColor = {
  hex: '#334155',
  soft: '#f8fafc',
  border: '#cbd5e1',
}

export function getRoleColor(roleName: string): OnboardingRoleColor {
  const match = ONBOARDING_ROLES.find((r) => r.name.toLowerCase() === roleName.trim().toLowerCase())
  return match?.color ?? FALLBACK_ROLE_COLOR
}

export const WORKFLOW_PIPELINE = [
  {
    status: 'Registered',
    meaning: 'Letter captured with metadata (and optionally OCR).',
    roles: ['Coordinator', 'Admin'],
  },
  {
    status: 'Validated',
    meaning: 'Coordinator confirms fields and attachments are correct.',
    roles: ['Coordinator'],
  },
  {
    status: 'Classified',
    meaning: 'Marked Information (FYI) or Actionable.',
    roles: ['Coordinator', 'Manager'],
  },
  {
    status: 'Routed / Assigned',
    meaning: 'Sent to a department or action owner.',
    roles: ['Management', 'Manager', 'Coordinator'],
  },
  {
    status: 'In Progress',
    meaning: 'Actionist accepted and is working the item.',
    roles: ['Actionist'],
  },
  {
    status: 'Response Drafted',
    meaning: 'Reply prepared for review.',
    roles: ['Actionist'],
  },
  {
    status: 'Under Approval',
    meaning: 'Manager / Management reviews the draft.',
    roles: ['Manager', 'Management'],
  },
  {
    status: 'Dispatched',
    meaning: 'Final response sent internally or externally.',
    roles: ['Management', 'Admin'],
  },
  {
    status: 'Closed / Archived',
    meaning: 'Work finished; letter retained in Catalog.',
    roles: ['Manager', 'Management', 'Admin'],
  },
] as const

export type PracticeAction = {
  id: string
  label: string
  /** Canonical role name(s) that perform this practice click. */
  roles: string[]
  nextStatus: string
  note: string
}

export type PracticeStep = {
  status: string
  prompt: string
  actions: PracticeAction[]
}

/** Guided sandbox: each status offers the realistic next click(s). */
export const PRACTICE_STEPS: PracticeStep[] = [
  {
    status: 'Registered',
    prompt: 'A scanned letter just landed. As Coordinator, validate the registration before anything else moves.',
    actions: [
      {
        id: 'validate',
        label: 'Validate',
        roles: ['Coordinator'],
        nextStatus: 'Validated',
        note: 'You confirmed number, subject, dates, and attachments look correct.',
      },
    ],
  },
  {
    status: 'Validated',
    prompt: 'Mark the letter. This choice decides whether it needs action items or only FYI delivery.',
    actions: [
      {
        id: 'classify-actionable',
        label: 'Mark as Actionable',
        roles: ['Coordinator'],
        nextStatus: 'Classified',
        note: 'Marked Actionable — someone must accept and complete work.',
      },
      {
        id: 'classify-info',
        label: 'Mark as Information',
        roles: ['Coordinator'],
        nextStatus: 'Classified-Info',
        note: 'Marked Information / FYI — route for awareness, no action owner required.',
      },
    ],
  },
  {
    status: 'Classified',
    prompt: 'Route the actionable letter to the owning department and assign an Actionist.',
    actions: [
      {
        id: 'delegate',
        label: 'Delegate to Actionist',
        roles: ['Manager'],
        nextStatus: 'Action Assigned',
        note: 'Action item created for Finance · Due in 5 days.',
      },
    ],
  },
  {
    status: 'Classified-Info',
    prompt: 'Information letters are delivered for awareness. Route FYI, then close when acknowledged.',
    actions: [
      {
        id: 'route-info',
        label: 'Route for information',
        roles: ['Coordinator'],
        nextStatus: 'Information Delivered',
        note: 'FYI recipients notified. They can acknowledge from My Actions.',
      },
    ],
  },
  {
    status: 'Information Delivered',
    prompt: 'FYI path complete. Close as information delivered, then archive if policy requires.',
    actions: [
      {
        id: 'close-info',
        label: 'Close information letter',
        roles: ['Coordinator'],
        nextStatus: 'Closed',
        note: 'Information path finished. Catalog retains the record.',
      },
    ],
  },
  {
    status: 'Action Assigned',
    prompt: 'You are the Actionist. Accept the item so the clock and ownership are clear.',
    actions: [
      {
        id: 'accept',
        label: 'Accept action',
        roles: ['Actionist'],
        nextStatus: 'In Progress',
        note: 'Action item accepted. Status moves to In Progress.',
      },
    ],
  },
  {
    status: 'In Progress',
    prompt: 'Do the work, then either draft a response or mark the action complete when finished.',
    actions: [
      {
        id: 'draft',
        label: 'Draft response',
        roles: ['Actionist'],
        nextStatus: 'Response Drafted',
        note: 'Response version v1 prepared and ready for approval.',
      },
      {
        id: 'block',
        label: 'Block action',
        roles: ['Actionist'],
        nextStatus: 'In Progress',
        note: 'Blocked with a reason (waiting on external data). Managers see this in Monitoring.',
      },
    ],
  },
  {
    status: 'Response Drafted',
    prompt: 'Submit the draft so a Manager can approve the step.',
    actions: [
      {
        id: 'submit',
        label: 'Submit for approval',
        roles: ['Actionist'],
        nextStatus: 'Under Approval',
        note: 'Approval step opened for the department Manager.',
      },
    ],
  },
  {
    status: 'Under Approval',
    prompt: 'As Manager, approve the response — or return it for revision.',
    actions: [
      {
        id: 'approve',
        label: 'Approve step',
        roles: ['Manager'],
        nextStatus: 'Approved for Dispatch',
        note: 'Response approved. Ready for dispatch.',
      },
      {
        id: 'return',
        label: 'Return for revision',
        roles: ['Manager'],
        nextStatus: 'Response Drafted',
        note: 'Returned with remarks. Actionist revises the draft.',
      },
    ],
  },
  {
    status: 'Approved for Dispatch',
    prompt: 'Dispatch the reply on the right channel, then close the letter.',
    actions: [
      {
        id: 'dispatch',
        label: 'Dispatch',
        roles: ['Management', 'Admin'],
        nextStatus: 'Dispatched',
        note: 'Outgoing reply recorded with channel and recipients.',
      },
    ],
  },
  {
    status: 'Dispatched',
    prompt: 'Correspondence is complete. Close and archive for retention.',
    actions: [
      {
        id: 'close',
        label: 'Close & archive',
        roles: ['Manager', 'Management', 'Admin'],
        nextStatus: 'Archived',
        note: 'Letter closed and available in Catalog / Archive views.',
      },
    ],
  },
  {
    status: 'Closed',
    prompt: 'Practice complete for the information path. Try again as Actionable to see action items.',
    actions: [],
  },
  {
    status: 'Archived',
    prompt: 'Full actionable journey complete. Restart anytime to try the Information path.',
    actions: [],
  },
]

export type PracticeLogEntry = {
  roles: string[]
  text: string
}

export type OnboardingProgress = {
  completed: OnboardingChapterId[]
  current: OnboardingChapterId
  selectedRole: string
  practiceStatus: string
  practiceLog: PracticeLogEntry[]
}

export function defaultOnboardingProgress(): OnboardingProgress {
  return {
    completed: [],
    current: 'welcome',
    selectedRole: 'Coordinator',
    practiceStatus: 'Registered',
    practiceLog: [],
  }
}

function normalizePracticeLog(raw: unknown): PracticeLogEntry[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((entry): PracticeLogEntry | null => {
      if (typeof entry === 'string') {
        return { roles: [], text: entry }
      }
      if (entry && typeof entry === 'object' && 'text' in entry) {
        const roles = Array.isArray((entry as PracticeLogEntry).roles)
          ? (entry as PracticeLogEntry).roles.filter((r): r is string => typeof r === 'string')
          : []
        const text = String((entry as PracticeLogEntry).text ?? '')
        return text ? { roles, text } : null
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
