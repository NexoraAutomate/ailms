'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Paperclip, Send, Trash2 } from 'lucide-react'
import { AppSelect } from '@/components/ui/app-select'
import { Button } from '@/components/ui/button'
import { UserMultiSelect } from '@/components/cms/user-multi-select'
import {
  ATTACHMENT_KINDS,
  RESPONSE_TYPES,
  RESPONSE_TYPE_LABELS,
  type AttachmentKind,
  type MarkingAction,
  type ResponseType,
} from '@/services/marking-types'
import { uploadLetterDocument } from '@/services/documents'
import {
  addDraftAttachments,
  addDraftNote,
  deleteDraftAttachment,
  deleteDraftNote,
  putDraftRoster,
  setDraftTargetPrivacy,
  updateDraftNote,
  type DraftAttachment,
  type DraftNote,
  type DraftRosterRecipientInput,
  type MarkRecipientInput,
  type MarkingDrafts,
} from '@/services/markings'

type UserOption = { name: string; department?: string }

type ToEntry = {
  toUser: string
  action: MarkingAction
  responseType: ResponseType | ''
  responseTypeOther: string
  dueAt: string
}

export type DraftCommentsComposerHandle = {
  requestMark: () => void
}

type DraftCommentsComposerProps = {
  letterId: string
  users: UserOption[]
  meName: string
  drafts: MarkingDrafts | null
  onDraftsChange: (drafts: MarkingDrafts) => void
  disabled?: boolean
  /** When true, Mark is rendered by the parent (e.g. Workflow action bar). */
  hideMarkButton?: boolean
  onMarkAvailabilityChange?: (state: { canMark: boolean; busy: boolean }) => void
  onRequestMark: (recipients: MarkRecipientInput[]) => void
}

const TO_ACTIONS: { value: MarkingAction; label: string }[] = [
  { value: 'forward', label: 'Forward' },
  { value: 'response_required', label: 'Response Required' },
]

function noteForTarget(notes: DraftNote[], target: string) {
  return notes.find(
    (n) =>
      (n.targetUser || '') === target &&
      ((n.intent || 'forward').toLowerCase() === 'forward'),
  )
}

function attsForTarget(attachments: DraftAttachment[], target: string) {
  return attachments.filter(
    (a) =>
      (a.targetUser || '') === target &&
      ((a.intent || 'forward').toLowerCase() === 'forward'),
  )
}

function rosterToEntries(drafts: MarkingDrafts | null): { to: ToEntry[]; info: string[] } {
  const roster = drafts?.roster ?? []
  const to: ToEntry[] = []
  const info: string[] = []
  for (const row of roster) {
    const name = (row.toUser || '').trim()
    if (!name) continue
    const role = (row.role || 'to').toLowerCase()
    if (role === 'info' || row.action === 'for_info') {
      info.push(name)
      continue
    }
    to.push({
      toUser: name,
      action: (row.action === 'response_required' ? 'response_required' : 'forward') as MarkingAction,
      responseType: (row.responseType || '') as ResponseType | '',
      responseTypeOther: row.responseTypeOther || '',
      dueAt: (row.dueAt || '').slice(0, 10),
    })
  }
  // Legacy drafts without roster: seed To from personal draft targets.
  if (!roster.length && drafts) {
    for (const name of drafts.forwardTargetUsers ?? []) {
      if (!to.some((t) => t.toUser === name) && !info.includes(name)) {
        to.push({
          toUser: name,
          action: 'forward',
          responseType: '',
          responseTypeOther: '',
          dueAt: '',
        })
      }
    }
  }
  return { to, info }
}

export const DraftCommentsComposer = forwardRef<
  DraftCommentsComposerHandle,
  DraftCommentsComposerProps
