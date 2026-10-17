# Spec 03 — Inputs and Attachments

## A. Purpose

Let any current holder add dated/IP-stamped inputs (notes) and, separately, multiple typed file attachments on their **marking incident** (not per note), and define how `response_required` markings are fulfilled.

## B. Preconditions

- Specs 01–02 in place.
- Actor holds the letter; letter is `Open`; actor not Viewer.
- File upload limits/types reuse existing storage validation.

## C. Inputs

### Create note

| Field | Required | Notes |
|-------|----------|-------|
| `bodyText` | yes | Non-empty |
| `markingId` | no | Context; required when `isResponse=true` |
| `isResponse` | no | Default false; true = fulfill RR |

### Add attachments (separate from notes)

Linked to the actor’s current hold marking (`markingId` optional when they hold exactly one leaf).

| Field | Required | Notes |
|-------|----------|-------|
| `markingId` | no | Resolved to current hold when omitted |
| `attachments[]` | yes | `{ attachmentKind, documentId?, originalFilename? }` |

### Attachment kinds (v1)

`Presentation` | `Draft Response` | `Supporting Doc` | `Nomination List` | `Other`

## D. Processing

### D.1 Add note

1. Assert holder + Open + access.
2. Resolve `marking_id` to current hold (or provided id).
3. Persist `CorrespondenceNote` with `created_at`, `client_ip` (no files on the note).
4. Audit + optional pathway notify (spec 05).

### D.2 Add attachments

1. Assert holder + Open + access.
2. Resolve `marking_id` to current hold.
3. For each file: store via existing document storage; create `CorrespondenceAttachment` with `letter_id`, `marking_id`, `created_by`, kind + stamps (`note_id` null).
4. Editable only while the uploader still holds; locked after they mark onward.

### D.3 Fulfill Response Required

When `isResponse=true`:

1. `markingId` required; marking must be `active`, `action=response_required`, `to_user=actor`.
2. Note body required; files (if any) are added via D.2 against the same marking.
3. Set marking `status=responded`, `responded_at`, `response_note_id`.
4. Notify original `from_user` (and pathway subscribers).
5. Marker’s batch tracker updates (spec 04).

**Non-fulfillment:** Creating a normal note or marking onward does **not** auto-fulfill RR.

### D.4 Visibility

All notes/attachments on a letter are visible to users with letter access (spec 06), ordered by `created_at`, grouped by marking incident in the UI.

## E. Outputs

- Note metadata JSON (no nested attachments).
- Attachment metadata JSON (`markingId`, `editable`).
- Updated marking when fulfilling RR.

## F. Components

| Component | Action |
|-----------|--------|
| `marking_workflow_service.py` | `add_note`, `add_attachments_to_marking`, `list_attachments` |
| Storage / documents service | Reuse upload |
| `routers/markings.py` | Endpoints |

## G. Data model

`cms_correspondence_notes`, `cms_correspondence_attachments` (spec 01).

## H. API contract

- `POST /api/markings/letters/{letter_id}/notes`
- `GET /api/markings/letters/{letter_id}/notes`
- `POST /api/markings/letters/{letter_id}/attachments`
- `GET /api/markings/letters/{letter_id}/attachments`
- `POST /api/markings/{marking_id}/respond` (optional alias that sets `isResponse`)

## I. Acceptance

- [x] Holder can add notes and, separately, multiple typed attachments on the marking incident; each stamped with time + IP.
- [x] Attachments are not tied to individual notes (`note_id` null on new rows).
- [ ] Non-holder cannot add notes/attachments (403).
- [ ] RR fulfill transitions marking to `responded` and notifies marker.
- [ ] Forward without respond leaves RR `active`.
- [x] After marking onward, uploader’s attachments become read-only.
