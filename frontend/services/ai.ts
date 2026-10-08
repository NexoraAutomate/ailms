import { api } from '@/lib/api'
import type { Letter, Priority } from './letters'
import type { Department, DepartmentStat } from './management'

export type AiStatus = 'idle' | 'analyzing' | 'generating' | 'success' | 'empty' | 'no-result' | 'error' | 'unavailable'
export type AiDecision = 'pending' | 'accepted' | 'modified' | 'rejected'
export type InsightSeverity = 'Critical' | 'High' | 'Medium' | 'Informational'

export type AiSummary = {
  executiveSummary: string
  purpose: string
  keyPoints: string[]
  importantDates: string[]
  organizations: string[]
  requiredActions: string
  currentStatus: string
  potentialRisk: string
  recommendedFollowUp: string
}

export type ExtractedField = {
  key: string
  label: string
  value: string
  confidence: number
  official?: string
}

export type ClassificationSuggestion = {
  label: string
  value: string
  confidence: number
  field: 'category' | 'subjectCategory' | 'department' | 'priority' | 'confidentiality'
}

export type ActionRecommendation = {
  id: string
  action: string
  department: string
  person: string
  dueDate: string
  reason: string
}

export type UrgencyAssessment = {
  priority: Priority
  urgency: 'Routine' | 'High' | 'Critical'
  confidence: number
  reasons: string[]
  suggestedDeadline: string
}

export type DraftResponse = {
  text: string
  tone: string
  pointsAddressed: string[]
  missingInformation: string[]
}

export type InterpretedQuery = {
  query: string
  filters: Record<string, string>
  letters: Letter[]
  summary: string
}

export type CorrespondenceEvent = {
  label: string
  date: string
  note: string
  delay?: boolean
  letterNumber?: string
}

export type CorrespondenceStoryBeat = {
  order?: number
  date?: string
  actor?: string
  action?: string
  letterNumber?: string
  outcome?: string
}

export type CorrespondenceThreadLetter = {
  id: string
  number: string
  date: string
  from: string
  to: string
  subject: string
  type: string
  status: string
  linked?: boolean
}

export type CorrespondenceAnalysis = {
  relatedCount: number
  original: string
  replies: number
  reminders: number
  followUps: number
  currentStatus: string
  durationDays: number
  timeline: CorrespondenceEvent[]
  chain: string[]
  delays: string[]
  narrative?: string
  parties?: string[]
  storyBeats?: CorrespondenceStoryBeat[]
  attachmentInsights?: string[]
  openQuestions?: string[]
  threadLetters?: CorrespondenceThreadLetter[]
  threadLetterIds?: string[]
}

export type ManagementInsight = {
  id: string
  title: string
  group: 'Operational' | 'Risk' | 'Management'
  severity: InsightSeverity
  explanation: string
  recommendation: string
  letterIds: string[]
}

export type AiAuditEntry = {
  id: string
  date: string
  user: string
  module: string
  action: string
  record: string
  description: string
  source: string
  decision: AiDecision
}

export type AiAnalysisKind =
  | 'summarize'
  | 'extract'
  | 'classify'
  | 'recommend_actions'
  | 'urgency'
  | 'draft_response'
  | 'analyze_correspondence'

export type StoredAiAnalysis = {
  kind: AiAnalysisKind
  payload: unknown
  decisions: Record<string, AiDecision>
  meta: Record<string, unknown>
  generatedBy?: string
  generatedAt?: string | null
  updatedAt?: string | null
}

export type LetterAiAnalysisBundle = {
  letterId: number
  canRegenerate: boolean
  analyses: Partial<Record<AiAnalysisKind, StoredAiAnalysis | null>>
}

export type AiGenerateOptions = {
  force?: boolean
}

export const AI_ENDPOINTS = {
  summarize: '/api/ai/summarize',
  extract: '/api/ai/extract',
  classify: '/api/ai/classify',
  recommendActions: '/api/ai/recommend-actions',
  urgency: '/api/ai/urgency',
  draftResponse: '/api/ai/draft-response',
  search: '/api/ai/search',
  analyze: '/api/ai/analyze-correspondence',
  insights: '/api/ai/management-insights',
  chat: '/api/ai/chat',
  letterQa: '/api/ai/letter-qa',
  status: '/api/ai/status',
  letterAnalysis: (letterId: string | number) => `/api/ai/letters/${letterId}/analysis`,
  letterAnalysisKind: (letterId: string | number, kind: AiAnalysisKind) =>
    `/api/ai/letters/${letterId}/analysis/${kind}`,
  letterAnalysisDecisions: (letterId: string | number, kind: AiAnalysisKind) =>
    `/api/ai/letters/${letterId}/analysis/${kind}/decisions`,
  letterQuestions: (letterId: string | number) => `/api/ai/letters/${letterId}/questions`,
} as const

export type LetterQaQuestionItem = {
  id: number
  question: string
  hitCount: number
  askedBy: string
  askedAt: string | null
  updatedAt?: string | null
  source?: string
  valid?: boolean
}

export type LetterQuestionsBundle = {
  letterId: number
  questions: LetterQaQuestionItem[]
  suggested: string[]
}

export async function fetchLetterQuestions(letterId: string | number): Promise<LetterQuestionsBundle> {
  try {
    return await api.get<LetterQuestionsBundle>(AI_ENDPOINTS.letterQuestions(letterId))
  } catch {
    return {
      letterId: Number(letterId),
      questions: [],
      suggested: [
        'What is this letter about?',
        'What actions are required?',
        'When is the deadline?',
        'Who sent this letter?',
        'What is the current status?',
      ],
    }
  }
}

export async function fetchLetterAiAnalysis(letterId: string | number): Promise<LetterAiAnalysisBundle> {
  return api.get<LetterAiAnalysisBundle>(AI_ENDPOINTS.letterAnalysis(letterId))
}

