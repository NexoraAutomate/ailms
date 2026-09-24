'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  createRegistrationJob,
  uploadStagedDocument,
  type AiRegistrationJobCreate,
  type StagedDocument,
} from '@/services/ai-registration'

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp'

export function RegistrationUpload({
  onStaged,
  onJobCreated,
}: {
  onStaged?: (doc: StagedDocument) => void
  onJobCreated?: (job: AiRegistrationJobCreate) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [staged, setStaged] = useState<StagedDocument | null>(null)
  const [job, setJob] = useState<AiRegistrationJobCreate | null>(null)

  const upload = async () => {
    setError('')
    if (!file) {
      setError('Select a PDF or image file to upload.')
      return
    }
    setBusy(true)
    try {
      const result = await uploadStagedDocument(file, 'register-letter')
      setStaged(result)
      setJob(null)
      onStaged?.(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  const startAnalysis = async () => {
    setError('')
    if (!staged) {
      setError('Upload a document before starting analysis.')
      return
    }
    setBusy(true)
    try {
      const created = await createRegistrationJob(staged.stagedDocumentId)
      setJob(created)
      try {
        sessionStorage.setItem('ailms.lastAiRegistrationJobId', created.jobId)
      } catch {
        /* ignore private-mode / SSR */
      }
      onJobCreated?.(created)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start analysis')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Upload a letter PDF or image. The file is stored for analysis; no official letter is created until you approve after review.
      </p>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-slate-600">Document file</span>
        <input
          type="file"
          accept={ACCEPT}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null)
            setStaged(null)
            setJob(null)
            setError('')
          }}
          className="text-xs"
        />
      </label>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {staged && (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-700">
          <p className="font-semibold text-slate-800">Staged for analysis</p>
          <p className="mt-1">ID: {staged.stagedDocumentId}</p>
          <p>{staged.originalFilename} · {(staged.fileSize / 1024).toFixed(1)} KiB</p>
          <p className="mt-1 break-all text-slate-500">{staged.checksum}</p>
        </div>
      )}
      {job && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 text-xs text-emerald-900">
          <p className="font-semibold">Analysis queued</p>
          <p className="mt-1">
            Job {job.jobId} · status {job.status}
          </p>
          <p className="mt-1 text-emerald-800/80">
            OCR and extraction run in the background when the worker is enabled. Poll this job id for status.
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy || !file} onClick={upload}>
          {busy && !staged ? 'Uploading…' : 'Upload document'}
        </Button>
        <Button type="button" variant="outline" disabled={busy || !staged || !!job} onClick={startAnalysis}>
          {busy && staged && !job ? 'Starting…' : 'Start analysis'}
        </Button>
      </div>
      {staged && !job && (
        <p className="text-[11px] text-slate-400">
          Document staged successfully. Start analysis enqueues OCR and extraction (job status QUEUED).
        </p>
      )}
    </div>
  )
}
