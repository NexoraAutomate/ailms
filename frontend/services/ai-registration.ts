import { api } from '@/lib/api'

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

export type AiRegistrationJob = {
  jobId: string
  status: AiRegistrationJobStatus
  stagedDocumentId: string
  letterId: string | null
  currentStage: 'ocr' | 'llm' | 'validation' | null
  errorCode: string | null
  errorMessage: string | null
  proposal: Record<string, unknown> | unknown[] | null
  workerEnabled: boolean
  createdAt: string
  updatedAt: string | null
  startedAt: string | null
  ocrCompletedAt: string | null
  extractionCompletedAt: string | null
  reviewReadyAt: string | null
  completedAt: string | null
}

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

export async function retryRegistrationJob(jobId: string) {
  return api.post<AiRegistrationJob>(`/api/ai-registration/jobs/${jobId}/retry`, {})
}