export async function persistLetterAiAnalysis(
  letterId: string | number,
  kind: AiAnalysisKind,
  payload: unknown,
  options?: { decisions?: Record<string, AiDecision>; meta?: Record<string, unknown> },
): Promise<StoredAiAnalysis> {
  return api.put<StoredAiAnalysis>(AI_ENDPOINTS.letterAnalysisKind(letterId, kind), {
    payload,
    decisions: options?.decisions,
    meta: options?.meta,
  })
}

export async function saveLetterAiDecisions(
  letterId: string | number,
  kind: AiAnalysisKind,
  decisions: Record<string, AiDecision>,
): Promise<StoredAiAnalysis> {
  return api.patch<StoredAiAnalysis>(AI_ENDPOINTS.letterAnalysisDecisions(letterId, kind), { decisions })
}

async function loadStoredPayload<T>(letterId: string | number, kind: AiAnalysisKind): Promise<T | null> {
  try {
    const bundle = await fetchLetterAiAnalysis(letterId)
    const existing = bundle.analyses[kind]
    if (existing?.payload != null) return existing.payload as T
  } catch {
    /* ignore */
  }
  return null
}

async function storeMockPayload<T>(
  letterId: string | number,
  kind: AiAnalysisKind,
  payload: T,
  meta?: Record<string, unknown>,
): Promise<T> {
  try {
    await persistLetterAiAnalysis(letterId, kind, payload, { meta: { ...(meta || {}), source: 'mock' } })
  } catch {
    /* ignore persistence failures on mock path */
  }
  return payload
}

export type AiBackendStatus = { enabled: boolean; provider: string; model: string; baseUrl?: string }

let cachedAiStatus: AiBackendStatus | null = null

export async function fetchAiStatus(force = false): Promise<AiBackendStatus> {
  if (cachedAiStatus && !force) return cachedAiStatus
  try {
    cachedAiStatus = await api.get<AiBackendStatus>(AI_ENDPOINTS.status)
  } catch {
    cachedAiStatus = { enabled: false, provider: 'none', model: '' }
  }
  return cachedAiStatus
}

async function withLlm<T>(call: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  try {
    const status = await fetchAiStatus()
    if (status.enabled) return await call()
  } catch {
    /* use fallback */
  }
  return fallback()
}

const wait = (ms = 520) => new Promise((resolve) => setTimeout(resolve, ms))

function hash(value: string) {
  return value.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)
}

function addDays(iso: string, days: number) {
  if (!iso) return ''
  const date = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(date.getTime())) return iso
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function topic(letter: Letter) {
  const text = `${letter.subject} ${letter.from} ${letter.department}`.toLowerCase()
  if (text.includes('satellite') || text.includes('suparco') || text.includes('technical')) return 'technical'
  if (text.includes('budget') || text.includes('finance') || text.includes('fy')) return 'financial'
  if (text.includes('hr') || text.includes('nomination') || text.includes('focal')) return 'hr'
  if (text.includes('policy') || text.includes('retention')) return 'policy'
  if (text.includes('security') || text.includes('defence')) return 'administrative'
  if (text.includes('operations') || text.includes('brief')) return 'operational'
  return 'general'
}

export async function summarizeLetter(letter: Letter, variant = 0, options: AiGenerateOptions = {}): Promise<AiSummary> {
  const force = Boolean(options.force)
  return withLlm(
    () => api.post<AiSummary>(AI_ENDPOINTS.summarize, { letterId: Number(letter.id), variant, force }),
    async () => {
      if (!force) {
        const stored = await loadStoredPayload<AiSummary>(letter.id, 'summarize')
        if (stored) return stored
      }
      const mock = await summarizeLetterMock(letter, variant)
      return storeMockPayload(letter.id, 'summarize', mock, { variant })
    },
  )
}

async function summarizeLetterMock(letter: Letter, variant = 0): Promise<AiSummary> {
  await wait()
  const kind = topic(letter)
  const extra = variant % 2 === 1 ? ' A follow-up may be required if no reply is received before the due date.' : ''
  const summaries: Record<string, string> = {
    technical: `Correspondence requests technical clarification regarding a satellite communications proposal and related delivery or review actions.${extra}`,
    financial: `Correspondence concerns revised budget estimates and requires finance review before further circulation.${extra}`,
    hr: `Correspondence nominates or requests focal persons and needs HR confirmation of participation.${extra}`,
    policy: `Correspondence provides policy guidance that should be recorded and circulated to the responsible office.${extra}`,
    administrative: `Correspondence requests coordination on an administrative or security matter and remains with the assigned office.${extra}`,
    operational: `Correspondence follows up on an inter-agency operations brief and is awaiting a formal response.${extra}`,
    general: `Correspondence requires review, assignment confirmation and a timely official response.${extra}`,
  }
  return {
    executiveSummary: summaries[kind],
    purpose: `Capture and progress ${letter.subject.toLowerCase()} received from ${letter.from || 'the originating office'}.`,
    keyPoints: [
      `${letter.type} letter ${letter.number} is currently ${letter.status.toLowerCase()}.`,
      letter.from ? `Originating organization: ${letter.from}.` : 'Originating organization is not fully specified.',
      letter.dueDate ? `Target date recorded as ${letter.dueDate}.` : 'No official due date is recorded.',
      letter.lastAction ? `Latest recorded action: ${letter.lastAction}.` : 'No action has been recorded after registration.',
    ],
    importantDates: [letter.letterDate && `Letter date: ${letter.letterDate}`, letter.receivedDate && `Received: ${letter.receivedDate}`, letter.dueDate && `Due: ${letter.dueDate}`].filter(Boolean) as string[],
    organizations: [letter.from, letter.to, letter.department].filter(Boolean),
    requiredActions: letter.actionRequired || `Provide an official response and keep ${letter.department || 'the assigned department'} informed before the due date.`,
    currentStatus: `${letter.status}${letter.assignedTo ? ` · owned by ${letter.assignedTo}` : ''}`,
    potentialRisk: letter.status === 'Overdue' || letter.daysPending >= 7 ? 'Response delay may affect coordination with the originating organization.' : 'Low immediate risk if the current owner proceeds as planned.',
    recommendedFollowUp: letter.status === 'Overdue' ? 'Escalate to the department head and issue a dated reminder.' : 'Confirm the next action owner and record progress before the due date.',
  }
}

