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

export async function uploadStagedDocument(file: File, source: StagedUploadSource = 'register-letter') {
  const form = new FormData()
  form.append('file', file)
  form.append('source', source)
  return api.postForm<StagedDocument>('/api/ai-registration/staged-documents', form)
}
