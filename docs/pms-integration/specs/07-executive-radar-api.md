# Spec 07 — Executive Intelligence Radar API

## A. Purpose

Backend endpoints for Project Intelligence dashboard using existing `/api/...` routing (not `/api/v1` unless globally adopted).

## B. Preconditions

- Specs 03–06 implemented for data; auth via `CurrentUser` / role gates.

## C. Router

`backend/app/routers/intelligence.py` mounted in `main.py` with `prefix="/api"`.

Feature flag: if `PMS_INTEGRATION_ENABLED=false` → 404 (same pattern as AI registration).

## D. Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/intelligence/overview` | `intelligence.view` | Aggregates for radar cards |
| GET | `/api/intelligence/alerts` | `intelligence.view` | Filtered alert list |
| GET | `/api/intelligence/alerts/{alert_id}` | `intelligence.view` + letter ACL | Detail + evidence |
| POST | `/api/intelligence/alerts/{alert_id}/review` | `intelligence.review` | Confirm / dismiss / resolve |
| GET | `/api/intelligence/projects/{external_or_local_id}` | `intelligence.view` | Project + milestones + linked letter **refs** |
| GET | `/api/intelligence/sync-status` | `intelligence.view` | Freshness (may proxy admin status subset) |
| POST | `/api/pms/sync` | Admin | Manual sync (spec 04) |

Path params may use local integer id or `external_id` — pick one and document; prefer local id in URLs with external_id in payload.

## E. Overview payload (approved aggregates)

```json
{
  "projectsSynced": 0,
  "milestoneDiscrepanciesAwaitingReview": 0,
  "overdueActions": 0,
  "unresolvedCorrespondenceAlerts": 0,
  "alertsBySeverity": { "info": 0, "warning": 0, "critical": 0 },
  "alertsByStatus": { "open": 0, "confirmed": 0, "dismissed": 0, "resolved": 0 },
  "lastSuccessfulSyncAt": null,
  "lastAttemptedSyncAt": null,
  "dataStale": true,
  "staleWarning": "PMS data exceeds freshness threshold"
}
```

All counts from real DB queries — never placeholders.

## F. Alert list filters

Query params: `project`, `alertType`, `severity`, `status`, `from`, `to`, `letterId`, pagination.

Each alert item includes: ids, type, title, severity, status, project refs, optional letter ref (number only if accessible), timestamps, rule version, short evidence summary.

## G. Authorization & redaction

- Apply role permission checks on every endpoint.
- If alert references a letter the user cannot access: omit body/subject details; show generic “Linked correspondence (restricted)” or hide letter id per policy.
- Project summary access ≠ letter access.
- Review action writes audit + `reviewed_by` / `reviewed_at` / notes.

## H. Review body

```json
{
  "decision": "confirmed" | "dismissed" | "resolved",
  "notes": "optional"
}
```

## I. Failure modes

| Case | HTTP |
|------|------|
| Integration disabled | 404 |
| Unauthenticated | 401 |
| Forbidden role | 403 |
| Unknown alert | 404 |
| Letter restricted on detail | 200 with redaction **or** 403 for letter-only fields — choose consistently |

## J. Acceptance

- [ ] Overview reflects DB
- [ ] Filters work
- [ ] Review audits
- [ ] No secret/raw payload leakage
- [ ] Letter ACL enforced