export async function extractLetterInformation(letter: Letter, options: AiGenerateOptions = {}): Promise<ExtractedField[]> {
  const force = Boolean(options.force)
  return withLlm(
    async () => {
      const body = await api.post<{ fields: ExtractedField[] }>(AI_ENDPOINTS.extract, { letterId: Number(letter.id), force })
      return body.fields
    },
    async () => {
      if (!force) {
        const stored = await loadStoredPayload<ExtractedField[]>(letter.id, 'extract')
        if (stored) return stored
      }
      const mock = await extractLetterInformationMock(letter)
      return storeMockPayload(letter.id, 'extract', mock)
    },
  )
}

async function extractLetterInformationMock(letter: Letter): Promise<ExtractedField[]> {
  await wait()
  const kind = topic(letter)
  const keywords = kind === 'technical' ? 'satellite, communications, technical review' : kind === 'financial' ? 'budget, FY 2026-27, estimates' : letter.subject.split(' ').slice(0, 4).join(', ')
  return [
    { key: 'number', label: 'Letter Number', value: letter.number, confidence: 98, official: letter.number },
    { key: 'letterDate', label: 'Letter Date', value: letter.letterDate, confidence: 96, official: letter.letterDate },
    { key: 'receivedDate', label: 'Received Date', value: letter.receivedDate, confidence: 94, official: letter.receivedDate },
    { key: 'from', label: 'Sender Organization', value: letter.from || 'Not detected', confidence: letter.from ? 93 : 41, official: letter.from },
    { key: 'to', label: 'Recipient Organization', value: letter.to || 'Office of the Secretary', confidence: 84, official: letter.to },
    { key: 'persons', label: 'Persons', value: letter.assignedTo || 'Not named in metadata', confidence: letter.assignedTo ? 80 : 36, official: letter.assignedTo },
    { key: 'department', label: 'Department', value: letter.department || 'Coordination', confidence: letter.department ? 88 : 54, official: letter.department },
    { key: 'subject', label: 'Subject', value: letter.subject, confidence: 97, official: letter.subject },
    { key: 'keywords', label: 'Keywords', value: keywords, confidence: 76 },
    { key: 'priority', label: 'Priority', value: letter.priority === 'Routine' && letter.status === 'Overdue' ? 'Urgent' : letter.priority, confidence: 82, official: letter.priority },
    { key: 'dueDate', label: 'Deadline', value: letter.dueDate || addDays(letter.receivedDate, 7), confidence: letter.dueDate ? 90 : 61, official: letter.dueDate },
    { key: 'actionRequired', label: 'Required Action', value: letter.actionRequired || letter.lastAction || 'Review and respond', confidence: 74, official: letter.actionRequired },
    { key: 'project', label: 'Mentioned Project', value: kind === 'technical' ? 'Satellite communications proposal' : kind === 'financial' ? 'FY 2026–27 budget cycle' : 'Not identified', confidence: kind === 'general' ? 38 : 79 },
    { key: 'mentionedOrg', label: 'Mentioned Organization', value: letter.from || 'Internal department', confidence: 85 },
    { key: 'references', label: 'Reference Letters', value: letter.number.includes('OUT') ? 'Related incoming brief pending linkage' : 'None detected', confidence: 58 },
  ]
}

export async function classifyLetter(letter: Letter, options: AiGenerateOptions = {}): Promise<ClassificationSuggestion[]> {
  const force = Boolean(options.force)
  return withLlm(
    async () => {
      const body = await api.post<{ suggestions: ClassificationSuggestion[] }>(AI_ENDPOINTS.classify, {
        letterId: Number(letter.id),
        force,
      })
      return body.suggestions
    },
    async () => {
      if (!force) {
        const stored = await loadStoredPayload<ClassificationSuggestion[]>(letter.id, 'classify')
        if (stored) return stored
      }
      const mock = await classifyLetterMock(letter)
      return storeMockPayload(letter.id, 'classify', mock)
    },
  )
}

async function classifyLetterMock(letter: Letter): Promise<ClassificationSuggestion[]> {
  await wait()
  const kind = topic(letter)
  const category =
    kind === 'technical' ? 'Technical' :
    kind === 'financial' ? 'Financial' :
    kind === 'hr' ? 'HR' :
    kind === 'policy' ? 'Legal' :
    letter.from.toLowerCase().includes('foreign') ? 'External Correspondence' :
    'Administrative'
  const subjectCategory = kind === 'technical' ? 'Procurement' : kind === 'financial' ? 'Budget' : kind === 'hr' ? 'Nominations' : 'Coordination'
  const suggestedPriority: Priority = letter.status === 'Overdue' || letter.priority === 'Urgent' ? 'Urgent' : letter.daysPending >= 5 ? 'Important' : letter.priority
  return [
    { field: 'category', label: 'Letter Type', value: category, confidence: kind === 'technical' ? 94 : 86 },
    { field: 'subjectCategory', label: 'Subject Category', value: subjectCategory, confidence: 87 },
    { field: 'department', label: 'Department', value: letter.department || (kind === 'technical' ? 'Technical' : 'Coordination'), confidence: 87 },
    { field: 'priority', label: 'Priority', value: suggestedPriority, confidence: letter.status === 'Overdue' ? 91 : 82 },
    { field: 'confidentiality', label: 'Confidentiality', value: letter.confidentiality || (kind === 'policy' ? 'Restricted' : 'Normal'), confidence: 78 },
  ]
}

export async function recommendActions(letter: Letter, options: AiGenerateOptions = {}): Promise<ActionRecommendation[]> {
  const force = Boolean(options.force)
  return withLlm(
    async () => {
      const body = await api.post<{ actions: ActionRecommendation[] }>(AI_ENDPOINTS.recommendActions, {
        letterId: Number(letter.id),
        force,
      })
      return body.actions
    },
    async () => {
      if (!force) {
        const stored = await loadStoredPayload<ActionRecommendation[]>(letter.id, 'recommend_actions')
        if (stored) return stored
      }
      const mock = await recommendActionsMock(letter)
      return storeMockPayload(letter.id, 'recommend_actions', mock)
    },
  )
}

