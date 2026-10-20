# Spec 02 — PMS API Client Adapter

## A. Purpose

Dedicated transport module for **read-only** PMS communication. Isolates auth, pagination, validation, retries, and logging redaction from business logic.

## B. Preconditions

- Spec 01 configuration present.
- Approved API docs + samples recorded in `OPEN-QUESTIONS.md` (or mapper remains stubbed).

## C. Modules

| Module | Role |
|--------|------|
| `backend/app/pms_client.py` | `httpx.AsyncClient` session, auth, retries, pagination |
| `backend/app/pms_mappers.py` | Raw JSON → normalized DTOs (contract-specific) |
| `backend/app/pms_schemas.py` | Normalized Pydantic models (internal) |

Suggested layout mirrors existing `runpod_client.py` / `llm_client.py` patterns.

## D. Normalized internal DTOs (stable)

These are **AILMS-owned** shapes. Mappers fill them from PMS-specific JSON.

### ProjectNormalized

- `external_id: str` (required, unique)
- `code: str | None`
- `name: str`
- `status: str | None`
- `progress_pct: float | None`
- `owner_org: str | None`
- `source_updated_at: datetime | None`
- `aliases: list[str]` (optional)

### MilestoneNormalized

- `external_id: str`
- `external_project_id: str`
- `name: str`
- `baseline_date: date | None`
- `forecast_date: date | None`
- `actual_date: date | None`
- `status: str | None`
- `source_updated_at: datetime | None`

### Optional Risk / Action / DependencyNormalized

Created only when endpoints exist and are approved.

## E. Client behaviors

1. **Authenticate** per `PMS_AUTH_METHOD`; cache token in memory; refresh on 401 once.
2. **Paginate** until exhausted using configured strategy (filled after C6 resolved).
3. **Timeout** every request with `PMS_TIMEOUT_SECONDS`.
4. **Retry** only transient failures (timeouts, 429, 5xx) up to `PMS_RETRY_MAX` with backoff.
5. **Validate** responses via Pydantic; reject invalid rows into sync stats (`rejected`), do not abort entire run unless auth/config failure.
6. **Optional resources:** if path empty or HTTP 404/501, mark resource unavailable and continue.
7. **No write methods** (POST/PUT/PATCH/DELETE to PMS) — enforce in client API surface.

## F. Error taxonomy

| Class | Examples | Sync handling |
|-------|----------|---------------|
| `PmsAuthError` | 401 after refresh, bad credentials | Fail run; keep cache |
| `PmsTransportError` | DNS, timeout, connection | Fail run; keep cache |
| `PmsValidationError` | Schema mismatch on a row | Count rejected; continue batch if possible |
| `PmsPartialSyncError` | Some pages OK, later fail | Commit successful pages if policy allows; record error |

## G. Logging / redaction

- Never log `Authorization`, client secret, API key, or full token.
- Truncate/redact sensitive fields from response logs.
- Prefer structured log fields: `external_id`, status codes, page index, duration.

## H. Testing

| Case | Expectation |
|------|-------------|
| Token acquire + refresh | Success path mocked |
| Pagination multi-page | All items collected |
| Timeout / retry exhaustion | Raises transport error after N tries |
| Invalid row | Validation error counted |
| Missing optional endpoint | Graceful skip |

Fixtures: `backend/tests/fixtures/pms/*.json`.

## I. Acceptance

- [ ] Client has no hard-coded production host
- [ ] Mappers are the only place that know PMS field names
- [ ] Unit tests pass without network
