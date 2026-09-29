'use client'

import { useMemo, useState } from 'react'
import { Paperclip, X } from 'lucide-react'
import { useAppData } from '@/components/app-provider'
import { Button } from '@/components/ui/button'
import { IconActionButton } from '@/components/ui/icon-action-button'
import { Card } from '@/components/cms/ui'
import { replyWorkflowAction, workflowStatus } from '@/services/letter-actions'
import { uploadLetterDocument, formatFileSize } from '@/services/documents'
import { executeWorkflow } from '@/services/workflow'
import type { Letter } from '@/services/letters'

type Person = { name: string; department?: string }

const DEFAULT_DOC_TYPES = [
  'Draft Response',
  'Final Response',
  'Supporting Document',
  'Email',
  'Presentation',
  'Attachment',
  'Other',
]

const ACCEPT =
  '.pdf,.png,.jpg,.jpeg,.gif,.webp,.doc,.docx,.xls,.xlsx,.csv,.txt,.rtf,.ppt,.pptx,.odt,.ods,.odp,.eml,.msg,.zip'

function inferDocumentType(filename: string, fallback: string) {
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')).toLowerCase() : ''
  if (ext === '.eml' || ext === '.msg') return 'Email'
  if (ext === '.ppt' || ext === '.pptx' || ext === '.odp') return 'Presentation'
  if (ext === '.pdf' || ext === '.doc' || ext === '.docx' || ext === '.odt' || ext === '.rtf') return fallback
  return 'Attachment'
}

/** Person who sent / marked this letter to the current holder — not selectable. */
export function resolveReplyRecipient(letter: Letter, users: Person[], currentUserName?: string): string {
  const me = (currentUserName || '').trim()
  const assignedBy = (letter.assignedBy || '').trim()
  if (assignedBy && assignedBy !== me) return assignedBy

  const from = (letter.from || '').trim()
  if (from && from !== me) {
    const match = users.find((u) => u.name === from)
    if (match) return match.name
  }

  const createdBy = (letter.createdBy || '').trim()
  if (createdBy && createdBy !== me) return createdBy

  return assignedBy || from || createdBy || ''
}

export function ReplyDialog({
  letter,
  users,
  role,
  onClose,
  onDone,
}: {
  letter: Letter
  users: Person[]
  role: string
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const { masterData, me } = useAppData()
  const docTypes = masterData['Document Types']?.length ? masterData['Document Types'] : DEFAULT_DOC_TYPES
  const replyTo = useMemo(() => resolveReplyRecipient(letter, users, me.name), [letter, users, me.name])
  const replyPerson = useMemo(() => users.find((u) => u.name === replyTo), [users, replyTo])
  const [remarks, setRemarks] = useState('')
  const [documentType, setDocumentType] = useState(
    docTypes.includes('Draft Response') ? 'Draft Response' : docTypes[0] ?? 'Attachment',
  )
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return
    setFiles((prev) => {
      const next = [...prev]
      for (const file of Array.from(list)) {
        if (!next.some((f) => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified)) {
          next.push(file)
        }
      }
      return next
    })
  }

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const submit = async () => {
    const recipient = replyTo.trim()
    const note = remarks.trim()
    if (!recipient) {
      setError('Cannot determine who this letter came from.')
      return
    }
    if (!note) {
      setError('Enter a reply message.')
      return
    }
    const workflow = replyWorkflowAction(workflowStatus(letter), role)
    if (!workflow) {
      setError('Reply is not available for this letter status.')
      return
    }

    setBusy(true)
    setError('')
    try {
      await executeWorkflow(letter.id, {
        action: workflow,
        remarks: note,
        actionLabel: 'Reply',
        assignedTo: recipient,
      })

      const uploadErrors: string[] = []
      for (const file of files) {
        const type = documentType || inferDocumentType(file.name, 'Draft Response')
        try {
          await uploadLetterDocument(letter.id, file, type, `Reply attachment · to ${recipient}`)
        } catch (err) {
          uploadErrors.push(err instanceof Error ? err.message : file.name)
        }
      }

      if (uploadErrors.length) {
        setError(`Reply sent, but some attachments failed: ${uploadErrors.join('; ')}`)
        await onDone()
        return
      }

      await onDone()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reply failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
      <Card className="max-h-[90vh] w-full max-w-xl overflow-y-auto p-5" role="dialog" aria-modal="true" aria-labelledby="reply-dialog-title">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 id="reply-dialog-title" className="text-sm font-bold text-slate-700">Reply · {letter.number}</h2>
            <p className="mt-0.5 text-xs text-slate-400">Reply goes to the person this letter came from. Attachments optional.</p>
          </div>
          <IconActionButton label="Close" icon={X} onClick={onClose} disabled={busy} />
        </div>

        {error && <p className="mb-3 text-xs text-red-600">{error}</p>}

        <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Reply to</p>
          {replyTo ? (
            <p className="mt-1 text-sm font-semibold text-slate-800">
              {replyTo}
              {replyPerson?.department ? (
                <span className="font-medium text-slate-500"> · {replyPerson.department}</span>
              ) : null}
            </p>
          ) : (
            <p className="mt-1 text-xs text-red-600">No sender found on this letter.</p>
          )}
        </div>

        <label className="mb-3 flex flex-col gap-1">
          <span className="text-xs font-semibold text-slate-600">Reply message *</span>
          <textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            className="min-h-28 rounded-md border border-slate-200 px-3 py-2 text-xs"
            placeholder="Write your reply…"
            disabled={busy}
          />
        </label>

        <div className="mb-3 rounded-md border border-dashed border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
            <Paperclip className="size-3.5" />
            Attachments
          </div>
          <p className="mb-3 text-[11px] text-slate-400">
            Letters, documents, email (.eml/.msg), presentations, or other files.
          </p>
          <label className="mb-3 flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-600">Attachment type</span>
            <select
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value)}
              className="h-10 rounded-md border border-slate-200 bg-white px-3 text-xs"
              disabled={busy}
            >
              {docTypes.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-600">Add files</span>
            <input
              type="file"
              multiple
              accept={ACCEPT}
              disabled={busy}
              onChange={(e) => {
                addFiles(e.target.files)
                e.target.value = ''
              }}
              className="text-xs"
            />
          </label>
          {files.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1.5">
              {files.map((file, index) => (
                <li
                  key={`${file.name}-${file.size}-${file.lastModified}`}
                  className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                >
                  <span className="min-w-0 truncate text-slate-700">
                    {file.name}
                    <span className="text-slate-400"> · {formatFileSize(file.size)}</span>
                  </span>
                  <button
                    type="button"
                    className="shrink-0 text-slate-400 hover:text-red-600"
                    onClick={() => removeFile(index)}
                    disabled={busy}
                    aria-label={`Remove ${file.name}`}
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={busy || !replyTo}>
            {busy ? 'Sending…' : 'Send reply'}
          </Button>
        </div>
      </Card>
    </div>
  )
}