async function recommendActionsMock(letter: Letter): Promise<ActionRecommendation[]> {
  await wait()
  const due = letter.dueDate || addDays(letter.receivedDate || letter.letterDate, 5)
  return [
    { id: `${letter.id}-a1`, action: 'Review the correspondence and confirm completeness of the record.', department: letter.department || 'Coordination', person: letter.assignedTo || 'A. Rahman', dueDate: addDays(due, -3) || due, reason: 'Official action should start from a verified register entry.' },
    { id: `${letter.id}-a2`, action: `Forward correspondence to ${letter.department || 'the concerned department'} for specialist input.`, department: letter.department || 'Coordination', person: letter.assignedTo || 'Department head', dueDate: addDays(due, -2) || due, reason: 'Ownership is required before a formal reply can be issued.' },
    { id: `${letter.id}-a3`, action: 'Obtain a response from the responsible officer or project director.', department: letter.department || 'Technical', person: letter.assignedTo || 'S. Khan', dueDate: due, reason: 'The originating office is expecting a dated reply.' },
    { id: `${letter.id}-a4`, action: 'Prepare an official reply using the approved draft format.', department: letter.department || 'Coordination', person: letter.assignedTo || 'Correspondence Officer', dueDate: due, reason: 'A written response is the recorded next step for this letter type.' },
    { id: `${letter.id}-a5`, action: 'Follow up before the due date and update the action log.', department: letter.department || 'Coordination', person: letter.assignedTo || 'A. Rahman', dueDate: due, reason: letter.status === 'Overdue' ? 'The item is already overdue and needs dated follow-up.' : 'Prevent the letter from slipping past the recorded deadline.' },
  ]
}

export async function assessUrgency(letter: Letter, options: AiGenerateOptions = {}): Promise<UrgencyAssessment> {
  const force = Boolean(options.force)
  return withLlm(
    () => api.post<UrgencyAssessment>(AI_ENDPOINTS.urgency, { letterId: Number(letter.id), force }),
    async () => {
      if (!force) {
        const stored = await loadStoredPayload<UrgencyAssessment>(letter.id, 'urgency')
        if (stored) return stored
      }
      const mock = await assessUrgencyMock(letter)
      return storeMockPayload(letter.id, 'urgency', mock)
    },
  )
}

async function assessUrgencyMock(letter: Letter): Promise<UrgencyAssessment> {
  await wait()
  const overdue = letter.status === 'Overdue'
  const urgent = letter.priority === 'Urgent' || overdue
  const reasons = [
    overdue ? 'Deadline has already passed' : letter.dueDate ? 'Deadline approaching' : 'No due date is recorded',
    letter.from.includes('Ministry') || letter.from.includes('SUPARCO') ? 'Management-level or external correspondence' : 'Routine originating office',
    topic(letter) === 'financial' ? 'Financial impact' : topic(letter) === 'technical' ? 'Operational / technical impact' : 'Limited operational impact',
    letter.from.toLowerCase().includes('foreign') || letter.status === 'Awaiting Response' ? 'External organization awaiting response' : 'Internal processing still possible',
    letter.daysPending >= 7 ? 'Long pending correspondence' : 'Pending duration is still within a normal range',
  ]
  return {
    priority: urgent ? 'Urgent' : letter.daysPending >= 5 ? 'Important' : letter.priority,
    urgency: overdue ? 'Critical' : urgent ? 'High' : 'Routine',
    confidence: overdue ? 91 : 82,
    reasons,
    suggestedDeadline: letter.dueDate || addDays(letter.receivedDate || letter.letterDate, 3),
  }
}

export async function generateDraftResponse(
  letter: Letter,
  style: 'default' | 'shorten' | 'expand' | 'formal' | 'concise' = 'default',
  options: AiGenerateOptions = {},
): Promise<DraftResponse> {
  const force = Boolean(options.force) || style !== 'default'
  return withLlm(
    () => api.post<DraftResponse>(AI_ENDPOINTS.draftResponse, { letterId: Number(letter.id), style, force }),
    async () => {
      if (!force) {
        const stored = await loadStoredPayload<DraftResponse>(letter.id, 'draft_response')
        if (stored) return stored
      }
      const mock = await generateDraftResponseMock(letter, style)
      return storeMockPayload(letter.id, 'draft_response', mock, { style })
    },
  )
}

async function generateDraftResponseMock(letter: Letter, style: 'default' | 'shorten' | 'expand' | 'formal' | 'concise' = 'default'): Promise<DraftResponse> {
  await wait(600)
  const base = `With reference to letter ${letter.number} dated ${letter.letterDate}, the undersigned acknowledges receipt of correspondence on “${letter.subject}”. The matter has been assigned to ${letter.department || 'the concerned department'} and is under examination. A substantive reply will be furnished after internal consultation.`
  const variants = {
    default: base,
    shorten: `Reference ${letter.number} is acknowledged. The matter is under examination in ${letter.department || 'this office'} and a reply will follow.`,
    expand: `${base} In particular, this office will review the stated requirements, confirm any referenced documents, and advise the originating organization of the next official step. Should additional information be required, the assigned officer will make a formal request.`,
    formal: `I am directed to refer to your letter No. ${letter.number} dated ${letter.letterDate} on the subject cited above. The contents have been carefully noted. Necessary action is being taken by ${letter.department || 'the competent office'}, and this office will revert with an official response.`,
    concise: `Letter ${letter.number} is acknowledged. ${letter.department || 'The assigned office'} is processing the request and will reply before the recorded due date.`,
  }
  const missing = [
    !letter.from ? 'Sender organization is incomplete.' : '',
    !letter.dueDate ? 'No official response deadline is recorded.' : '',
    !letter.actionRequired ? 'Required action is not captured in the register.' : '',
  ].filter(Boolean)
  return {
    text: variants[style],
    tone: style === 'formal' ? 'Formal official' : style === 'concise' || style === 'shorten' ? 'Concise' : 'Standard official',
    pointsAddressed: ['Acknowledgement of receipt', 'Assignment of ownership', 'Commitment to a formal reply'],
    missingInformation: missing.length ? missing : ['No critical register fields are missing for a first draft.'],
  }
}

