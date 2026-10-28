/** Shared catalogs for simple marking workflow (spec 01). */

export const MARKING_ACTIONS = ['forward', 'for_info', 'response_required'] as const
export type MarkingAction = (typeof MARKING_ACTIONS)[number]

export const RESPONSE_TYPES = [
  'draft_letter',
  'presentation',
  'nominations',
  'comments',
  'other',
] as const
export type ResponseType = (typeof RESPONSE_TYPES)[number]

export const ATTACHMENT_KINDS = [
  'Presentation',
  'Draft Response',
  'Supporting Doc',
  'Nomination List',
  'Other',
] as const
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number]

export const MARKING_STATUSES = ['active', 'responded', 'revoked', 'superseded', 'rejected'] as const
export type MarkingStatus = (typeof MARKING_STATUSES)[number]

export const LETTER_LIFECYCLE_STATUSES = ['Open', 'Closed', 'Archived'] as const
export type LetterLifecycleStatus = (typeof LETTER_LIFECYCLE_STATUSES)[number]

export const ACTION_LABELS: Record<MarkingAction, string> = {
  forward: 'Forward',
  for_info: 'For Information',
  response_required: 'Response Required',
}

export const RESPONSE_TYPE_LABELS: Record<ResponseType, string> = {
  draft_letter: 'Draft letter',
  presentation: 'Presentation',
  nominations: 'Nominations',
  comments: 'Comments',
  other: 'Other',
}
