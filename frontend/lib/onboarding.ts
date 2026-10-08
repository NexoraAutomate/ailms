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

export type OnboardingRole = {
  name: string
  summary: string
  focus: string
  permissions: string[]
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

export const ONBOARDING_ROLES: OnboardingRole[] = [
  {
    name: 'Admin',
    summary: 'Full control of users, configuration, and every workflow transition.',
    focus: 'System ownership, overrides, and audit.',
    permissions: [
      'Validate & classify letters',
      'Approve routing and dispatch',
      'Assign, reassign, escalate, close, archive',
      'Manage users, roles, and master data',
    ],
  },
  {
    name: 'Management',
    summary: 'Executive oversight with the same workflow powers as Admin on letters.',
    focus: 'Approvals, escalations, and strategic routing.',
    permissions: [
      'Approve routing and response steps',
      'Escalate overdue or blocked work',
      'Close and archive correspondence',
      'Monitor department performance',
    ],
  },
  {
    name: 'Manager',
    summary: 'Department lead who routes work, delegates, and reviews responses.',
    focus: 'Delegation, approvals, and completion.',
    permissions: [
      'Classify and route letters',
      'Delegate or handle at this tier',
      'Approve response steps',
      'Escalate, reopen, and close',
    ],
  },
  {
    name: 'Coordinator',
    summary: 'Correspondence officer who validates intake and keeps letters moving.',
    focus: 'Registration quality, classification, and handoffs.',
    permissions: [
      'Validate OCR / registration data',
      'Classify Information vs Actionable',
      'Assign, forward, and reassign',
      'Route FYI and close information letters',
    ],
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
  },
  {
    name: 'Viewer',
    summary: 'Read-only access for stakeholders who need visibility without edits.',
    focus: 'Search, catalog, and status tracking.',
    permissions: ['View letters they can access', 'No workflow transitions'],
  },
]

export const WORKFLOW_PIPELINE = [
  { status: 'Registered', meaning: 'Letter captured with metadata (and optionally OCR).' },
  { status: 'Validated', meaning: 'Coordinator confirms fields and attachments are correct.' },
  { status: 'Classified', meaning: 'Marked Information (FYI) or Actionable.' },
  { status: 'Routed / Assigned', meaning: 'Sent to a department or action owner.' },
  { status: 'In Progress', meaning: 'Actionist accepted and is working the item.' },
  { status: 'Response Drafted', meaning: 'Reply prepared for review.' },
  { status: 'Under Approval', meaning: 'Manager / Management reviews the draft.' },
  { status: 'Dispatched', meaning: 'Final response sent internally or externally.' },
  { status: 'Closed / Archived', meaning: 'Work finished; letter retained in Catalog.' },
] as const

export type PracticeAction = {
  id: string
  label: string
  role: string
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
        role: 'Coordinator',
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
        role: 'Coordinator',
        nextStatus: 'Classified',
        note: 'Marked Actionable — someone must accept and complete work.',
      },
      {
        id: 'classify-info',
        label: 'Mark as Information',
        role: 'Coordinator',
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
        role: 'Manager',
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
        role: 'Coordinator',
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
        role: 'Coordinator',
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
        role: 'Actionist',
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
        role: 'Actionist',
        nextStatus: 'Response Drafted',
        note: 'Response version v1 prepared and ready for approval.',
      },
      {
        id: 'block',
        label: 'Block action',
        role: 'Actionist',
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
        role: 'Actionist',
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
        role: 'Manager',
        nextStatus: 'Approved for Dispatch',
        note: 'Response approved. Ready for dispatch.',
      },
      {
        id: 'return',
        label: 'Return for revision',
        role: 'Manager',
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
        role: 'Admin / Coordinator',
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
        role: 'Manager',
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

export type OnboardingProgress = {
  completed: OnboardingChapterId[]
  current: OnboardingChapterId
  selectedRole: string
  practiceStatus: string
  practiceLog: string[]
}

export function defaultOnboardingProgress(): OnboardingProgress {
  return {
    completed: [],
    current: 'welcome',
    selectedRole: 'Actionist',
    practiceStatus: 'Registered',
    practiceLog: [],
  }
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