export async function naturalLanguageSearch(query: string, letters: Letter[]): Promise<InterpretedQuery> {
  return withLlm(
    () => api.post<InterpretedQuery>(AI_ENDPOINTS.search, { query }),
    () => naturalLanguageSearchMock(query, letters),
  )
}

export type ChatHistoryItem = { role: 'user' | 'assistant'; content: string }

export type AssistantChatOptions = {
  history?: ChatHistoryItem[]
  contextLetterIds?: string[]
}

export async function assistantChat(
  message: string,
  letters: Letter[] = [],
  options: AssistantChatOptions = {},
): Promise<{ text: string; result?: InterpretedQuery }> {
  const history = options.history ?? []
  const contextLetterIds = options.contextLetterIds ?? []
  return withLlm(
    () =>
      api.post<{ text: string; result: InterpretedQuery }>(AI_ENDPOINTS.chat, {
        message,
        history,
        contextLetterIds: contextLetterIds.map(Number).filter((id) => Number.isFinite(id)),
      }),
    async () => {
      const result = await naturalLanguageSearchMock(message, letters, contextLetterIds)
      return { text: mockAssistantReply(message, result), result }
    },
  )
}

export type LetterQaReply = {
  text: string
  letterId?: number
  cached?: boolean
  source?: string
}

export async function letterQaChat(
  letter: Letter,
  message: string,
  history: ChatHistoryItem[] = [],
  options?: { force?: boolean },
): Promise<LetterQaReply> {
  // Always hit the API first: cache / deterministic answers work without a live LLM.
  try {
    return await api.post<LetterQaReply>(AI_ENDPOINTS.letterQa, {
      letterId: Number(letter.id),
      message,
      history,
      force: options?.force ?? false,
    })
  } catch {
    await wait(320)
    return { text: mockLetterQaReply(letter, message), cached: false, source: 'mock' }
  }
}

function mockLetterQaReply(letter: Letter, message: string): string {
  const q = message.toLowerCase()
  const body = (letter.bodyText || '').trim() || (letter.remarks || '').trim()

  if (/deadline|due date|when.*(due|respond)/.test(q)) {
    return letter.dueDate
      ? `The recorded due date for ${letter.number} is ${letter.dueDate}.`
      : `No official due date is recorded for ${letter.number}.`
  }
  if (/who (sent|wrote|from)|sender|originat/.test(q)) {
    return letter.from
      ? `${letter.number} was sent by ${letter.from}.`
      : `The sender organization is not recorded for ${letter.number}.`
  }
  if (/status|progress|where.*(stand|at)/.test(q)) {
    const owner = letter.assignedTo ? ` It is currently owned by ${letter.assignedTo}.` : ''
    return `${letter.number} is currently marked ${letter.status}.${owner}`
  }
  if (/action|require|need to|next step/.test(q)) {
    const action = letter.actionRequired || letter.lastAction
    return action
      ? `Required / latest action for ${letter.number}: ${action}.`
      : `No specific required action is recorded for ${letter.number} beyond normal review.`
  }
  if (/priority|urgenc/.test(q)) {
    return `${letter.number} is recorded as ${letter.priority} priority.`
  }
  if (/summar|about|subject|content|say|mention|explain|what/.test(q)) {
    if (body) {
      return body.length > 500 ? `${body.slice(0, 500).trim()}…` : body
    }
    return (
      `Letter ${letter.number} (${letter.type}) concerns “${letter.subject}”. ` +
      `It is from ${letter.from || 'an unspecified sender'} to ${letter.to || 'the recorded recipient'}, ` +
      `held by ${letter.department || 'the assigned department'}, status ${letter.status}.`
    )
  }
  return (
    `Based on the register entry for ${letter.number}: subject “${letter.subject}”, ` +
    `status ${letter.status}, priority ${letter.priority}` +
    (letter.dueDate ? `, due ${letter.dueDate}` : '') +
    `. Ask a more specific question about the content, deadline, sender, or required action.`
  )
}

function mockAssistantReply(message: string, result: InterpretedQuery): string {
  const matched = result.letters
  const q = message.toLowerCase()
  if (!matched.length) return result.summary

  if (/summar|overview|brief|explain|describe|content|says|mention|provide|what does/.test(q)) {
    const letter = matched[0]
    const base = (letter.bodyText || '').trim() || (letter.remarks || '').trim() || letter.subject
    const wordCap = q.match(/(?:not more than|under|max(?:imum)?|up to)\s+(\d+)\s+words?/)
    const singleSentence = /single sentence|one sentence|in a sentence/.test(q)
    if (wordCap || singleSentence) {
      const limit = wordCap ? Number(wordCap[1]) : 15
      const words = base.split(/\s+/).filter(Boolean).slice(0, Math.max(limit, 1))
      let text = words.join(' ')
      if (!/[.!?]$/.test(text)) text += '.'
      return text
    }
    return base.length > 600 ? `${base.slice(0, 600).trim()}…` : base
  }

  return result.summary
}

