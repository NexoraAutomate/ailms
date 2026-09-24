import { api } from '@/lib/api'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? ''

export type StagedDocument = {
  stagedDocumentId: string
  originalFilename: string
  mimeType: string
  fileSize: number
  checksum: string
  createdAt: string
}

export type StagedUploadSource = 'register-letter' | 'scan'

export type AiRegistrationJobStatus =
  | 'QUEUED'
  | 'PROCESSING'
  | 'OCR_COMPLETE'
  | 'EXTRACTION_COMPLETE'
  | 'NEEDS_REVIEW'
  | 'APPROVED'
  | 'REGISTERED'
  | 'FAILED'
  | 'REJECTED'

export type AiRegistrationJobCreate = {
  jobId: string
  status: AiRegistrationJobStatus
  stagedDocumentId: string
}

export type AiRegistrationStagedDocumentInfo = {
  id: string
  originalFilename: string
  mimeType: string
  previewUrl: string
}

export type AiRegistrationFieldIssue = {
  code?: string
  message?: string
  severity?: string
  [key: string]: unknown
}

export type AiRegistrationValidation = {
  schemaVersion?: string
  jobId?: string
  passed?: boolean
  blockingErrors?: unknown[]
  fieldIssues?: Record<string, AiRegistrationFieldIssue[]>
  normalizedProposal?: Record<string, unknown>
}

export type AiRegistrationEvidence = {
  field: string
  page?: number | null
  snippet?: string
  bbox?: number[] | null
}

export type AiRegistrationUserOverride = {
  from?: unknown
  to?: unknown
  at?: string
  by?: string
}

export type AiRegistrationProposal = Record<string, unknown> & {
  userOverrides?: Record<string, AiRegistrationUserOverride>
  _meta?: Record<string, unknown>
}

export type AiRegistrationJob = {
  jobId: string
  status: AiRegistrationJobStatus
  stagedDocumentId: string
  letterId: string | null
  currentStage: 'ocr' | 'llm' | 'validation' | null
  errorCode: string | null
  errorMessage: string | null
  proposal: AiRegistrationProposal | unknown[] | null
  validation?: AiRegistrationValidation | null
  stagedDocument?: AiRegistrationStagedDocumentInfo | null
  evidence?: AiRegistrationEvidence[] | null
  aiGenerated?: string[] | null
  userOverrides?: Record<string, AiRegistrationUserOverride> | null
  reviewedBy?: string | null
  workerEnabled: boolean
  createdAt: string
  updatedAt: string | null
  startedAt: string | null
  ocrCompletedAt: string | null
  extractionCompletedAt: string | null
  reviewReadyAt: string | null
  completedAt: string | null
}

export const PROCESSING_JOB_STATUSES: ReadonlySet<AiRegistrationJobStatus> = new Set([
  'QUEUED',
  'PROCESSING',
  'OCR_COMPLETE',
  'EXTRACTION_COMPLETE',
])

export async function uploadStagedDocument(file: File, source: StagedUploadSource = 'register-letter') {
  const form = new FormData()
  form.append('file', file)
  form.append('source', source)
  return api.postForm<StagedDocument>('/api/ai-registration/staged-documents', form)
}

export async function createRegistrationJob(stagedDocumentId: string) {
  return api.post<AiRegistrationJobCreate>('/api/ai-registration/jobs', {
    stagedDocumentId,
  })
}

export async function getRegistrationJob(jobId: string) {
  return api.get<AiRegistrationJob>(`/api/ai-registration/jobs/${jobId}`)
}

export async function patchRegistrationProposal(jobId: string, updates: Record<string, unknown>) {
  return api.patch<AiRegistrationJob>(`/api/ai-registration/jobs/${jobId}/proposal`, updates)
}

export async function rejectRegistrationJob(jobId: string, reason = '') {
  return api.post<AiRegistrationJob>(`/api/ai-registration/jobs/${jobId}/reject`, { reason })
}

export async function rerunRegistrationJob(jobId: string) {
  return api.post<AiRegistrationJob>(`/api/ai-registration/jobs/${jobId}/rerun`, {})
}

/** @deprecated Prefer rerunRegistrationJob — kept for older callers. */
export async function retryRegistrationJob(jobId: string) {
  return api.post<AiRegistrationJob>(`/api/ai-registration/jobs/${jobId}/retry`, {})
}

export function stagedDocumentPreviewUrl(stagedDocumentId: string) {
  return `${API_BASE}/api/ai-registration/staged-documents/${stagedDocumentId}/preview`
}

export function resolveStagedPreviewUrl(staged: AiRegistrationStagedDocumentInfo | null | undefined) {
  if (!staged) return ''
  if (staged.previewUrl?.startsWith('http')) return staged.previewUrl
  if (staged.previewUrl) return `${API_BASE}${staged.previewUrl}`
  return stagedDocumentPreviewUrl(staged.id)
}
