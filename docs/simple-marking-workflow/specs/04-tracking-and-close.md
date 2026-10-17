# Spec 04 — Tracking and Close

## A. Purpose

Define per-marking **track** behavior, the marker’s **batch response tracker**, and **initiator close** rules.

## B. Preconditions

- Specs 01–03 available.
- Close only for initiator while they hold.

## C. Inputs

### Mark flags (from spec 02)

| Flag | Default | Effect |
|------|---------|--------|
| `track` | `true` | Include in marker’s tracking lists / reminders eligibility |
| `remindersEnabled` | `true` if RR + track | Schedule due reminders (spec 05) |
| `pathwayNotify` | per batch | Subscribe to pathway events |

### Close

```json
{ "remarks": "Matter disposed", "force": true }
```

`force` acknowledges soft warning when open RR remain.

## D. Processing

### D.1 Tracking list

For user U, **tracked markings** = markings where:

- `from_user = U`
- `track = true`
- `status = active` (and optionally recently `responded` for history)

UI sections:

1. **Awaiting response** — `action=response_required` and `status=active`
2. **Info / forward tracked** — other active tracked markings (lighter)

### D.2 Batch response tracker

For a `MarkingBatch` created by U:

- List each recipient marking.
- For `response_required`: show Pending vs Responded (+ due date, overdue flag).
- Exclusive to the marking user (and Admin): “have all responses been received?”

Aggregate: `pendingCount`, `respondedCount`, `allResponsesReceived`.

### D.3 Close

1. Actor must be initiator (`created_by` / `initiator_user_id`).
2. Actor must currently **hold** (initiator root before any active outward marks from others that removed sole hold — v1 rule: initiator holds if they are `to_user` on any active marking **or** there exists no active marking on the letter yet **or** an active marking was made back to initiator).
3. If any `response_required` markings on the letter are still `active`:
   - Without `force=true` → 400 with `{ "code": "OPEN_RESPONSES", "pending": [...] }`
   - With `force=true` → proceed (soft gate).
4. Set letter `status=Closed`, `closed_at`, `closed_by`, `close_ip`; optional remarks.
5. Optionally mark remaining active markings `superseded` (v1: yes, for inbox clarity).
6. Notify pathway subscribers + recent participants.
7. Audit close.

### D.4 Closed letter

Reject new marks, notes, responds, revokes (except Admin override out of scope).

## E. Outputs

- Tracker DTOs for UI.
- Closed letter serialization.

## F. Components

| Component | Action |
|-----------|--------|
| `marking_workflow_service.py` | `list_tracked`, `batch_tracker`, `close_letter` |
| Letter serialize | Expose `status`, close metadata |

## G. Data model

Uses marking `track` / statuses; letter close columns (spec 01).

## H. API contract

- `GET /api/markings/tracked` — my tracked items
- `GET /api/markings/batches/{batch_id}/tracker`
- `POST /api/markings/letters/{letter_id}/close`

## I. Acceptance

- [ ] Unchecking track excludes marking from tracker but recipient still notified on create.
- [ ] Batch tracker shows mixed Info + RR correctly; RR pending/responded accurate.
- [ ] Non-initiator cannot close.
- [ ] Initiator without hold cannot close.
- [ ] Close with open RR requires `force`; with `force` succeeds and supersedes actives.