const SEARCH_STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would', 'could', 'should',
  'can', 'may', 'might', 'must', 'shall', 'i', 'me', 'my', 'we', 'our', 'you',
  'your', 'he', 'she', 'it', 'they', 'them', 'their', 'this', 'that', 'these',
  'those', 'what', 'which', 'who', 'whom', 'where', 'when', 'why', 'how',
  'about', 'above', 'after', 'against', 'along', 'among', 'around', 'as', 'at',
  'before', 'behind', 'below', 'beside', 'between', 'by', 'down', 'during',
  'for', 'from', 'in', 'into', 'near', 'of', 'on', 'onto', 'over', 'through',
  'to', 'toward', 'under', 'up', 'with', 'without', 'and', 'but', 'or', 'nor',
  'not', 'no', 'yes', 'if', 'then', 'than', 'so', 'any', 'all', 'some', 'there',
  'here', 'please', 'show', 'find', 'list', 'get', 'give', 'tell', 'search',
  'look', 'see', 'related', 'regarding', 'concerning', 'letter', 'letters',
  'correspondence', 'file', 'files', 'document', 'documents', 'query', 'question',
  'summary', 'summarize', 'summarise', 'sentence', 'sentences', 'word', 'words',
  'single', 'detail', 'details', 'explain', 'describe', 'brief', 'short', 'concise',
  'overview', 'more', 'only', 'just', 'one', 'two', 'three',
  'pertaining', 'relating', 'relate', 'relates', 'related', 'involve', 'involves',
  'involving', 'concern', 'concerns', 'mention', 'mentions', 'mentioned', 'containing',
  'include', 'includes', 'including', 'associated', 'regarding', 'concerning',
  'towards', 'toward', 'onto', 'into', 'within', 'among', 'across', 'around',
  'against', 'whether', 'exist', 'exists', 'available',
])

const FOLLOWUP_RE =
  /\b(?:that|this|the|those|these|same|previous|above)\s+(?:letter|letters|one|ones|file|files|correspondence|document|documents)\b|\b(?:it|them|its)\b/i

function isFollowupQuestion(message: string): boolean {
  if (FOLLOWUP_RE.test(message)) return true
  return searchKeywords(message).length === 0
}

function searchKeywords(query: string): string[] {
  const tokens = query.toLowerCase().match(/[a-z0-9][a-z0-9./_-]*/g) ?? []
  const seen = new Set<string>()
  const keywords: string[] = []
  for (const token of tokens) {
    if (SEARCH_STOPWORDS.has(token) || token.length < 2 || seen.has(token)) continue
    seen.add(token)
    keywords.push(token)
  }
  return keywords
}

function letterSearchBlob(letter: Letter): string {
  return Object.values(letter).map((value) => String(value ?? '')).join(' ').toLowerCase()
}

function textMatchLetters(query: string, letters: Letter[]): Letter[] {
  const q = query.toLowerCase().trim()
  if (!q) return []
  const keywords = searchKeywords(query)
  const phraseHits = letters.filter((letter) => letterSearchBlob(letter).includes(q))
  if (phraseHits.length && (keywords.length <= 1 || q.split(/\s+/).length <= 4)) {
    return phraseHits
  }
  if (!keywords.length) return phraseHits

  const scored = letters
    .map((letter) => {
      const blob = letterSearchBlob(letter)
      const hitCount = keywords.reduce((count, token) => count + (blob.includes(token) ? 1 : 0), 0)
      return { letter, hitCount }
    })
    .filter((item) => item.hitCount > 0)

  const full = scored.filter((item) => item.hitCount === keywords.length).map((item) => item.letter)
  if (full.length) return full

  return scored
    .sort((a, b) => b.hitCount - a.hitCount || Number(b.letter.id) - Number(a.letter.id))
    .map((item) => item.letter)
}

async function naturalLanguageSearchMock(
  query: string,
  letters: Letter[],
  contextLetterIds: string[] = [],
): Promise<InterpretedQuery> {
  await wait()
  const q = query.toLowerCase()
  const filters: Record<string, string> = {}
  let rows = [...letters]

  if (isFollowupQuestion(query) && contextLetterIds.length) {
    const idSet = new Set(contextLetterIds.map(String))
    rows = letters.filter((letter) => idSet.has(String(letter.id)))
    if (rows.length) {
      filters.Context = 'previous conversation'
      return {
        query,
        filters,
        letters: rows,
        summary: 'Using letter(s) from the prior conversation turn.',
      }
    }
  }

  if (q.includes('overdue')) { filters.Status = 'Overdue'; rows = rows.filter((l) => l.status === 'Overdue') }
  if (q.includes('awaiting response')) { filters.Status = 'Awaiting Response'; rows = rows.filter((l) => l.status === 'Awaiting Response') }
  if (q.includes('pending') && !q.includes('overdue')) { filters.Status = 'Pending'; rows = rows.filter((l) => !['Closed', 'Completed'].includes(l.status)) }
  if (q.includes('closed')) { filters.Status = 'Closed'; rows = rows.filter((l) => l.status === 'Closed') }
  if (q.includes('incoming')) { filters.Type = 'Incoming'; rows = rows.filter((l) => l.type === 'Incoming') }
  if (q.includes('outgoing')) { filters.Type = 'Outgoing'; rows = rows.filter((l) => l.type === 'Outgoing') }
  if (q.includes('urgent') || q.includes('high-priority') || q.includes('high priority') || q.includes('critical')) { filters.Priority = 'Urgent / Important'; rows = rows.filter((l) => l.priority === 'Urgent' || l.priority === 'Important' || l.status === 'Overdue') }
  if (q.includes('suparco')) { filters.Organization = 'SUPARCO'; rows = rows.filter((l) => `${l.from} ${l.subject}`.toLowerCase().includes('suparco')) }
  if (q.includes('foreign')) { filters.Organization = 'Foreign organization'; rows = rows.filter((l) => l.from.toLowerCase().includes('foreign')) }
  if (q.includes('satellite') || q.includes('procurement')) { filters.Topic = 'Satellite / procurement'; rows = rows.filter((l) => /satellite|procurement|technical|proposal/i.test(`${l.subject} ${l.from}`)) }
  if (q.includes('30')) { filters['Pending days'] = '> 30'; rows = rows.filter((l) => l.daysPending >= 30) }
  if (q.includes('60')) { filters['Pending days'] = '> 60'; rows = rows.filter((l) => l.daysPending >= 60) }
  if (q.includes('due today')) { filters.Due = 'Today'; const today = new Date().toISOString().slice(0, 10); rows = rows.filter((l) => l.dueDate === today) }
  if (q.includes('this week') || q.includes('due this week')) { filters.Due = 'This week'; rows = rows.filter((l) => Boolean(l.dueDate)) }
  if (q.includes('this month')) { filters.Period = 'This month'; rows = rows.filter((l) => (l.receivedDate || l.letterDate).startsWith('2026-09')) }
  if (q.includes('department') && (q.includes('workload') || q.includes('highest') || q.includes('largest'))) {
    filters.View = 'Department workload'
  }

  if (Object.keys(filters).length === 0 && q.trim()) {
    const keywords = searchKeywords(query)
    rows = textMatchLetters(query, letters)
    if (!rows.length && contextLetterIds.length && isFollowupQuestion(query)) {
      const idSet = new Set(contextLetterIds.map(String))
      rows = letters.filter((letter) => idSet.has(String(letter.id)))
      if (rows.length) filters.Context = 'previous conversation'
    } else if (rows.length) {
      filters.Keywords = keywords.join(', ') || query
    }
  }

  const summary = q.includes('workload')
    ? 'Interpreted as a department workload question. Matching pending correspondence is listed below.'
    : q.includes('attention') || q.includes('critical')
      ? 'Interpreted as a management-attention query focusing on overdue and urgent items.'
      : Object.keys(filters).length
        ? `Interpreted query applied ${Object.keys(filters).length} filter${Object.keys(filters).length === 1 ? '' : 's'} to the register.`
        : 'No structured filters were inferred. Showing text matches where available.'

  return { query, filters, letters: rows, summary }
}

