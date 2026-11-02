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
import { Eye, EyeOff, Paperclip, Reply, Send, Trash2 } from 'lucide-react'
import { AppSelect } from '@/components/ui/app-select'
import { Button } from '@/components/ui/button'
import { RichTextEditor } from '@/components/cms/rich-text-editor'
import { RichTextHtml } from '@/components/cms/rich-text-html'
import { Badge } from '@/components/cms/ui'
import { UserMultiSelect } from '@/components/cms/user-multi-select'
import { cn } from '@/lib/utils'
import { isRichTextEmpty } from '@/lib/rich-text'
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

export type DraftCommentPreviewAttachment = {
  id: number
  originalFilename: string
  attachmentKind: string
  targetUser: string
  sendPrivately: boolean
}

export type DraftCommentPreviewData = {
  authorUser: string
  recipients: { toUser: string; action: string }[]
  commonHtml: string
  targeted: { toUser: string; html: string; sendPrivately: boolean }[]
  attachments: DraftCommentPreviewAttachment[]
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
  /** Reply locks To to the immediate sender and shows Send at the card footer. */
  mode?: 'forward' | 'reply'
  lockedToUser?: string | null
  onCancelReply?: () => void
  previewActive?: boolean
  onPreviewChange?: (preview: DraftCommentPreviewData | null) => void
  onMarkAvailabilityChange?: (state: { canMark: boolean; busy: boolean }) => void
  onRequestMark: (recipients: MarkRecipientInput[]) => void
  /** Reply Send — same recipient payload as Mark, parent submits with direction=reply. */
  onRequestSend?: (recipients: MarkRecipientInput[]) => void
}

const TO_ACTIONS: { value: MarkingAction; label: string }[] = [
  { value: 'forward', label: 'Forward' },
  { value: 'response_required', label: 'Response Required' },
]

