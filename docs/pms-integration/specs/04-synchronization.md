# Spec 04 — Synchronization Service & Admin Status

## A. Purpose

Idempotent, recoverable PMS → PostgreSQL synchronization on a configurable schedule (default 3 hours), plus admin status/trigger endpoints.

## B. Preconditions

- Specs 01–03.
- Mapper stubs or frozen mappers for available resources.

## C. Components

| Component | File |
|-----------|------|
| Sync orchestration | `pms_sync_service.py` |
| Scheduler hook | `jobs.py` + `main.py` |
| Admin HTTP | `routers/pms_admin.py` |

## D. Sync algorithm

1. **Acquire single-run lock**
   - Prefer PostgreSQL advisory lock or `pms_sync_runs` row with `status=running` + uniqueness check.
   - If lock held → exit (`already_running`).
2. Insert `pms_sync_runs` (`status=running`, `triggered_by`).
3. Authenticate via `PmsClient`.
4. Fetch projects (all pages or incremental).
5. Validate/normalize; upsert by `external_id` (insert or update).
6. Fetch milestones (and optional resources); upsert.
7. If history enabled, write meaningful deltas only.
8. Update sync statistics on the run row.
9. Invoke `IntelligenceRulesService.evaluate_all()` (Phase 5; no-op stub until then).
10. Commit; set run `success` or `partial`.
11. On failure: record sanitized `error_summary`, set `failed`/`partial`, **do not delete** existing cache; release lock in `finally`.

### Upsert semantics

- Match on `external_id` only.
- Update approved fields when source_updated_at is newer or always overwrite with latest successful fetch (document choice; prefer latest successful fetch for pilot).
- Duplicate IDs in one page → reject extras with validation error count.

## E. Scheduler

- Default interval: `PMS_SYNC_INTERVAL_SECONDS=10800`.
- Start only when `PMS_INTEGRATION_ENABLED` and `PMS_SYNC_WORKER_ENABLED`.
- Implement as daemon thread similar to reminder scheduler **plus DB lock** so multi-worker misconfiguration cannot double-sync.
- Do **not** introduce Redis/Celery unless topology requires it (document in OPEN-QUESTIONS F6).

## F. Admin API (authorized)

Mount under `/api/pms` or `/api/intelligence/sync` — avoid `/api/v1` unless whole API versions.

Suggested:

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/pms/sync-status` | Admin (or Management read) | Current status, last success, last attempt, stale flag |
| GET | `/api/pms/sync-runs` | Admin | Paginated history |
| POST | `/api/pms/sync` | Admin only | Manual trigger; returns 409 if already running |

Response rules:

- Include timestamps, counts, sanitized errors.
- **Never** include credentials, bearer tokens, stack traces, or raw confidential PMS payloads.

## G. Audit

Manual sync → `add_audit(module="PMS", action="Sync Triggered", ...)`.

## H. Freshness

`stale = (now - last_successful_sync) > PMS_DATA_FRESHNESS_SECONDS`  
Exposed on status + intelligence overview; UI must warn when stale.

## I. Testing

- Idempotent double sync → no duplicate rows
- Failed mid-run → prior cache intact
- Concurrent trigger → one run, other 409/skipped
- Auth failure → failed run, cache intact

## J. Acceptance

- [ ] Scheduler respects interval and flag
- [ ] Lock prevents overlap
- [ ] Admin endpoints auth-gated
- [ ] Status never leaks secrets
