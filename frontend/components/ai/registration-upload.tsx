'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  PROCESSING_JOB_STATUSES,
  createRegistrationJob,
  getRegistrationJob,
  uploadStagedDocument,
  type AiRegistrationJob,
  type AiRegistrationJobCreate,
  type AiRegistrationJobStatus,
  type StagedDocument,
} from '@/services/ai-registration'

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp'
const POLL_MS = 2000
const LAST_JOB_KEY = 'ailms.lastAiRegistrationJobId'

function stageLabel(status: AiRegistrationJobStatus, currentStage: AiRegistrationJob['currentStage']) {
  if (status === 'QUEUED') return 'Queued — waiting for worker'
  if (status === 'PROCESSING') {
    if (currentStage === 'ocr') return 'Running OCR…'
    if (currentStage === 'llm') return 'Extracting fields with LLM…'
    if (currentStage === 'validation') return 'Validating proposal…'
    return 'Processing…'
  }
  if (status === 'OCR_COMPLETE') return 'OCR complete — starting extraction…'
  if (status === 'EXTRACTION_COMPLETE') return 'Extraction complete — validating…'
  if (status === 'NEEDS_REVIEW') return 'Ready for review'
  if (status === 'FAILED') return 'Analysis failed'
  if (status === 'REJECTED') return 'Rejected'
  return status
}

export function RegistrationUpload({
  onStaged,
  onJobCreated,
  onNeedsReview,
}: {
  onStaged?: (doc: StagedDocument) => void
  onJobCreated?: (job: AiRegistrationJobCreate) => void
  /** Called when a job reaches NEEDS_REVIEW (for navigation to the review route). */
  onNeedsReview?: (job: AiRegistrationJob) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [staged, setStaged] = useState<StagedDocument | null>(null)
  const [job, setJob] = useState<AiRegistrationJobCreate | null>(null)
  const [liveJob, setLiveJob] = useState<AiRegistrationJob | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const navigatedRef = useRef<string | null>(null)

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  const rememberJob = (jobId: string) => {
    try {
      sessionStorage.setItem(LAST_JOB_KEY, jobId)
    } catch {
      /* ignore private-mode / SSR */
    }
  }

  const handleJobSnapshot = (snapshot: AiRegistrationJob, { navigate = false } = {}) => {
    setLiveJob(snapshot)
    setJob({
      jobId: snapshot.jobId,
      status: snapshot.status,
      stagedDocumentId: snapshot.stagedDocumentId,
    })
    if (
      navigate &&
      snapshot.status === 'NEEDS_REVIEW' &&
      navigatedRef.current !== snapshot.jobId
    ) {
      navigatedRef.current = snapshot.jobId
      stopPolling()
      onNeedsReview?.(snapshot)
    }
    if (snapshot.status === 'FAILED' || snapshot.status === 'REJECTED' || snapshot.status === 'REGISTERED') {
      stopPolling()
    }
  }

  const startPolling = (jobId: string) => {
    stopPolling()
    const tick = async () => {
      try {
        const snapshot = await getRegistrationJob(jobId)
        handleJobSnapshot(snapshot, { navigate: true })
        if (!PROCESSING_JOB_STATUSES.has(snapshot.status)) {
          stopPolling()
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to poll job status')
        stopPolling()
      }
    }
    void tick()
    pollRef.current = setInterval(() => {
      void tick()
    }, POLL_MS)
  }

  useEffect(() => {
    let cancelled = false
    const resume = async () => {
      let lastId = ''
      try {
        lastId = sessionStorage.getItem(LAST_JOB_KEY) || ''
      } catch {
        return
      }
      if (!lastId) return
      try {
        const snapshot = await getRegistrationJob(lastId)
        if (cancelled) return
        handleJobSnapshot(snapshot, { navigate: false })
        if (PROCESSING_JOB_STATUSES.has(snapshot.status)) {
          startPolling(snapshot.jobId)
        }
      } catch {
        /* stale job id — ignore */
      }
    }
    void resume()
    return () => {
      cancelled = true
      stopPolling()
    }
  }, [])

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
      setLiveJob(null)
      navigatedRef.current = null
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
      setLiveJob(null)
      navigatedRef.current = null
      rememberJob(created.jobId)
      onJobCreated?.(created)
      startPolling(created.jobId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start analysis')
    } finally {
      setBusy(false)
    }
  }

  const openReview = () => {
    if (!liveJob || liveJob.status !== 'NEEDS_REVIEW') return
    onNeedsReview?.(liveJob)
  }

  const status = liveJob?.status ?? job?.status
  const processing = status ? PROCESSING_JOB_STATUSES.has(status) : false

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Upload a letter PDF or image. The file is stored for analysis; no official letter is created until you approve after
        review.
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
            setLiveJob(null)
            setError('')
            navigatedRef.current = null
            stopPolling()
          }}
          className="text-xs"
        />
      </label>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {staged && (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-700">
          <p className="font-semibold text-slate-800">Staged for analysis</p>
          <p className="mt-1">ID: {staged.stagedDocumentId}</p>
          <p>
            {staged.originalFilename} · {(staged.fileSize / 1024).toFixed(1)} KiB
          </p>
          <p className="mt-1 break-all text-slate-500">{staged.checksum}</p>
        </div>
      )}
      {(job || liveJob) && status && (
        <div
          className={`rounded-md border px-3 py-3 text-xs ${
            status === 'FAILED' || status === 'REJECTED'
              ? 'border-red-200 bg-red-50 text-red-900'
              : status === 'NEEDS_REVIEW'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-slate-200 bg-slate-50 text-slate-800'
          }`}
        >
          <p className="font-semibold">
            {status === 'NEEDS_REVIEW' ? 'Analysis ready for review' : processing ? 'Analysis in progress' : 'Job status'}
          </p>
          <p className="mt-1">
            Job {job?.jobId ?? liveJob?.jobId} · {status}
          </p>
          <p className="mt-1 opacity-80">{stageLabel(status, liveJob?.currentStage ?? null)}</p>
          {liveJob?.errorMessage && (
            <p className="mt-2 text-red-700">{liveJob.errorMessage}</p>
          )}
          {liveJob?.workerEnabled === false && processing && (
            <p className="mt-2 text-amber-800">
              Background worker is disabled. Enable AI registration worker settings, then retry.
            </p>
          )}
          {status === 'NEEDS_REVIEW' && (
            <div className="mt-3">
              <Button type="button" size="sm" onClick={openReview}>
                Open review
              </Button>
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy || !file || processing} onClick={upload}>
          {busy && !staged ? 'Uploading…' : 'Upload document'}
        </Button>
        <Button type="button" variant="outline" disabled={busy || !staged || !!job || processing} onClick={startAnalysis}>
          {busy && staged && !job ? 'Starting…' : 'Start analysis'}
        </Button>
      </div>
      {staged && !job && (
        <p className="text-[11px] text-slate-400">
          Document staged successfully. Start analysis enqueues OCR and extraction (job status QUEUED).
        </p>
      )}
      {processing && (
        <p className="text-[11px] text-slate-400">
          Polling job status… you will be taken to the review screen when extraction is ready.
        </p>
      )}
    </div>
  )
}
