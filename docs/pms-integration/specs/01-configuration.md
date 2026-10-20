# Spec 01 — Configuration & Feature Flags

## A. Purpose

Externalize all PMS integration settings through `backend/app/config.py` and `backend/.env` / `.env.example`. No secrets in source control.

## B. Preconditions

- Phase 1 audit complete (`00-current-state.md`).
- PMS credentials obtained via approved channel (may still be placeholders).

## C. Settings (Pydantic)

Add fields to `Settings` (or nested settings group) in `config.py`:

| Env var | Purpose | Default |
|---------|---------|---------|
| `PMS_INTEGRATION_ENABLED` | Master feature flag (API 404 when false) | `false` |
| `PMS_BASE_URL` | PMS API base | empty |
| `PMS_AUTH_METHOD` | `oauth2_client_credentials` \| `api_key` \| `bearer_static` \| `none` | `none` |
| `PMS_TOKEN_URL` | Token endpoint if OAuth | empty |
| `PMS_CLIENT_ID` / `PMS_CLIENT_SECRET` | OAuth client | empty |
| `PMS_API_KEY` / `PMS_BEARER_TOKEN` | Alternate auth | empty |
| `PMS_TIMEOUT_SECONDS` | HTTP timeout | `30` |
| `PMS_RETRY_MAX` | Transient retry count | `3` |
| `PMS_RETRY_BACKOFF_SECONDS` | Base backoff | `2` |
| `PMS_SYNC_INTERVAL_SECONDS` | Scheduler interval | `10800` (3h) |
| `PMS_SYNC_WORKER_ENABLED` | Start in-process scheduler | `false` |
| `PMS_PAGE_SIZE` | Pagination size | `100` |
| `PMS_INCREMENTAL_SYNC` | Use incremental if supported | `false` |
| `PMS_DATA_FRESHNESS_SECONDS` | Stale threshold | `14400` (4h) |
| `PMS_PATH_*` | Approved endpoint path suffixes | empty until docs |
| `PMS_MATCH_AUTO_ACCEPT_EXACT` | Auto-confirm exact ID matches | `true` |
| `PMS_HISTORY_ENABLED` | Project/milestone history snapshots | `true` |
| `PMS_AI_SUMMARY_ENABLED` | Phase 6 AI summaries | `false` |

Validation rules:

- If `PMS_INTEGRATION_ENABLED=true`, require non-empty `PMS_BASE_URL` and credentials for the selected auth method.
- Empty optional resource paths mean “resource disabled” (graceful skip).

## D. Example `.env.example` block

See master plan §6. Placeholders only.

## E. Failure modes

| Condition | Behavior |
|-----------|----------|
| Flag false | Intelligence/PMS admin routers return 404; scheduler not started |
| Missing secrets with flag true | Startup warning or health degraded; sync refused with clear error |
| Invalid auth method | Config validation error |

## F. Components

- `backend/app/config.py`
- `backend/.env.example`
- `GET /api/health` may expose non-sensitive flags: `pmsIntegrationEnabled`, `pmsSyncWorkerEnabled`, `pmsDataStale` (optional)

## G. Acceptance

- [ ] Settings load from env
- [ ] Secrets never logged
- [ ] Feature flag gates routers and worker
- [ ] `.env.example` updated without real credentials