function normalizeDraftHtml(html: string | null | undefined) {
  return isRichTextEmpty(html) ? '' : html || ''
}

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
    mode = 'forward',
    lockedToUser = null,
    onCancelReply,
    previewActive = false,
    onPreviewChange,
    onMarkAvailabilityChange,
    onRequestMark,
    onRequestSend,
  },
  ref,
) {
  const isReplyMode = mode === 'reply'
  const lockedTo = (lockedToUser || '').trim()
  // Seed from drafts on first paint so TipTap never mounts empty then wipes a saved note.
  const seeded = useMemo(() => {
    if (!drafts) {
      return {
        to: [] as ToEntry[],
        info: [] as string[],
        commonHtml: '',
        commonId: null as number | null,
        bodies: {} as Record<string, string>,
        privateFlags: {} as Record<string, boolean>,
        ids: {} as Record<string, number | null>,
        savedPerTo: {} as Record<string, string>,
      }
    }
    const { to, info } = rosterToEntries(drafts)
    const commonNote = noteForTarget(drafts.notes, '')
    const bodies: Record<string, string> = {}
    const privateFlags: Record<string, boolean> = {}
    const ids: Record<string, number | null> = {}
    const savedPerTo: Record<string, string> = {}
    for (const entry of to) {
      const n = noteForTarget(drafts.notes, entry.toUser)
      const att = attsForTarget(drafts.attachments, entry.toUser)[0]
      const body = n?.bodyText ?? ''
      bodies[entry.toUser] = body
      savedPerTo[entry.toUser] = normalizeDraftHtml(body)
      ids[entry.toUser] = n?.id ?? null
      privateFlags[entry.toUser] = Boolean(n?.sendPrivately ?? att?.sendPrivately)
    }
    return {
      to,
      info,
      commonHtml: commonNote?.bodyText ?? '',
      commonId: commonNote?.id ?? null,
      bodies,
      privateFlags,
      ids,
      savedPerTo,
    }
  }, [drafts])

  const [toEntries, setToEntries] = useState<ToEntry[]>(() => seeded.to)
  const [infoUsers, setInfoUsers] = useState<string[]>(() => seeded.info)
  const [activeToUser, setActiveToUser] = useState<string | null>(() => seeded.to[0]?.toUser ?? null)
  const [commonBody, setCommonBody] = useState(() => seeded.commonHtml)
  const [perToBodies, setPerToBodies] = useState<Record<string, string>>(() => seeded.bodies)
  /** Send Privately per To recipient — default off (visible to all mark recipients). */
  const [perToPrivate, setPerToPrivate] = useState<Record<string, boolean>>(() => seeded.privateFlags)
  const [defaultKind, setDefaultKind] = useState<AttachmentKind>('Supporting Doc')
  const [busyAttach, setBusyAttach] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [hydrated, setHydrated] = useState(() => Boolean(drafts))

  const rosterTimer = useRef<number | null>(null)
  const commonTimer = useRef<number | null>(null)
  const perToTimers = useRef<Record<string, number>>({})
  const commonNoteIdRef = useRef<number | null>(seeded.commonId)
  const perToNoteIdsRef = useRef<Record<string, number | null>>(seeded.ids)
  const skipRosterSave = useRef(true)
  const hydratedLetterRef = useRef<string | null>(drafts ? letterId : null)
  const savingContentRef = useRef(false)
  const onDraftsChangeRef = useRef(onDraftsChange)
  const disabledRef = useRef(disabled)
  const commonBodyRef = useRef(seeded.commonHtml)
  const perToBodiesRef = useRef(seeded.bodies)
  const perToPrivateRef = useRef(seeded.privateFlags)
  const toEntriesRef = useRef(seeded.to)
  const infoUsersRef = useRef(seeded.info)
  /** Last successfully persisted common HTML ('' = empty). null until hydrated. */
  const lastSavedCommonRef = useRef<string | null>(
    drafts ? normalizeDraftHtml(seeded.commonHtml) : null,
  )
  const lastSavedPerToRef = useRef<Record<string, string>>(seeded.savedPerTo)
  /** True only after the user edits the field — blocks hydrate/unmount empty-deletes. */
  const userEditedCommonRef = useRef(false)
  const userEditedPerToRef = useRef<Record<string, boolean>>({})
  /** Ignore TipTap empty flashes right after hydrate/mount. */
  const ignoreEmptyUntilRef = useRef(Date.now() + 1000)
  const persistCommonBodyRef = useRef<
    (html: string, opts?: { allowDelete?: boolean }) => Promise<void>
  >(async () => {})
  const persistPerToBodyRef = useRef<
    (user: string, html: string, opts?: { allowDelete?: boolean }) => Promise<void>
  >(async () => {})
  const persistRosterRef = useRef<() => Promise<void>>(async () => {})

  onDraftsChangeRef.current = onDraftsChange
  disabledRef.current = disabled
  commonBodyRef.current = commonBody
  perToBodiesRef.current = perToBodies
  perToPrivateRef.current = perToPrivate
  toEntriesRef.current = toEntries
  infoUsersRef.current = infoUsers

  const applyHydration = useCallback((source: MarkingDrafts) => {
    const { to, info } = rosterToEntries(source)
    const commonNote = noteForTarget(source.notes, '')
    const bodies: Record<string, string> = {}
    const privateFlags: Record<string, boolean> = {}
    const ids: Record<string, number | null> = {}
    const savedPerTo: Record<string, string> = {}
    for (const entry of to) {
      const n = noteForTarget(source.notes, entry.toUser)
      const att = attsForTarget(source.attachments, entry.toUser)[0]
      const body = n?.bodyText ?? ''
      bodies[entry.toUser] = body
      savedPerTo[entry.toUser] = normalizeDraftHtml(body)
      ids[entry.toUser] = n?.id ?? null
      privateFlags[entry.toUser] = Boolean(n?.sendPrivately ?? att?.sendPrivately)
    }
    const commonHtml = commonNote?.bodyText ?? ''
    skipRosterSave.current = true
    userEditedCommonRef.current = false
    userEditedPerToRef.current = {}
    ignoreEmptyUntilRef.current = Date.now() + 1000
    // Keep refs in sync immediately — state updates are async and unmount can race them.
    commonBodyRef.current = commonHtml
    perToBodiesRef.current = bodies
    toEntriesRef.current = to
    infoUsersRef.current = info
    setToEntries(to)
    setInfoUsers(info)
    setActiveToUser(to[0]?.toUser ?? null)
    setCommonBody(commonHtml)
    setPerToBodies(bodies)
    setPerToPrivate(privateFlags)
    commonNoteIdRef.current = commonNote?.id ?? null
    perToNoteIdsRef.current = ids
    lastSavedCommonRef.current = normalizeDraftHtml(commonHtml)
    lastSavedPerToRef.current = savedPerTo
    setHydrated(true)
    window.setTimeout(() => {
      skipRosterSave.current = false
    }, 50)
  }, [])

  // Hydrate once per letter from server drafts (avoid re-seeding after our own autosaves).
  useEffect(() => {
    if (!drafts) return
    if (hydratedLetterRef.current === letterId) {
      // State was seeded synchronously from drafts — only lift the roster-save gate.
      const t = window.setTimeout(() => {
        skipRosterSave.current = false
      }, 50)
      return () => window.clearTimeout(t)
    }
    hydratedLetterRef.current = letterId
    applyHydration(drafts)
  }, [applyHydration, drafts, letterId])

  // Reply: lock To to the immediate sender (immutable) and clear Info.
  useEffect(() => {
    if (!isReplyMode || !lockedTo) return
    skipRosterSave.current = true
    setToEntries((prev) => {
      const existing = prev.find((e) => e.toUser === lockedTo)
      return [
        {
          toUser: lockedTo,
          action: existing?.action === 'response_required' ? 'response_required' : 'forward',
          responseType: existing?.responseType || '',
          responseTypeOther: existing?.responseTypeOther || '',
          dueAt: existing?.dueAt || '',
        },
      ]
    })
    setInfoUsers([])
    setActiveToUser(lockedTo)
    window.setTimeout(() => {
      skipRosterSave.current = false
    }, 50)
  }, [isReplyMode, lockedTo])

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
      lastSavedCommonRef.current = ''
      lastSavedPerToRef.current = {}
    }
  }, [drafts, infoUsers.length, letterId, toEntries.length])

  const buildRosterPayload = useCallback((): DraftRosterRecipientInput[] => {
    const entries = toEntriesRef.current
    const infos = infoUsersRef.current
    const rows: DraftRosterRecipientInput[] = entries.map((e) => ({
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
    for (const name of infos) {
      rows.push({ toUser: name, role: 'info', action: 'for_info', track: true, remindersEnabled: true })
    }
    return rows
  }, [])

  const persistRoster = useCallback(async () => {
    if (skipRosterSave.current || disabledRef.current) return
    try {
      const result = await putDraftRoster(letterId, buildRosterPayload())
      onDraftsChangeRef.current(result.drafts)
      setSaveError('')
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save recipients')
    }
  }, [buildRosterPayload, letterId])

  const persistCommonBody = useCallback(
    async (html: string, opts?: { allowDelete?: boolean }) => {
      if (disabledRef.current) return
      const normalized = normalizeDraftHtml(html)
      if (lastSavedCommonRef.current !== null && lastSavedCommonRef.current === normalized) {
        return
      }
      const existingId = commonNoteIdRef.current
      savingContentRef.current = true
      try {
        if (!normalized) {
          // Never delete during TipTap mount/hydrate flashes — only after a real user clear.
          if (
            !opts?.allowDelete ||
            existingId == null ||
            Date.now() < ignoreEmptyUntilRef.current
          ) {
            return
          }
          const result = await deleteDraftNote(existingId)
          commonNoteIdRef.current = null
          lastSavedCommonRef.current = ''
          onDraftsChangeRef.current(result.drafts)
          return
        }
        if (existingId != null) {
          const result = await updateDraftNote(existingId, normalized)
          onDraftsChangeRef.current(result.drafts)
        } else {
          const result = await addDraftNote(letterId, {
            bodyText: normalized,
            targetUser: '',
            intent: 'forward',
          })
          commonNoteIdRef.current = result.note.id
          onDraftsChangeRef.current(result.drafts)
        }
        lastSavedCommonRef.current = normalized
        setSaveError('')
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Failed to save common comment')
      } finally {
        savingContentRef.current = false
      }
    },
    [letterId],
  )

  const persistPerToBody = useCallback(
    async (user: string, html: string, opts?: { allowDelete?: boolean }) => {
      if (disabledRef.current) return
      const normalized = normalizeDraftHtml(html)
      if ((lastSavedPerToRef.current[user] ?? '') === normalized) {
        return
      }
      const existingId = perToNoteIdsRef.current[user] ?? null
      savingContentRef.current = true
      try {
        if (!normalized) {
          if (
            !opts?.allowDelete ||
            existingId == null ||
            Date.now() < ignoreEmptyUntilRef.current
          ) {
            return
          }
          const result = await deleteDraftNote(existingId)
          perToNoteIdsRef.current[user] = null
          lastSavedPerToRef.current[user] = ''
          onDraftsChangeRef.current(result.drafts)
          return
        }
        if (existingId != null) {
          const result = await updateDraftNote(existingId, normalized)
          onDraftsChangeRef.current(result.drafts)
        } else {
          const result = await addDraftNote(letterId, {
            bodyText: normalized,
            targetUser: user,
            intent: 'forward',
            sendPrivately: perToPrivateRef.current[user] ?? false,
          })
          perToNoteIdsRef.current[user] = result.note.id
          onDraftsChangeRef.current(result.drafts)
        }
        lastSavedPerToRef.current[user] = normalized
        setSaveError('')
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Failed to save comment')
      } finally {
        savingContentRef.current = false
      }
    },
    [letterId],
  )

  const handleCommonChange = useCallback((html: string) => {
    const empty = isRichTextEmpty(html)
    // TipTap often emits an empty update while applying hydrated content — ignore it.
    if (empty && Date.now() < ignoreEmptyUntilRef.current) return
    if (empty && !isRichTextEmpty(commonBodyRef.current) && !userEditedCommonRef.current) {
      return
    }
    userEditedCommonRef.current = true
    commonBodyRef.current = html
    setCommonBody(html)
  }, [])

  const handlePerToChange = useCallback((user: string, html: string) => {
    const empty = isRichTextEmpty(html)
    const prev = perToBodiesRef.current[user] ?? ''
    if (empty && Date.now() < ignoreEmptyUntilRef.current) return
    if (empty && !isRichTextEmpty(prev) && !userEditedPerToRef.current[user]) return
    userEditedPerToRef.current[user] = true
    perToBodiesRef.current = { ...perToBodiesRef.current, [user]: html }
    setPerToBodies((p) => ({ ...p, [user]: html }))
  }, [])

  persistCommonBodyRef.current = persistCommonBody
  persistPerToBodyRef.current = persistPerToBody
  persistRosterRef.current = persistRoster

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

  useEffect(() => {
    if (!hydrated) return
    if (commonTimer.current != null) window.clearTimeout(commonTimer.current)
    commonTimer.current = window.setTimeout(() => {
      void persistCommonBody(commonBody, { allowDelete: userEditedCommonRef.current })
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
        void persistPerToBody(user, text, {
          allowDelete: Boolean(userEditedPerToRef.current[user]),
        })
      }, 400)
    }
    return () => {
      for (const t of Object.values(perToTimers.current)) window.clearTimeout(t)
    }
  }, [hydrated, perToBodies, persistPerToBody, toEntries])

  // Flush pending draft writes when leaving Workflow (panel unmounts on tab switch).
  // Never delete on flush — empty body here is often a hydrate/unmount race, not a user clear.
  useEffect(() => {
    return () => {
      if (rosterTimer.current != null) {
        window.clearTimeout(rosterTimer.current)
        rosterTimer.current = null
      }
      if (commonTimer.current != null) {
        window.clearTimeout(commonTimer.current)
        commonTimer.current = null
      }
      for (const key of Object.keys(perToTimers.current)) {
        const t = perToTimers.current[key]
        if (t != null) window.clearTimeout(t)
      }
      perToTimers.current = {}

      void persistRosterRef.current()
      const commonHtml = normalizeDraftHtml(commonBodyRef.current)
      if (commonHtml) void persistCommonBodyRef.current(commonHtml, { allowDelete: false })
      for (const [user, html] of Object.entries(perToBodiesRef.current)) {
        const text = normalizeDraftHtml(html)
        if (text) void persistPerToBodyRef.current(user, text, { allowDelete: false })
      }
    }
  }, [])

  const setToUsers = (names: string[]) => {
    if (isReplyMode) return
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

  const buildPreview = useCallback((): DraftCommentPreviewData => {
    const recipients: DraftCommentPreviewData['recipients'] = [
      ...toEntries.map((e) => ({ toUser: e.toUser, action: e.action })),
      ...infoUsers.map((name) => ({ toUser: name, action: 'for_info' })),
    ]
    const targeted = toEntries
      .map((e) => ({
        toUser: e.toUser,
        html: perToBodies[e.toUser] ?? '',
        sendPrivately: perToPrivate[e.toUser] ?? false,
      }))
      .filter((row) => !isRichTextEmpty(row.html))
    const attachments: DraftCommentPreviewAttachment[] = (drafts?.attachments ?? [])
      .filter((a) => (a.intent || 'forward').toLowerCase() === 'forward')
      .map((a) => ({
        id: a.id,
        originalFilename: a.originalFilename || a.storageKey || 'File',
        attachmentKind: a.attachmentKind,
        targetUser: a.targetUser || '',
        sendPrivately: Boolean(a.sendPrivately),
      }))
    return {
      authorUser: meName,
      recipients,
      commonHtml: commonBody,
      targeted,
      attachments,
    }
  }, [commonBody, drafts?.attachments, infoUsers, meName, perToBodies, perToPrivate, toEntries])

  const canPreview =
    toEntries.length > 0 ||
    infoUsers.length > 0 ||
    !isRichTextEmpty(commonBody) ||
    Object.values(perToBodies).some((html) => !isRichTextEmpty(html)) ||
    (drafts?.attachments.some((a) => (a.intent || 'forward').toLowerCase() === 'forward') ??
      false)

  useEffect(() => {
    if (!previewActive || !onPreviewChange) return
    onPreviewChange(buildPreview())
  }, [buildPreview, onPreviewChange, previewActive])

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

  const canSendReply =
    Boolean(lockedTo) && !disabled && !busyAttach && !isRichTextEmpty(commonBody)

  const handleSendClick = useCallback(() => {
    if (!onRequestSend) return
    if (!lockedTo) {
      setSaveError('Reply recipient is not set')
      return
    }
    if (isRichTextEmpty(commonBody)) {
      setSaveError('Reply comment is required')
      return
    }
    setSaveError('')
    // Reply: locked immediate sender only — no Mark actions / Info / per-recipient extras.
    onRequestSend([
      {
        toUser: lockedTo,
        action: 'forward',
        track: true,
        remindersEnabled: false,
      },
    ])
  }, [commonBody, lockedTo, onRequestSend])

  useImperativeHandle(ref, () => ({ requestMark: handleMarkClick }), [handleMarkClick])

  useEffect(() => {
    onMarkAvailabilityChange?.({ canMark, busy: busyAttach })
  }, [busyAttach, canMark, onMarkAvailabilityChange])

  return (
    <section
      className={cn(
        'mb-5 rounded-lg border bg-white shadow-sm',
        isReplyMode ? 'border-violet-300 ring-1 ring-violet-200' : 'border-slate-200',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5 sm:px-4">
        <div>
          <h2 className="text-sm font-bold text-slate-700">My Draft Comments</h2>
          <p className="text-[11px] text-slate-400">
            {isReplyMode
              ? 'Replying to the immediate sender — write a reply comment, then Send.'
              : 'Choose recipients, compose comments, then Mark to send.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isReplyMode && onCancelReply ? (
            <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={onCancelReply}>
              Cancel Reply
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canPreview || disabled}
            aria-pressed={previewActive}
            onClick={() => {
              if (previewActive) onPreviewChange?.(null)
              else onPreviewChange?.(buildPreview())
            }}
          >
            {previewActive ? (
              <EyeOff className="mr-1 h-3.5 w-3.5" />
            ) : (
              <Eye className="mr-1 h-3.5 w-3.5" />
            )}
            {previewActive ? 'Hide Preview' : 'Preview Comments'}
          </Button>
          {!hideMarkButton && !isReplyMode ? (
            <Button size="sm" disabled={!canMark || busyAttach} onClick={handleMarkClick}>
              <Send className="mr-1 h-3.5 w-3.5" />
              Mark
            </Button>
          ) : null}
        </div>
      </div>

      <div className="space-y-4 p-3 sm:p-4">
        {saveError ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
            {saveError}
          </p>
        ) : null}

        <div>
          <label className="mb-1.5 block">
            <Badge tone={isReplyMode ? 'violet' : 'blue'} className="text-sm px-2.5 py-1">
              To
            </Badge>
          </label>
          {isReplyMode ? (
            <div
              className="flex flex-wrap items-center gap-2 rounded-md border border-violet-200 bg-violet-50/80 px-3 py-2 text-sm text-slate-800"
              aria-label="Reply recipient (locked)"
            >
              <span className="font-semibold">{lockedTo || '—'}</span>
              <Badge tone="violet">Locked · immediate sender</Badge>
            </div>
          ) : (
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
          )}
          {!isReplyMode && toEntries.length > 0 && !activeEntry ? (
            <p className="mt-1.5 text-[11px] text-slate-500">
              Click a recipient badge to set their action and optional To-specific message.
            </p>
          ) : null}
          {!isReplyMode && activeEntry ? (
            <div className="mt-2 rounded-md border border-sky-200 bg-sky-50/60 px-2.5 py-2 dark:border-sky-800/60 dark:bg-sky-950/50">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-800 dark:text-white">
                  {activeEntry.toUser}
                </span>
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
                      className="h-7 rounded border border-slate-200 bg-white px-2 text-xs text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
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
                        className="h-7 min-w-[8rem] flex-1 rounded border border-slate-200 bg-white px-2 text-xs text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                      />
                    )}
                  </>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Optional message &amp; attachments for {activeEntry.toUser}.
                </p>
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    className="size-3.5 rounded border-slate-300 dark:border-slate-500"
                    checked={perToPrivate[activeEntry.toUser] ?? false}
                    disabled={disabled}
                    onChange={(e) => void setSendPrivately(activeEntry.toUser, e.target.checked)}
                  />
                  Send Privately
                </label>
              </div>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                {(perToPrivate[activeEntry.toUser] ?? false)
                  ? 'Only this recipient will see this message and its attachments.'
                  : 'All recipients on this mark (including Info) can see this message and its attachments.'}
              </p>
              <RichTextEditor
                key={`to-${activeEntry.toUser}`}
                className="mt-1"
                value={perToBodies[activeEntry.toUser] ?? ''}
                onChange={(html) => handlePerToChange(activeEntry.toUser, html)}
                disabled={disabled}
                placeholder={`Message for ${activeEntry.toUser}…`}
                aria-label={`Message for ${activeEntry.toUser}`}
                minHeightClass="min-h-[5.5rem]"
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

        {!isReplyMode ? (
          <div>
            <label className="mb-1.5 block">
              <Badge tone="violet" className="text-sm px-2.5 py-1">
                Info
              </Badge>
            </label>
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
        ) : null}

        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600">
            {isReplyMode ? 'Reply comment (required)' : 'Common comment (all recipients)'}
          </label>
          <RichTextEditor
            value={commonBody}
            onChange={handleCommonChange}
            disabled={disabled}
            placeholder={
              isReplyMode
                ? 'Write your reply to the immediate sender…'
                : 'Message shared with every To and Info recipient…'
            }
            aria-label={isReplyMode ? 'Reply comment' : 'Common comment for all recipients'}
            minHeightClass="min-h-[7rem]"
          />
          <AttachmentStrip
            attachments={commonAtts}
            defaultKind={defaultKind}
            onKindChange={setDefaultKind}
            busy={busyAttach || disabled}
            onPickFiles={(files) => void uploadFiles('', files)}
            onRemove={(id) => void removeAttachment(id)}
            caption={
              isReplyMode
                ? 'Optional attachments included with this reply.'
                : 'Common attachments — visible to all recipients on this mark.'
            }
          />
        </div>
      </div>

      {isReplyMode ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-violet-100 bg-violet-50/40 px-3 py-3 sm:px-4">
          {onCancelReply ? (
            <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={onCancelReply}>
              Cancel
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            disabled={!canSendReply}
            onClick={handleSendClick}
          >
            <Reply className="mr-1 h-3.5 w-3.5" />
            Send
          </Button>
        </div>
      ) : null}
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
        <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:text-white dark:hover:bg-slate-800 dark:hover:text-white">
          <Paperclip className="h-3.5 w-3.5 dark:text-white" />
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

/** Live preview of how draft comments will appear as a workflow comment card. */
export function DraftCommentsPreviewCard({
  preview,
  className,
}: {
  preview: DraftCommentPreviewData
  className?: string
}) {
  const toRecipients = preview.recipients.filter(
    (r) => (r.action || '').toLowerCase() !== 'for_info',
  )
  const infoRecipients = preview.recipients.filter(
    (r) => (r.action || '').toLowerCase() === 'for_info',
  )
  const showRoster = toRecipients.length > 0 || infoRecipients.length > 0
  const hasCommon = !isRichTextEmpty(preview.commonHtml)
  const commonAtts = preview.attachments.filter((a) => !a.targetUser)
  const recipientBadgeClass =
    'inline-flex items-center rounded-md border border-slate-300 bg-transparent px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:border-slate-500 dark:text-white'

  return (
    <li
      id="workflow-draft-preview"
      className={cn(
        'workflow-comment-card workflow-comment-card--own scroll-mt-24 list-none overflow-hidden rounded-lg border border-dashed border-emerald-300 bg-emerald-50 shadow-sm dark:border-emerald-600/70 dark:bg-emerald-950/40',
        className,
      )}
    >
      <div className="grid grid-cols-1 md:grid-cols-3">
        <div className="workflow-comment-card-main divide-y divide-emerald-200/70 px-4 py-1 md:col-span-2 md:border-r md:border-emerald-200/70 dark:divide-emerald-900/40 dark:md:border-transparent">
          <div className="pt-3 pb-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-base font-bold tracking-wide text-emerald-900 dark:text-emerald-300">
                {preview.authorUser || 'You'}
              </p>
              <span className="rounded-full bg-emerald-200/80 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-emerald-900">
                YOU
              </span>
              <Badge tone="amber" className="text-[10px] uppercase tracking-wide">
                Draft preview
              </Badge>
            </div>
            {showRoster ? (
              <div className="mt-1.5 space-y-1">
                {toRecipients.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="blue">To</Badge>
                    {toRecipients.map((r) => (
                      <span key={`preview-to-${r.toUser}`} className={recipientBadgeClass}>
                        {r.toUser}
                      </span>
                    ))}
                  </div>
                ) : null}
                {infoRecipients.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="violet">Info</Badge>
                    {infoRecipients.map((r) => (
                      <span key={`preview-info-${r.toUser}`} className={recipientBadgeClass}>
                        {r.toUser}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="py-1">
            {hasCommon ? (
              <div className="border-t border-emerald-100 py-2.5 first:border-t-0 dark:border-emerald-900/40">
                <RichTextHtml
                  html={preview.commonHtml}
                  className="text-emerald-950 dark:text-emerald-200"
                />
              </div>
            ) : null}

            {preview.targeted.map((section) => {
              const sectionAtts = preview.attachments.filter(
                (a) => a.targetUser === section.toUser,
              )
              const sectionPrivate =
                section.sendPrivately || sectionAtts.some((a) => a.sendPrivately)
              return (
                <div key={`preview-for-${section.toUser}`}>
                  <div className="flex flex-wrap items-center gap-2 pt-2.5">
                    <p className="text-sm font-bold text-emerald-950 underline underline-offset-2 dark:text-emerald-100">
                      For {section.toUser}
                    </p>
                    {sectionPrivate ? (
                      <span className="rounded bg-amber-100 px-1.5 py-px text-[10px] font-semibold text-amber-900">
                        Private
                      </span>
                    ) : null}
                  </div>
                  <div className="py-2.5">
                    <RichTextHtml
                      html={section.html}
                      className="text-emerald-950 dark:text-emerald-200"
                    />
                  </div>
                </div>
              )
            })}

            {!hasCommon && preview.targeted.length === 0 ? (
              <p className="py-3 text-xs text-emerald-800/70 dark:text-emerald-300/70">
                No comment text yet — add a common or To-specific message to preview it here.
              </p>
            ) : null}
          </div>
        </div>

        <div className="workflow-comment-card-aside border-t border-emerald-200/70 bg-emerald-100/50 px-3 py-3 md:col-span-1 md:border-t-0 dark:border-transparent dark:bg-emerald-950/60">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-emerald-800/80 dark:text-emerald-400/80">
            Attachments
          </p>
          {preview.attachments.length === 0 ? (
            <p className="text-xs text-slate-400">None</p>
          ) : (
            <ul className="space-y-2">
              {commonAtts.map((a) => (
                <li
                  key={`preview-att-${a.id}`}
                  className="relative rounded-lg border border-emerald-200/80 bg-white px-2.5 py-2 dark:border-emerald-800/50 dark:bg-emerald-950/30"
                >
                  <div className="flex items-start gap-2">
                    <Paperclip className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700/70 dark:text-emerald-300/80" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-emerald-950 dark:text-emerald-100">
                        {a.originalFilename}
                      </p>
                      <p className="mt-0.5 text-[10px] text-emerald-800/70 dark:text-emerald-400/80">
                        {a.attachmentKind}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
              {preview.targeted.map((section) => {
                const sectionAtts = preview.attachments.filter(
                  (a) => a.targetUser === section.toUser,
                )
                if (sectionAtts.length === 0) return null
                const sectionPrivate =
                  section.sendPrivately || sectionAtts.some((a) => a.sendPrivately)
                return (
                  <li key={`preview-att-for-${section.toUser}`} className="space-y-2">
                    <div className="flex flex-wrap items-center gap-1.5 pt-1 text-emerald-900 dark:text-emerald-200">
                      <span className="text-xs font-bold underline underline-offset-2">
                        For {section.toUser}
                      </span>
                      {sectionPrivate ? (
                        <span className="rounded bg-amber-100 px-1.5 py-px text-[10px] font-semibold text-amber-900">
                          Private
                        </span>
                      ) : null}
                    </div>
                    {sectionAtts.map((a) => (
                      <div
                        key={`preview-att-${a.id}`}
                        className="relative rounded-lg border border-emerald-200/80 bg-white px-2.5 py-2 dark:border-emerald-800/50 dark:bg-emerald-950/30"
                      >
                        <div className="flex items-start gap-2">
                          <Paperclip className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700/70 dark:text-emerald-300/80" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-semibold text-emerald-950 dark:text-emerald-100">
                              {a.originalFilename}
                            </p>
                            <p className="mt-0.5 text-[10px] text-emerald-800/70 dark:text-emerald-400/80">
                              {a.attachmentKind}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </li>
                )
              })}
              {/* Targeted attachments without a matching text section */}
              {preview.attachments
                .filter(
                  (a) =>
                    a.targetUser &&
                    !preview.targeted.some((t) => t.toUser === a.targetUser) &&
                    !commonAtts.includes(a),
                )
                .map((a) => (
                  <li key={`preview-att-orphan-${a.id}`} className="space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <span className="text-xs font-bold text-emerald-900 underline underline-offset-2 dark:text-emerald-200">
                        For {a.targetUser}
                      </span>
                      {a.sendPrivately ? (
                        <span className="rounded bg-amber-100 px-1.5 py-px text-[10px] font-semibold text-amber-900">
                          Private
                        </span>
                      ) : null}
                    </div>
                    <div className="relative rounded-lg border border-emerald-200/80 bg-white px-2.5 py-2 dark:border-emerald-800/50 dark:bg-emerald-950/30">
                      <div className="flex items-start gap-2">
                        <Paperclip className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700/70 dark:text-emerald-300/80" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-emerald-950 dark:text-emerald-100">
                            {a.originalFilename}
                          </p>
                          <p className="mt-0.5 text-[10px] text-emerald-800/70 dark:text-emerald-400/80">
                            {a.attachmentKind}
                          </p>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  )
}
