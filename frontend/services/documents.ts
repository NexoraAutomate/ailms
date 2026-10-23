const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? ''

export type DocumentVersion = {
  id: number
  documentId: string
  versionNumber: string
  parentVersionId?: number | null
  filename: string
  originalFilename: string
  fileType: string
  mimeType: string
  fileSize: number
  uploadedBy: string
  uploadDate: string
  changeDescription: string
  status: string
  checksum: string
  isCurrent: boolean
  previewable: boolean
}

export type LetterDocument = {
  id: string
  letterId: string
  documentType: string
  status: string
  createdAt: string
  versionCount: number
  currentVersion: DocumentVersion | null
}

async function parseError(response: Response) {
  let detail = `Request failed (${response.status})`
  try {
    const body = await response.json()
    detail = body.detail ?? detail
  } catch {
    /* ignore */
  }
  throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
}

export async function listLetterDocuments(letterId: string, scope: 'letter' | 'workflow' | 'all' = 'letter') {
  const search = new URLSearchParams({ letterId, scope })
  const response = await fetch(`${API_BASE}/api/documents?${search.toString()}`, { cache: 'no-store' })
  if (!response.ok) await parseError(response)
  return response.json() as Promise<LetterDocument[]>
}

export async function listDocumentVersions(documentId: string) {
  const response = await fetch(`${API_BASE}/api/documents/${documentId}/versions`, { cache: 'no-store' })
  if (!response.ok) await parseError(response)
  return response.json() as Promise<DocumentVersion[]>
}

export async function uploadLetterDocument(
  letterId: string,
  file: File,
  documentType: string,
  changeDescription = '',
  scope: 'letter' | 'workflow' = 'letter',
) {
  const form = new FormData()
  form.append('file', file)
  form.append('document_type', documentType)
  form.append('change_description', changeDescription)
  form.append('scope', scope)
  const response = await fetch(`${API_BASE}/api/letters/${letterId}/documents/upload`, {
    method: 'POST',
    body: form,
  })
  if (!response.ok) await parseError(response)
  return response.json() as Promise<LetterDocument>
}

export async function uploadDocumentVersion(documentId: string, file: File, changeDescription = '') {
  const form = new FormData()
  form.append('file', file)
  form.append('change_description', changeDescription)
  const response = await fetch(`${API_BASE}/api/documents/${documentId}/versions`, {
    method: 'POST',
    body: form,
  })
  if (!response.ok) await parseError(response)
  return response.json() as Promise<DocumentVersion>
}

export async function updateLetterDocument(documentId: string, input: { documentType?: string }) {
  const response = await fetch(`${API_BASE}/api/documents/${documentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) await parseError(response)
  return response.json() as Promise<LetterDocument>
}

export async function deleteLetterDocument(documentId: string) {
  const response = await fetch(`${API_BASE}/api/documents/${documentId}`, { method: 'DELETE' })
  if (!response.ok) await parseError(response)
}

export function documentDownloadUrl(versionId: number) {
  return `${API_BASE}/api/document-versions/${versionId}/download`
}

export function documentPreviewUrl(versionId: number) {
  return `${API_BASE}/api/document-versions/${versionId}/preview`
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
