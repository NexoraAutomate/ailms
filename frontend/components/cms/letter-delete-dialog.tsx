'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/cms/ui'
import { deleteLetters, requestLetterDeleteChallenge, type Letter } from '@/services/letters'

export function LetterDeleteDialog({
  letters,
  onClose,
  onDeleted,
}: {
  letters: Letter[]
  onClose: () => void
  onDeleted: () => Promise<void>
}) {
  const [code, setCode] = useState('')
  const [typed, setTyped] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const ids = letters.map((letter) => Number(letter.id))
  const idKey = ids.join(',')
  const shown = letters.slice(0, 8)
  const extra = letters.length - shown.length

  const loadCode = async () => {
    setLoading(true)
    setError('')
    setTyped('')
    try {
      const challenge = await requestLetterDeleteChallenge(ids)
      setCode(challenge.confirmationCode)
    } catch (err) {
      setCode('')
      setError(err instanceof Error ? err.message : 'Unable to start deletion')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setTyped('')
    requestLetterDeleteChallenge(idKey.split(',').filter(Boolean).map(Number))
      .then((challenge) => {
        if (!cancelled) setCode(challenge.confirmationCode)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setCode('')
        setError(err instanceof Error ? err.message : 'Unable to start deletion')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [idKey])

  const matches = code !== '' && typed.trim().toUpperCase().replace(/\s/g, '') === code

  const confirm = async () => {
    if (!matches) return
    setBusy(true)
    setError('')
    try {
      await deleteLetters(ids, typed.trim())
      await onDeleted()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" role="presentation">
      <Card className="w-full max-w-md p-5" role="dialog" aria-modal="true" aria-labelledby="delete-letter-title">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 id="delete-letter-title" className="text-sm font-bold text-slate-800">Confirm deletion</h2>
            <p className="mt-1 text-xs text-slate-500">
              {letters.length === 1 ? 'This letter' : `These ${letters.length} letters`} and related actions, documents, approvals, and links will be removed.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"><X className="size-4 text-slate-400" /></button>
        </div>
        <ul className="mb-4 max-h-28 overflow-auto rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {shown.map((letter) => (
            <li key={letter.id} className="truncate">{letter.number} — {letter.subject}</li>
          ))}
          {extra > 0 && <li className="text-slate-400">and {extra} more</li>}
        </ul>
        <p className="text-xs font-semibold text-slate-600">Type this confirmation code</p>
        <p className="my-2 text-center font-mono text-2xl font-bold tracking-[0.35em] text-[#102a43]">{loading ? '······' : code || '—'}</p>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value.toUpperCase())}
          autoComplete="off"
          placeholder="Confirmation code"
          className="h-10 w-full rounded-md border border-slate-200 px-3 font-mono text-sm tracking-widest"
          aria-label="Confirmation code"
        />
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="button" variant="outline" onClick={() => void loadCode()} disabled={busy || loading}>New code</Button>
          <Button type="button" variant="destructive" onClick={() => void confirm()} disabled={!matches || busy || loading}>
            {busy ? 'Deleting…' : letters.length === 1 ? 'Delete letter' : `Delete ${letters.length} letters`}
          </Button>
        </div>
      </Card>
    </div>
  )
}