export async function analyzeCorrespondence(
  letter: Letter,
  letters: Letter[],
  options: AiGenerateOptions = {},
): Promise<CorrespondenceAnalysis> {
  const force = Boolean(options.force)
  return withLlm(
    () => api.post<CorrespondenceAnalysis>(AI_ENDPOINTS.analyze, { letterId: Number(letter.id), force }),
    async () => {
      if (!force) {
        const stored = await loadStoredPayload<CorrespondenceAnalysis>(letter.id, 'analyze_correspondence')
        if (stored) return stored
      }
      const mock = await analyzeCorrespondenceMock(letter, letters)
      return storeMockPayload(letter.id, 'analyze_correspondence', mock)
    },
  )
}

async function analyzeCorrespondenceMock(letter: Letter, letters: Letter[]): Promise<CorrespondenceAnalysis> {
  await wait()
  const subjectToken = letter.subject.split(/\s+/).find((t) => t.length > 4)?.toLowerCase() || ''
  const related = letters
    .filter((item) => item.id !== letter.id)
    .filter(
      (item) =>
        item.from === letter.from ||
        item.to === letter.from ||
        item.from === letter.to ||
        item.department === letter.department ||
        (subjectToken && item.subject.toLowerCase().includes(subjectToken)) ||
        (item.subject.toLowerCase().includes('s-band') && letter.subject.toLowerCase().includes('s-band')) ||
        (item.subject.toLowerCase().includes('quotation') && letter.subject.toLowerCase().includes('quotation')),
    )
    .sort((a, b) => a.letterDate.localeCompare(b.letterDate))

  const thread = [letter, ...related].sort((a, b) => a.letterDate.localeCompare(b.letterDate))
  const earliest = thread[0]?.letterDate || letter.letterDate
  const latest = thread[thread.length - 1]?.letterDate || letter.letterDate
  const duration = Math.max(
    letter.daysPending,
    Math.round((new Date(latest).getTime() - new Date(earliest).getTime()) / 86_400_000) || 1,
  )

  const parties = Array.from(new Set(thread.flatMap((row) => [row.from, row.to]).filter(Boolean)))
  const replies = related.filter((item) => /reply|response|acceptance|clarification reply/i.test(item.subject) || item.type === 'Outgoing').length
  const followUps = related.filter((item) => /follow|evaluation|concurrence|loi|award/i.test(item.subject)).length

  const storyBeats = thread.map((row, index) => ({
    order: index + 1,
    date: row.letterDate,
    actor: row.from,
    action: row.subject,
    letterNumber: row.number,
    outcome: row.status,
  }))

  const narrativeParts = thread.map((row, index) => {
    const step = index === 0 ? 'opened the file' : index === thread.length - 1 ? 'is the latest exchange' : 'continued the exchange'
    return (
      `${row.letterDate}: ${row.from} wrote to ${row.to} under ${row.number} regarding “${row.subject}”. ` +
      `This ${row.type.toLowerCase()} item ${step} (status: ${row.status}). ` +
      (row.lastAction ? `Recorded action: ${row.lastAction}.` : '')
    )
  })
  const narrative =
    narrativeParts.join('\n\n') ||
    `${letter.from} registered ${letter.number} on ${letter.letterDate}. No linked letters were found in the local register, so analysis is limited to this file.`

  const timeline: CorrespondenceEvent[] = thread.map((row) => ({
    label: row.number,
    date: row.letterDate,
    note: `${row.from} → ${row.to}: ${row.subject}`,
    delay: row.status === 'Overdue' || row.daysPending >= 10,
    letterNumber: row.number,
  }))

  return {
    relatedCount: related.length,
    original: thread[0]?.number || letter.number,
    replies,
    reminders: letter.status === 'Overdue' ? 1 : 0,
    followUps,
    currentStatus: letter.status,
    durationDays: duration,
    timeline,
    chain: thread.map((row) => row.number),
    delays: [
      letter.status === 'Overdue' ? 'Response is overdue against the recorded due date.' : '',
      duration >= 30 ? 'This thread has been open for more than a month.' : '',
      related.some((r) => /late/i.test(r.subject)) ? 'A late expression of interest appears in the thread.' : '',
    ].filter(Boolean),
    narrative,
    parties,
    storyBeats,
    attachmentInsights: thread
      .filter((row) => /quotation|clarification|loi|evaluation|concurrence/i.test(row.subject))
      .map((row) => `Letter ${row.number} likely carries supporting commercial/technical attachments for “${row.subject}”.`),
    openQuestions: [
      letter.status === 'Awaiting Response' ? `${letter.number} is still awaiting an external reply.` : '',
      !['Completed', 'Closed'].includes(letter.status) ? 'Final purchase-order / closure step may still be pending.' : '',
    ].filter(Boolean),
    threadLetters: thread.map((row) => ({
      id: row.id,
      number: row.number,
      date: row.letterDate,
      from: row.from,
      to: row.to,
      subject: row.subject,
      type: row.type,
      status: row.status,
      linked: row.id !== letter.id,
    })),
    threadLetterIds: thread.map((row) => row.id),
  }
}

