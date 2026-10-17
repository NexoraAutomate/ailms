# Spec 03 — Inputs and Attachments

## A. Purpose

Let any current holder add dated/IP-stamped inputs (notes) and multiple typed file attachments on a correspondence, and define how `response_required` markings are fulfilled.

## B. Preconditions

- Specs 01–02 in place.
- Actor holds the letter; letter is `Open`; actor not Viewer.
- File upload limits/types reuse existing storage validation.

## C. Inputs

### Create note (+ optional files)

`multipart/form-data` or JSON note then separate uploads:

| Field | Required | Notes |
|-------|----------|-------|
| `bodyText` | yes | Non-empty |
| `markingId` | no | Context; required when `isResponse=true` |
| `isResponse` | no | Default false; true = fulfill RR |
| `files[]` | no | Multiple |
| `attachmentKinds[]` | with files | Per-file kind from catalog |

### Attachment kinds (v1)

`Presentation` | `Draft Response` | `Supporting Doc` | `Nomination List` | `Other`

## D. Processing

### D.1 Add note

1. Assert holder + Open + access.
2. Persist `CorrespondenceNote` with `created_at`, `client_ip`.
3. For each file: store via existing document storage linked to letter; create `CorrespondenceAttachment` with kind + stamps.
4. Audit + optional pathway notify (spec 05).

### D.2 Fulfill Response Required

When `isResponse=true`:

1. `markingId` required; marking must be `active`, `action=response_required`, `to_user=actor`.
2. Note body required; attachments optional but recommended when `response_type` implies a file (e.g. presentation).
3. Set marking `status=responded`, `responded_at`, `response_note_id`.
4. Notify original `from_user` (and pathway subscribers).
5. Marker’s batch tracker updates (spec 04).

**Non-fulfillment:** Creating a normal note or marking onward does **not** auto-fulfill RR.

### D.3 Visibility

All notes/attachments on a letter are visible to users with letter access (spec 06), ordered by `created_at`.

## E. Outputs

- Note + attachment metadata JSON.
- Updated marking when fulfilling RR.

## F. Components

| Component | Action |
|-----------|--------|
| `marking_workflow_service.py` | `add_note`, `fulfill_response` |
| Storage / documents service | Reuse upload |
| `routers/markings.py` | Endpoints |

## G. Data model

`cms_correspondence_notes`, `cms_correspondence_attachments` (spec 01).

## H. API contract

- `POST /api/markings/letters/{letter_id}/notes`
- `GET /api/markings/letters/{letter_id}/notes`
- `POST /api/markings/{marking_id}/respond` (optional alias that sets `isResponse`)

## I. Acceptance

- [ ] Holder can add note with multiple typed attachments; each stamped with time + IP.
- [ ] Non-holder cannot add notes (403).
- [ ] RR fulfill transitions marking to `responded` and notifies marker.
- [ ] Forward without respond leaves RR `active`.
