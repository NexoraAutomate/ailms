'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { uploadStagedDocument, type StagedDocument } from '@/services/ai-registration'

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp'

export function RegistrationUpload({
  onStaged,
}: {
  onStaged?: (doc: StagedDocument) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [staged, setStaged] = useState<StagedDocument | null>(null)

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
      onStaged?.(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
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
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy || !file} onClick={upload}>
          {busy ? 'Uploading…' : 'Upload document'}
        </Button>
        <Button type="button" variant="outline" disabled title="Job enqueue arrives in the next implementation step">
          Start analysis
        </Button>
      </div>
      {staged && (
        <p className="text-[11px] text-slate-400">
          Document staged successfully. Start analysis will enqueue OCR and extraction once that step is enabled.
        </p>
      )}
    </div>
  )
}