>(function DraftCommentsComposer(
  {
    letterId,
    users,
    meName,
    drafts,
    onDraftsChange,
    disabled = false,
    hideMarkButton = false,
    onMarkAvailabilityChange,
    onRequestMark,
  },
  ref,
) {
  const [toEntries, setToEntries] = useState<ToEntry[]>([])
  const [infoUsers, setInfoUsers] = useState<string[]>([])
  const [activeToUser, setActiveToUser] = useState<string | null>(null)
  const [commonBody, setCommonBody] = useState('')
  const [perToBodies, setPerToBodies] = useState<Record<string, string>>({})
  /** Send Privately per To recipient — default off (visible to all mark recipients). */
  const [perToPrivate, setPerToPrivate] = useState<Record<string, boolean>>({})
  const [defaultKind, setDefaultKind] = useState<AttachmentKind>('Supporting Doc')
  const [busyAttach, setBusyAttach] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [hydrated, setHydrated] = useState(false)

  const rosterTimer = useRef<number | null>(null)
  const commonTimer = useRef<number | null>(null)
  const perToTimers = useRef<Record<string, number>>({})
  const commonNoteIdRef = useRef<number | null>(null)
  const perToNoteIdsRef = useRef<Record<string, number | null>>({})
  const skipRosterSave = useRef(true)
  const hydratedLetterRef = useRef<string | null>(null)
  const savingContentRef = useRef(false)

  const applyHydration = useCallback((source: MarkingDrafts) => {
    const { to, info } = rosterToEntries(source)
    const commonNote = noteForTarget(source.notes, '')
    const bodies: Record<string, string> = {}
    const privateFlags: Record<string, boolean> = {}
    const ids: Record<string, number | null> = {}
    for (const entry of to) {
      const n = noteForTarget(source.notes, entry.toUser)
      const att = attsForTarget(source.attachments, entry.toUser)[0]
      bodies[entry.toUser] = n?.bodyText ?? ''
      ids[entry.toUser] = n?.id ?? null
      privateFlags[entry.toUser] = Boolean(n?.sendPrivately ?? att?.sendPrivately)
    }
    skipRosterSave.current = true
    setToEntries(to)
    setInfoUsers(info)
    setActiveToUser(to[0]?.toUser ?? null)
    setCommonBody(commonNote?.bodyText ?? '')
    setPerToBodies(bodies)
    setPerToPrivate(privateFlags)
    commonNoteIdRef.current = commonNote?.id ?? null
    perToNoteIdsRef.current = ids
    setHydrated(true)
    window.setTimeout(() => {
      skipRosterSave.current = false
    }, 50)
  }, [])

  // Hydrate once per letter from server drafts (avoid re-seeding after our own autosaves).
  useEffect(() => {
    if (!drafts) return
    if (hydratedLetterRef.current === letterId) return
    hydratedLetterRef.current = letterId
    applyHydration(drafts)
  }, [applyHydration, drafts, letterId])

  // After Mark consumes drafts, reset the composer when the server roster/content is empty.
  useEffect(() => {
    if (!drafts || hydratedLetterRef.current !== letterId || savingContentRef.current) return
    const serverEmpty =
      !(drafts.roster?.length) &&
      !drafts.notes.some((n) => (n.intent || 'forward').toLowerCase() === 'forward') &&
      !drafts.attachments.some((a) => (a.intent || 'forward').toLowerCase() === 'forward')
    const localHasRecipients = toEntries.length > 0 || infoUsers.length > 0
    if (serverEmpty && localHasRecipients && !skipRosterSave.current) {
      // Likely mid-edit before first roster save — do not wipe.
      return
    }
    if (serverEmpty && !localHasRecipients) {
      commonNoteIdRef.current = null
      perToNoteIdsRef.current = {}
    }
  }, [drafts, infoUsers.length, letterId, toEntries.length])

  const buildRosterPayload = useCallback((): DraftRosterRecipientInput[] => {
    const rows: DraftRosterRecipientInput[] = toEntries.map((e) => ({
      toUser: e.toUser,
      role: 'to',
      action: e.action,
      responseType: e.action === 'response_required' ? e.responseType || undefined : undefined,
      responseTypeOther:
        e.action === 'response_required' && e.responseType === 'other'
          ? e.responseTypeOther || undefined
          : undefined,
      dueAt: e.action === 'response_required' && e.dueAt ? e.dueAt : null,
      track: true,
      remindersEnabled: true,
    }))
    for (const name of infoUsers) {
      rows.push({ toUser: name, role: 'info', action: 'for_info', track: true, remindersEnabled: true })
    }
    return rows
  }, [infoUsers, toEntries])

  const persistRoster = useCallback(async () => {
    if (skipRosterSave.current || disabled) return
    try {
      const result = await putDraftRoster(letterId, buildRosterPayload())
      onDraftsChange(result.drafts)
      setSaveError('')
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save recipients')
    }
  }, [buildRosterPayload, disabled, letterId, onDraftsChange])

  useEffect(() => {
    if (!hydrated || skipRosterSave.current) return
    if (rosterTimer.current != null) window.clearTimeout(rosterTimer.current)
    rosterTimer.current = window.setTimeout(() => {
      void persistRoster()
    }, 400)
    return () => {
      if (rosterTimer.current != null) window.clearTimeout(rosterTimer.current)
    }
  }, [hydrated, persistRoster, toEntries, infoUsers])

  const persistCommonBody = useCallback(
    async (text: string) => {
      if (disabled) return
      const trimmed = text.trim()
      const existingId = commonNoteIdRef.current
      savingContentRef.current = true
      try {
        if (!trimmed) {
          if (existingId != null) {
            const result = await deleteDraftNote(existingId)
            commonNoteIdRef.current = null
            onDraftsChange(result.drafts)
          }
          return
        }
        if (existingId != null) {
          const result = await updateDraftNote(existingId, trimmed)
          onDraftsChange(result.drafts)
        } else {
          const result = await addDraftNote(letterId, {
            bodyText: trimmed,
            targetUser: '',
            intent: 'forward',
          })
          commonNoteIdRef.current = result.note.id
          onDraftsChange(result.drafts)
        }
        setSaveError('')
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Failed to save common comment')
      } finally {
        savingContentRef.current = false
      }
    },
    [disabled, letterId, onDraftsChange],
  )

  const persistPerToBody = useCallback(
    async (user: string, text: string) => {
      if (disabled) return
      const trimmed = text.trim()
      const existingId = perToNoteIdsRef.current[user] ?? null
      savingContentRef.current = true
      try {
        if (!trimmed) {
          if (existingId != null) {
            const result = await deleteDraftNote(existingId)
            perToNoteIdsRef.current[user] = null
            onDraftsChange(result.drafts)
          }
          return
        }
        if (existingId != null) {
          const result = await updateDraftNote(existingId, trimmed)
          onDraftsChange(result.drafts)
        } else {
          const result = await addDraftNote(letterId, {
            bodyText: trimmed,
            targetUser: user,
            intent: 'forward',
            sendPrivately: perToPrivate[user] ?? false,
          })
          perToNoteIdsRef.current[user] = result.note.id
          onDraftsChange(result.drafts)
        }
        setSaveError('')
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Failed to save comment')
      } finally {
        savingContentRef.current = false
      }
    },
    [disabled, letterId, onDraftsChange, perToPrivate],
  )

  useEffect(() => {
    if (!hydrated) return
    if (commonTimer.current != null) window.clearTimeout(commonTimer.current)
    commonTimer.current = window.setTimeout(() => {
      void persistCommonBody(commonBody)
    }, 400)
    return () => {
      if (commonTimer.current != null) window.clearTimeout(commonTimer.current)
    }
  }, [commonBody, hydrated, persistCommonBody])

  useEffect(() => {
    if (!hydrated) return
    for (const entry of toEntries) {
      const user = entry.toUser
      const text = perToBodies[user] ?? ''
      if (perToTimers.current[user] != null) window.clearTimeout(perToTimers.current[user])
      perToTimers.current[user] = window.setTimeout(() => {
        void persistPerToBody(user, text)
      }, 400)
    }
    return () => {
      for (const t of Object.values(perToTimers.current)) window.clearTimeout(t)
    }
  }, [hydrated, perToBodies, persistPerToBody, toEntries])

  const setToUsers = (names: string[]) => {
    setToEntries((prev) => {
      const byName = new Map(prev.map((e) => [e.toUser, e]))
      return names.map(
        (name) =>
          byName.get(name) ?? {
            toUser: name,
            action: 'forward' as MarkingAction,
            responseType: '' as const,
            responseTypeOther: '',
            dueAt: '',
          },
      )
    })
    setPerToBodies((prev) => {
      const next: Record<string, string> = {}
      for (const name of names) next[name] = prev[name] ?? ''
      return next
    })
    setPerToPrivate((prev) => {
      const next: Record<string, boolean> = {}
      for (const name of names) next[name] = prev[name] ?? false
      return next
    })
    setActiveToUser((prev) => {
      if (prev && names.includes(prev)) return prev
      return names[names.length - 1] ?? null
    })
    // Drop Info overlap
    setInfoUsers((prev) => prev.filter((n) => !names.includes(n)))
  }

  const updateToEntry = (name: string, patch: Partial<ToEntry>) => {
    setToEntries((prev) => prev.map((e) => (e.toUser === name ? { ...e, ...patch } : e)))
  }

  const setSendPrivately = async (user: string, checked: boolean) => {
    setPerToPrivate((prev) => ({ ...prev, [user]: checked }))
    try {
      const result = await setDraftTargetPrivacy(letterId, user, checked)
      onDraftsChange(result.drafts)
      setSaveError('')
    } catch (err) {
      setPerToPrivate((prev) => ({ ...prev, [user]: !checked }))
      setSaveError(err instanceof Error ? err.message : 'Failed to update privacy')
    }
  }

  const uploadFiles = async (targetUser: string, files: FileList | null) => {
    if (!files?.length || disabled) return
    setBusyAttach(true)
    try {
      const uploaded: {
        attachmentKind: string
        documentId: number
        originalFilename: string
      }[] = []
      for (const file of Array.from(files)) {
        const doc = await uploadLetterDocument(
          letterId,
          file,
          defaultKind,
          `Workflow attachment (${defaultKind})`,
          'workflow',
        )
        uploaded.push({
          attachmentKind: defaultKind,
          documentId: Number(doc.id),
          originalFilename: file.name,
        })
      }
      const result = await addDraftAttachments(
        letterId,
        uploaded,
        targetUser,
        'forward',
        targetUser ? (perToPrivate[targetUser] ?? false) : false,
      )
      onDraftsChange(result.drafts)
      setSaveError('')
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to upload attachment')
    } finally {
      setBusyAttach(false)
    }
  }

  const removeAttachment = async (id: number) => {
    if (disabled) return
    try {
      const result = await deleteDraftAttachment(id)
      onDraftsChange(result.drafts)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to remove attachment')
    }
  }

  const canMark = toEntries.length + infoUsers.length > 0 && !disabled

  const markRecipients = useMemo((): MarkRecipientInput[] => {
    const rows: MarkRecipientInput[] = toEntries.map((e) => ({
      toUser: e.toUser,
      action: e.action,
      responseType: e.action === 'response_required' ? (e.responseType as ResponseType) : undefined,
      responseTypeOther:
        e.action === 'response_required' && e.responseType === 'other'
          ? e.responseTypeOther
          : undefined,
      dueAt: e.action === 'response_required' && e.dueAt ? e.dueAt : undefined,
      track: true,
      remindersEnabled: true,
    }))
    for (const name of infoUsers) {
      rows.push({
        toUser: name,
        action: 'for_info',
        track: true,
        remindersEnabled: true,
      })
    }
    return rows
  }, [infoUsers, toEntries])

  const commonAtts = attsForTarget(drafts?.attachments ?? [], '')
  const excludeForTo = [meName, ...infoUsers]
  const excludeForInfo = [meName, ...toEntries.map((e) => e.toUser)]
  const activeEntry = toEntries.find((e) => e.toUser === activeToUser) ?? null

  const handleMarkClick = useCallback(() => {
    for (const e of toEntries) {
      if (e.action === 'response_required' && !e.responseType) {
        setSaveError(`Choose a response type for ${e.toUser}`)
        setActiveToUser(e.toUser)
        return
      }
    }
    onRequestMark(markRecipients)
  }, [markRecipients, onRequestMark, toEntries])

  useImperativeHandle(ref, () => ({ requestMark: handleMarkClick }), [handleMarkClick])

  useEffect(() => {
    onMarkAvailabilityChange?.({ canMark, busy: busyAttach })
  }, [busyAttach, canMark, onMarkAvailabilityChange])

  return (
    <section className="mb-5 rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5 sm:px-4">
        <div>
          <h2 className="text-sm font-bold text-slate-700">My Draft Comments</h2>
          <p className="text-[11px] text-slate-400">
            Choose recipients, compose comments, then Mark to send.
          </p>
        </div>
        {!hideMarkButton ? (
          <Button size="sm" disabled={!canMark || busyAttach} onClick={handleMarkClick}>
            <Send className="mr-1 h-3.5 w-3.5" />
            Mark
          </Button>
        ) : null}
      </div>

      <div className="space-y-4 p-3 sm:p-4">
        {saveError ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
            {saveError}
          </p>
        ) : null}

        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600">To</label>
          <UserMultiSelect
            users={users}
            value={toEntries.map((e) => e.toUser)}
            onChange={setToUsers}
            exclude={excludeForTo}
            disabled={disabled}
            aria-label="To recipients"
            placeholder="Add recipients…"
            activeValue={activeToUser}
            onActiveChange={(name) => setActiveToUser(name || null)}
            renderBadgeExtra={(name) => {
              const entry = toEntries.find((e) => e.toUser === name)
              if (!entry) return null
              const label =
                TO_ACTIONS.find((a) => a.value === entry.action)?.label ?? entry.action
              return (
                <span className="rounded bg-white/70 px-1 py-px text-[10px] font-semibold text-slate-600">
                  {label}
                </span>
              )
            }}
          />
          {toEntries.length > 0 && !activeEntry ? (
            <p className="mt-1.5 text-[11px] text-slate-500">
              Click a recipient badge to set their action and optional To-specific message.
            </p>
          ) : null}
          {activeEntry ? (
            <div className="mt-2 rounded-md border border-sky-200 bg-sky-50/60 px-2.5 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-800">{activeEntry.toUser}</span>
                <AppSelect
                  value={activeEntry.action}
                  onValueChange={(v) =>
                    updateToEntry(activeEntry.toUser, {
                      action: v as MarkingAction,
                      responseType:
                        v === 'response_required' ? activeEntry.responseType || 'comments' : '',
                    })
                  }
                  options={TO_ACTIONS.map((a) => ({ value: a.value, label: a.label }))}
                  size="sm"
                  className="min-w-[10rem]"
                  aria-label={`Action for ${activeEntry.toUser}`}
                />
                {activeEntry.action === 'response_required' && (
                  <>
                    <AppSelect
                      value={activeEntry.responseType || ''}
                      onValueChange={(v) =>
                        updateToEntry(activeEntry.toUser, { responseType: v as ResponseType })
                      }
                      options={RESPONSE_TYPES.map((t) => ({
                        value: t,
                        label: RESPONSE_TYPE_LABELS[t],
                      }))}
                      size="sm"
                      placeholder="Response type"
                      className="min-w-[9rem]"
                    />
                    <input
                      type="date"
                      value={activeEntry.dueAt}
                      onChange={(e) =>
                        updateToEntry(activeEntry.toUser, { dueAt: e.target.value })
                      }
                      className="h-7 rounded border border-slate-200 px-2 text-xs"
                    />
                    {activeEntry.responseType === 'other' && (
                      <input
                        type="text"
                        value={activeEntry.responseTypeOther}
                        onChange={(e) =>
                          updateToEntry(activeEntry.toUser, {
                            responseTypeOther: e.target.value,
                          })
                        }
                        placeholder="Specify…"
                        className="h-7 min-w-[8rem] flex-1 rounded border border-slate-200 px-2 text-xs"
                      />
                    )}
                  </>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-slate-500">
                  Optional message &amp; attachments for {activeEntry.toUser}.
                </p>
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    className="size-3.5 rounded border-slate-300"
                    checked={perToPrivate[activeEntry.toUser] ?? false}
                    disabled={disabled}
                    onChange={(e) => void setSendPrivately(activeEntry.toUser, e.target.checked)}
                  />
                  Send Privately
                </label>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                {(perToPrivate[activeEntry.toUser] ?? false)
                  ? 'Only this recipient will see this message and its attachments.'
                  : 'All recipients on this mark (including Info) can see this message and its attachments.'}
              </p>
              <textarea
                value={perToBodies[activeEntry.toUser] ?? ''}
                onChange={(e) =>
                  setPerToBodies((prev) => ({
                    ...prev,
                    [activeEntry.toUser]: e.target.value,
                  }))
                }
                disabled={disabled}
                rows={3}
                placeholder={`Message for ${activeEntry.toUser}…`}
                className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-sm"
              />
              <AttachmentStrip
                attachments={attsForTarget(drafts?.attachments ?? [], activeEntry.toUser)}
                defaultKind={defaultKind}
                onKindChange={setDefaultKind}
                busy={busyAttach || disabled}
                onPickFiles={(files) => void uploadFiles(activeEntry.toUser, files)}
                onRemove={(id) => void removeAttachment(id)}
              />
            </div>
          ) : null}
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600">Info</label>
          <UserMultiSelect
            users={users}
            value={infoUsers}
            onChange={(names) => {
              setInfoUsers(names)
              setToEntries((prev) => {
                const next = prev.filter((e) => !names.includes(e.toUser))
                setActiveToUser((cur) => {
                  if (cur && names.includes(cur)) return next[0]?.toUser ?? null
                  if (cur && next.some((e) => e.toUser === cur)) return cur
                  return next[0]?.toUser ?? null
                })
                return next
              })
            }}
            exclude={excludeForInfo}
            disabled={disabled}
            aria-label="Info recipients"
            placeholder="Add info-only users…"
          />
          <p className="mt-1 text-[11px] text-slate-500">
            Info recipients receive the common comment/attachments with action For Information.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600">
            Common comment (all recipients)
          </label>
          <textarea
            value={commonBody}
            onChange={(e) => setCommonBody(e.target.value)}
            disabled={disabled}
            rows={4}
            placeholder="Message shared with every To and Info recipient…"
            className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-sm"
          />
          <AttachmentStrip
            attachments={commonAtts}
            defaultKind={defaultKind}
            onKindChange={setDefaultKind}
            busy={busyAttach || disabled}
            onPickFiles={(files) => void uploadFiles('', files)}
            onRemove={(id) => void removeAttachment(id)}
            caption="Common attachments — visible to all recipients on this mark."
          />
        </div>
      </div>
    </section>
  )
})

function AttachmentStrip({
  attachments,
  defaultKind,
  onKindChange,
  busy,
  onPickFiles,
  onRemove,
  caption,
}: {
  attachments: DraftAttachment[]
  defaultKind: AttachmentKind
  onKindChange: (k: AttachmentKind) => void
  busy: boolean
  onPickFiles: (files: FileList | null) => void
  onRemove: (id: number) => void
  caption?: string
}) {
  return (
    <div className="mt-2">
      {caption ? <p className="mb-1 text-[11px] text-slate-500">{caption}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <AppSelect
          value={defaultKind}
          onValueChange={(v) => onKindChange(v as AttachmentKind)}
          options={ATTACHMENT_KINDS.map((k) => k)}
          size="sm"
          className="min-w-[8rem]"
          disabled={busy}
        />
        <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
          <Paperclip className="h-3.5 w-3.5" />
          Attach
          <input
            type="file"
            multiple
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              onPickFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </label>
      </div>
      {attachments.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-2 rounded border border-slate-100 bg-white px-2 py-1 text-xs text-slate-700"
            >
              <Paperclip className="h-3 w-3 shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1 truncate">
                {a.originalFilename || 'Attachment'}
                <span className="text-slate-400"> · {a.attachmentKind}</span>
              </span>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                disabled={busy}
                aria-label="Remove attachment"
                onClick={() => onRemove(a.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
