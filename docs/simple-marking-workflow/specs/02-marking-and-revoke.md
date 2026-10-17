# Spec 02 — Marking and Revoke

## A. Purpose

Allow any current holder (non-Viewer) to mark a correspondence to one or more users with per-recipient actions, unlimited depth, and revoke of a marking before the recipient remakes onward.

## B. Preconditions

- Spec 01 domain model implemented (tables exist).
- Letter `status` is `Open`.
- Actor is a **holder** (or initiator before first mark) and not Viewer.

## C. Inputs

### Mark batch

```json
{
  "letterId": "42",
  "parentMarkingId": null,
  "remarks": "Please review",
  "pathwayNotify": true,
  "recipients": [
    {
      "toUser": "A. Khan",
      "action": "for_info",
      "track": true,
      "instructions": ""
    },
    {
      "toUser": "B. Ali",
      "action": "response_required",
      "responseType": "draft_letter",
      "dueAt": "2026-10-20",
      "track": true,
      "remindersEnabled": true,
      "priority": "Urgent",
      "instructions": "Draft reply for Chairman"
    }
  ]
}
```

### Revoke

```json
{ "markingId": 99, "remarks": "Sent in error" }
```

**Client IP:** extracted from request (see security notes in spec 05 / 06).

## D. Processing

### D.1 Create mark batch

1. Assert letter access + holder + not Viewer + letter `Open`.
2. Validate `recipients` non-empty; each `toUser` exists; no self-mark; no duplicate `toUser` in same batch.
3. Reject if an **active** marking already exists for same `letter_id` + `from_user` + `to_user` (v1: reject with 400).
4. If `parentMarkingId` set: must be active marking to actor (or actor is initiator using null parent from root).
5. Create `MarkingBatch` with `created_at`, `client_ip`, `pathway_notify`.
6. For each recipient create `Marking` (`status=active`) with stamps.
7. If `pathway_notify`: create/activate `MarkingSubscription` for marker.
8. Notify each `to_user` (spec 05).
9. Audit: `Mark batch` with letter id and recipient count.
10. Update letter `assigned_to` / `assigned_by` for **compatibility** with legacy list views: set to first action recipient or last marked user (document choice: **primary** = first `response_required` else first recipient). Prefer not relying on these long-term.

### D.2 Unlimited chain

Recipient who holds may create a new batch with `parentMarkingId` = their active marking (or null if also initiator). No depth limit.

### D.3 Revoke

1. Actor must be `from_user` of the marking (or Admin).
2. Marking `status` must be `active`.
3. **No child markings** exist with `parent_marking_id = this marking` (any status). If children exist → 409.
4. Set `status=revoked`, `revoked_at`, `revoked_by`, `revoke_ip`; optional remarks on batch/audit.
5. Notify `to_user` that marking was revoked.
6. Cancel pending reminders for this marking (spec 05).

## E. Outputs

- Created batch + markings JSON.
- Revoked marking JSON.
- Notifications + audit rows.

## F. Components

| Component | Action |
|-----------|--------|
| `backend/app/marking_workflow_service.py` | `create_mark_batch`, `revoke_marking` |
| `backend/app/routers/markings.py` | HTTP endpoints |
| Client IP helper | Shared utility |

## G. Data model

Uses `cms_marking_batches`, `cms_markings`, `cms_marking_subscriptions` (spec 01).

## H. API contract

- `POST /api/markings/letters/{letter_id}/mark`
- `POST /api/markings/{marking_id}/revoke`
- `GET /api/markings/letters/{letter_id}/tree` (history tree)

Details in spec 06.

## I. Acceptance

- [ ] Multi-recipient batch with mixed actions succeeds.
- [ ] Self-mark and duplicate active A→B rejected.
- [ ] Unlimited forward chain works.
- [ ] Revoke succeeds only with no children; fails with 409 when child exists.
- [ ] Every create/revoke stores datetime + IP.
