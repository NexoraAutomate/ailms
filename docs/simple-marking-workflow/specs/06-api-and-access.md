# Spec 06 — API and Access

## A. Purpose

Define REST contracts for the marking workflow and who may see or mutate a letter under the new model.

## B. Preconditions

- Specs 01–05 service behavior defined.
- Auth via existing session / `current_user_name`.

## C. Inputs

HTTP JSON / multipart as listed below. Client IP from ASGI request:

1. Prefer connection client host.
2. If `TRUST_PROXY=true`, use first `X-Forwarded-For` hop.

## D. Processing — access rules

| Role / relation | Read letter | Mark / note / respond | Close | Revoke |
|-----------------|-------------|------------------------|-------|--------|
| Admin | yes | yes | yes (as override) | yes |
| Initiator | yes | if hold | if hold | own marks |
| Ever marked (from or to) | yes | if currently hold | no | own marks if no children |
| Viewer | yes if access | no | no | no |
| Others | no | no | no | no |

**Access grant:** initiator ∪ any `from_user`/`to_user` on any marking for letter ∪ Admin (Management may retain broad read if product keeps it—v1: **Management keeps full read** like today; mark only if hold).

Update `letter_access.py` / `owned_letter_filter` to include marking participation instead of (or in addition to) RouteStep/ActionItem.

### Inbox / Sent

| View | Definition |
|------|------------|
| Inbox | Letters you currently hold: leaf inbound `active` marking to you, or you are initiator with no active markings (e.g. after full revoke) |
| Sent / marked by me | Letters with ≥1 non-revoked marking where `from_user = me` (revoked-only marks do not keep the letter in Sent) |
| Track | Spec 04 tracked list |

## E. Outputs — API surface

Prefix: `/api/markings`

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/letters/{id}/mark` | Create mark batch |
| POST | `/{marking_id}/revoke` | Revoke |
| GET | `/letters/{id}/tree` | Full marking tree + batch meta |
| GET | `/letters/{id}/notes` | Notes + attachments |
| POST | `/letters/{id}/notes` | Add note / files |
| POST | `/{marking_id}/respond` | Fulfill RR |
| GET | `/tracked` | My tracked markings |
| GET | `/batches/{batch_id}/tracker` | Batch response tracker |
| POST | `/letters/{id}/close` | Initiator close |
| GET | `/letters/{id}/actions` | Available UI actions for me (`mark`, `close`, `respond`, …) |

Deprecate enterprise execute for letter lifecycle (spec 08): either return empty enterprise actions or 410 on old enterprise-only actions.

## F. Components

| Component | Action |
|-----------|--------|
| `backend/app/routers/markings.py` | New router registered in app |
| `backend/app/letter_access.py` | Marking-aware access |
| `backend/app/routers/letters.py` | Inbox filter uses markings |
| `frontend/services/markings.ts` | Client |

## G. Data model

No new tables beyond 01–05.

## H. API contract — example tree node

```json
{
  "id": 10,
  "batchId": 3,
  "parentMarkingId": null,
  "fromUser": "Initiator",
  "toUser": "A. Khan",
  "action": "response_required",
  "responseType": "draft_letter",
  "status": "active",
  "dueAt": "2026-10-20",
  "track": true,
  "createdAt": "2026-10-17T10:00:00Z",
  "clientIp": "203.0.113.10",
  "children": []
}
```

## I. Acceptance

- [ ] Unauthorized user gets 403 on letter marking APIs.
- [ ] Inbox reflects active `to_user` markings.
- [ ] Actions endpoint drives Workflow tab buttons.
- [ ] IP recorded on mutating endpoints.
