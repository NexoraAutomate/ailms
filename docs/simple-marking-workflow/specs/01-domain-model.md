# Spec 01 — Domain Model

## A. Purpose

Define the canonical entities, statuses, and catalogs for the simple marking workflow so schema, API, and UI share one vocabulary.

## B. Preconditions

- Master plan accepted (`01-master-plan.md`).
- Existing `cms_letters`, `cms_users`, `cms_documents`, `cms_notifications`, `cms_audit_records`.

## C. Inputs

- Product defaults from master plan (actions, close rules, replace enterprise).

## D. Processing / definitions

### D.1 Letter fields (additions / semantics)

| Field | Type | Notes |
|-------|------|-------|
| `status` | string | v1 values: `Open`, `Closed`, `Archived` (plus migration of legacy → `Open`) |
| `created_by` | string | Initiator display name (existing) |
| `initiator_user_id` | int nullable FK | Prefer stable id when user row exists |
| `closed_at` | datetime nullable | Set on close |
| `closed_by` | string | Initiator name at close |
| `close_ip` | string | Client IP at close |

After register (manual or AI), set `status = Open`. Initiator is the initial **holder** (synthetic root; no marking required until first mark).

### D.2 MarkingBatch

One UI/API submit that creates N markings.

| Field | Notes |
|-------|-------|
| `id` | PK |
| `letter_id` | FK |
| `from_user` / `from_user_id` | Marker |
| `remarks` | Shared remarks for the batch (optional) |
| `created_at`, `client_ip` | Stamp |
| `pathway_notify` | bool — subscribe marker to pathway events for this batch |

### D.3 Marking

| Field | Notes |
|-------|-------|
| `id` | PK |
| `batch_id` | FK MarkingBatch |
| `letter_id` | FK (denormalized for queries) |
| `parent_marking_id` | nullable FK — edge that authorized this mark (null for marks from initiator root) |
| `from_user`, `to_user` | Required |
| `action` | `forward` \| `for_info` \| `response_required` |
| `response_type` | required if `response_required` |
| `response_type_other` | text if type = `other` |
| `instructions` | optional text |
| `due_at` | datetime/date — only for `response_required` |
| `priority` | string — default from letter or `Routine` |
| `track` | bool — default **true** |
| `reminders_enabled` | bool — default true when `response_required` and `track` |
| `status` | see D.4 |
| `created_at`, `client_ip` | Stamp |
| `revoked_at`, `revoked_by`, `revoke_ip` | Set on revoke |
| `responded_at` | Set when RR fulfilled |
| `response_note_id` | FK to note that fulfilled RR |

### D.4 Marking statuses

| Status | Meaning |
|--------|---------|
| `active` | Outstanding; recipient holds via this edge |
| `responded` | `response_required` fulfilled |
| `revoked` | Marker revoked before child remake |
| `superseded` | Optional: closed letter or replaced (v1: use sparingly) |

**Holder rule:** User holds letter if they are initiator and no active markings exist yet from the root, **or** they are `to_user` on at least one `active` marking. After a holder marks onward, they may still hold if other active markings still point to them (parallel channels).

Clarification for v1: marking onward does **not** auto-complete the parent's marking unless action was `response_required` and they explicitly submit response. `forward` / `for_info` stay `active` for history/inbox until revoked or letter closed (inbox may show “active received” until acknowledged — see spec 04 for tracker; inbox lists markings with `status=active` and `to_user=me`).

### D.5 CorrespondenceNote

| Field | Notes |
|-------|-------|
| `letter_id`, `author_user` | Required |
| `marking_id` | optional — context marking |
| `body_text` | Required non-empty |
| `created_at`, `client_ip` | Stamp |
| `is_response` | bool — true when submitted as RR fulfillment |

### D.6 CorrespondenceAttachment

| Field | Notes |
|-------|-------|
| `note_id` | FK |
| `document_id` | FK `cms_documents` (or storage key) |
| `attachment_kind` | Catalog below |
| `created_at`, `client_ip` | Stamp |

### D.7 MarkingSubscription

Pathway notify opt-in (may be derived from batch `pathway_notify` + marker user).

| Field | Notes |
|-------|-------|
| `letter_id`, `user` | Subscriber |
| `batch_id` or `root_marking_id` | Scope |
| `active` | bool |

### D.8 Catalogs

**Actions:** `forward`, `for_info`, `response_required`  
**Response types:** `draft_letter`, `presentation`, `nominations`, `comments`, `other`  
**Attachment kinds:** `Presentation`, `Draft Response`, `Supporting Doc`, `Nomination List`, `Other`  
**Priorities:** reuse letter priorities (`Routine`, `Urgent`, …)

## E. Outputs

- ORM models + migration DDL matching this spec.
- Shared TypeScript types mirroring catalogs.

## F. Components

| Component | Action |
|-----------|--------|
| `backend/app/models.py` | Add marking entities; letter close fields |
| `backend/app/db_upgrade.py` (or Alembic if used) | Schema upgrade |
| `frontend/services/markings.ts` | Types |

## G. Data model

See D.*; table names suggested:

- `cms_marking_batches`
- `cms_markings`
- `cms_correspondence_notes`
- `cms_correspondence_attachments`
- `cms_marking_subscriptions`

## H. API contract

None in this spec alone (see spec 06). Domain types must be stable for API payloads.

## I. Acceptance

- [ ] All catalogs documented and enforced in validation.
- [ ] Letter `Open`/`Closed`/`Archived` documented.
- [ ] Holder / initiator / marking status rules unambiguous for implementers.
- [ ] No dependency on enterprise `RouteStep` / `ApprovalStep` for new writes.
