import { api } from '@/lib/api'

export type ImportJobResult = {
  id: number
  entityType: string
  filename: string
  status: string
  totalRows: number
  validRows: number
  importedRows: number
  rejectedRows: number
  duplicateRows: number
  errorRows: number
  createdBy: string
  createdAt: string
  completedAt: string
  errors: { rowNumber: number; field: string; message: string; rawValue: string }[]
}

export type BulkResult = {
  operation: string
  succeeded: number
  failed: number
  results: { letterId: number; success: boolean; message: string }[]
  csv?: string
}

export async function validateLetterImport(file: File) {
  const form = new FormData()
  form.append('file', file)
  return api.postForm<ImportJobResult>('/api/import/letters/validate', form)
}

export async function confirmLetterImport(jobId: number) {
  return api.post<ImportJobResult>(`/api/import/letters/${jobId}/confirm`)
}

export async function runBulkOperation(operation: string, letterIds: number[], payload?: Record<string, string>) {
  return api.post<BulkResult>('/api/bulk', { operation, letterIds, payload })
}

export async function archiveLetters(letterIds: number[]) {
  return api.post<{ archived: number[]; count: number }>('/api/archive/letters', { letterIds })
}

export async function restoreLetters(letterIds: number[]) {
  return api.post<{ restored: number[]; count: number }>('/api/archive/letters/restore', { letterIds })
}

export async function downloadExport(entity: 'letters' | 'departments' | 'organizations' | 'audit' | 'meetings' | 'notifications', includeArchived = false) {
  const query = entity === 'letters' && includeArchived ? '?include_archived=true' : ''
  const blob = await api.download(`/api/export/${entity}${query}`)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${entity}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}