/** Coalesce concurrent dashboard/insights mounts so they share one Ollama call. */
let managementInsightsInFlight: Promise<ManagementInsight[]> | null = null

export async function generateManagementInsights(letters: Letter[], departments: Department[] | DepartmentStat[]): Promise<ManagementInsight[]> {
  if (!managementInsightsInFlight) {
    managementInsightsInFlight = (async () => {
      try {
        return await withLlm(
          async () => {
            const body = await api.post<{ insights: ManagementInsight[] }>(AI_ENDPOINTS.insights, {})
            return body.insights
          },
          () => generateManagementInsightsMock(letters, departments),
        )
      } catch {
        // Backend/proxy overload during OCR registration — fall back to local mock.
        return generateManagementInsightsMock(letters, departments)
      }
    })().finally(() => {
      managementInsightsInFlight = null
    })
  }
  return managementInsightsInFlight
}

async function generateManagementInsightsMock(letters: Letter[], departments: Department[] | DepartmentStat[]): Promise<ManagementInsight[]> {
  await wait()
  const overdue = letters.filter((l) => l.status === 'Overdue')
  const pending = letters.filter((l) => !['Closed', 'Completed'].includes(l.status))
  const urgent = letters.filter((l) => l.priority === 'Urgent' || l.status === 'Overdue')
  const longPending = letters.filter((l) => l.daysPending >= 7 && !['Closed', 'Completed'].includes(l.status))
  const workload = [...departments].sort((a, b) => ('pending' in a ? a.pending : 0) - ('pending' in b ? b.pending : 0)).at(-1)
  const topDept = workload && 'name' in workload ? workload.name : 'Technical'
  const seed = hash(letters.map((l) => l.id).join(',')) % 3
  return [
    { id: 'att', title: 'Attention required', group: 'Operational', severity: overdue.length ? 'Critical' : 'Medium', explanation: `${overdue.length} high-priority or overdue letter${overdue.length === 1 ? '' : 's'} need management attention.`, recommendation: 'Review overdue items in the next coordination meeting.', letterIds: overdue.map((l) => l.id) },
    { id: 'bot', title: 'Department bottleneck', group: 'Management', severity: 'High', explanation: `${topDept} currently holds the highest pending workload.`, recommendation: `Rebalance incoming assignments away from ${topDept} until the queue reduces.`, letterIds: pending.filter((l) => l.department === topDept).map((l) => l.id) },
    { id: 'risk', title: 'Emerging risk', group: 'Risk', severity: longPending.length ? 'High' : 'Informational', explanation: `${longPending.length} correspondence item${longPending.length === 1 ? '' : 's'} have exceeded a normal response window.`, recommendation: 'Issue dated reminders for long-pending files.', letterIds: longPending.map((l) => l.id) },
    { id: 'perf', title: 'Response performance', group: 'Management', severity: seed === 0 ? 'Medium' : 'Informational', explanation: seed === 0 ? 'Average response time is higher than the previous period on pending files.' : 'Average response time remains within the recent operating range.', recommendation: 'Track closure rate weekly for overdue and awaiting-response items.', letterIds: pending.slice(0, 4).map((l) => l.id) },
    { id: 'rec', title: 'Management recommendation', group: 'Management', severity: urgent.length ? 'High' : 'Informational', explanation: urgent.length ? `${urgent.length} urgent or overdue item${urgent.length === 1 ? '' : 's'} remain unresolved.` : 'No urgent backlog is currently visible.', recommendation: 'Prioritize technical and procurement correspondence before routine files.', letterIds: urgent.map((l) => l.id) },
    { id: 'due', title: 'Approaching deadlines', group: 'Risk', severity: 'Medium', explanation: 'Several open letters still have recorded due dates that require monitoring.', recommendation: 'Confirm owners for items due this week.', letterIds: pending.filter((l) => l.dueDate).slice(0, 5).map((l) => l.id) },
    { id: 'rem', title: 'Repeated reminders', group: 'Risk', severity: overdue.length ? 'High' : 'Informational', explanation: overdue.length ? 'Overdue files are candidates for a second reminder cycle.' : 'No repeated reminder pattern is visible in the current register.', recommendation: 'Log reminders against the official action trail only after confirmation.', letterIds: overdue.map((l) => l.id) },
    { id: 'imb', title: 'Workload imbalance', group: 'Operational', severity: 'Medium', explanation: 'Pending correspondence is concentrated in a small number of departments.', recommendation: 'Use My Actions and Monitoring to redistribute ownership.', letterIds: pending.slice(0, 6).map((l) => l.id) },
  ]
}

export function assistantPromptLibrary() {
  return {
    Operational: ['Show all overdue correspondence.', 'Which letters are due today?', 'Show correspondence pending for more than 30 days.'],
    Management: ['Which department has the highest pending workload?', 'What requires management attention?', 'Show the most critical correspondence.'],
    Analysis: ['Why are these letters overdue?', 'Summarize the correspondence related to this subject.', 'Show repeated follow-ups.'],
    Reporting: ['Summarize correspondence performance for this month.', 'Compare incoming and outgoing correspondence.'],
  }
}

export function looksLikeNaturalQuery(query: string) {
  const q = query.trim().toLowerCase()
  if (q.length < 8) return false
  return /^(show|find|which|what|why|summarize|compare|list)\b/.test(q) || q.includes(' over') || q.includes('pending') || q.includes('department')
}
