# SUPARCO PMS Integration — Master Implementation Plan

**Status:** PROPOSED STATE (planning document)  
**Precondition:** Read `00-current-state.md`.  
**Constraint:** Integration only — PMS remains authoritative for project data; AILMS remains authoritative for letters and workflow. No write-back to PMS.

---

## 1. Objective summary

Integrate authorized read-only project information from SUPARCO’s Project Management System into AILMS to enable:

1. **Executive Intelligence Radar** — overview of sync health, alerts, and project risk signals.
2. **Correspondence-to-Project Early Warning** — deterministic alerts linking letters and milestones.
3. **Letter ↔ project / milestone linking** — exact-ID auto-accept + human confirmation for ambiguous matches.
4. **Evidence-backed alerts and management summaries** — rules first; optional AI explanation last.

---

## 2. Target architecture

```text
PMS (external, authoritative)
        │  read-only HTTPS (httpx)
        ▼
PmsClient (auth, pagination, validate/normalize)
        ▼
PmsSyncService (lock → upsert → history → stats)
        ▼
PostgreSQL cache: pms_projects, pms_milestones, …
        │
        ├─► ProjectMatchingService ──► letter_project_links
        ├─► IntelligenceRulesService ──► intelligence_alerts
        └─► Intelligence API ──► Project Intelligence UI
                                      │
                                      └─► (Phase 6) AI summary (optional, structured)
```

**Invariants:**

- Never invent PMS endpoints or schemas before approved docs arrive.
- Never duplicate `cms_letters` or replace JWT auth.
- Never store credentials or full confidential letter bodies in PMS tables.
- Failed sync must not wipe cached rows.
- LLM cannot create authoritative project links or mutate PMS/letters.

---

## 3. Dependency map

| Dependency | Type | Required | Notes |
|------------|------|----------|-------|
| PostgreSQL | Infra | Yes | Existing |
| FastAPI + SQLAlchemy | Infra | Yes | Existing |
| httpx | Lib | Yes | Already in requirements |
| PMS API credentials | Secret | Yes | From PMS team; server-side only |
| Approved PMS OpenAPI / samples | Contract | Yes | Blocks Phase 2 mapper freeze |
| Next.js CMS | UI | Yes | Existing design system |
| LLM provider | Optional | Phase 6 | Existing `LLM_PROVIDER` stack |
| Redis / Celery / Kafka | Infra | **No** | Not justified for Phase 1–5 |

---

## 4. Implementation phases

| Phase | Focus | Specs | Exit criteria |
|-------|-------|-------|---------------|
| **1** | Audit, API contract intake, plan | `00`, `01`, `OPEN-QUESTIONS` | Plan reviewed; PMS docs received or gaps listed |
| **2** | Config, schema, client stub, sync status API | `01` config, `02`, `03`, `04` (status only) | Migrations apply; client validates fixtures; admin status endpoints |
| **3** | Sync worker, upsert, tests | `04`, `11` | Idempotent sync against mocks; lock works; cache preserved on failure |
| **4** | Matching + confirmation UI | `05`, `08` | Exact matches auto; ambiguous need human confirm; audit trail |
| **5** | Deterministic rules + Radar | `06`, `07`, `08` | Alerts dedupe; overview real data; stale warning |
| **6** | Optional AI summaries | `09`, `10` | Structured AI output; rules/dashboard work if LLM down |

After each phase: summarize changed files, migration impact, tests run, honest failures, verify commands.

---

## 5. Exact file map

### 5.1 Existing files to extend

| File | Change |
|------|--------|
| `backend/app/config.py` | Add `PmsSettings` fields (URL, auth, timeouts, sync interval, freshness, feature flags) |
| `backend/app/models.py` | Add PMS integration entities |
| `backend/app/db_upgrade.py` | `upgrade_pms_integration_schema(engine)` |
| `backend/app/main.py` | Include routers; call upgrade; start PMS scheduler when enabled |
| `backend/app/jobs.py` | `start_pms_sync_scheduler` / stop hooks |
| `backend/app/schemas.py` or new `pms_schemas.py` | Request/response DTOs |
| `backend/.env.example` | Placeholder PMS_* keys only |
| `frontend/lib/cms-nav.ts` | Nav item + href |
| `frontend/services/` | New `intelligence.ts` / `pms.ts` |
| `backend/pytest.ini` | Optional markers `pms` if useful |

### 5.2 New backend files

| File | Responsibility |
|------|----------------|
| `backend/app/pms_client.py` | Transport, auth refresh, pagination, redaction |
| `backend/app/pms_mappers.py` | **Isolated** response → normalized DTOs (filled when API docs arrive) |
| `backend/app/pms_sync_service.py` | Lock, upsert, sync_runs, history |
| `backend/app/project_matching_service.py` | Match pipeline + confirmation |
| `backend/app/intelligence_rules_service.py` | Deterministic rules + alert upsert |
| `backend/app/intelligence_service.py` | Overview aggregates / serialization |
| `backend/app/routers/intelligence.py` | Radar + alerts + project detail + review |
| `backend/app/routers/pms_admin.py` | Sync status + manual trigger (admin) |
| `backend/tests/test_pms_*.py` | Client, sync, match, rules, authz |
| `backend/tests/fixtures/pms/*.json` | Sanitized sample responses |

### 5.3 New frontend files

| File | Responsibility |
|------|----------------|
| `frontend/app/(cms)/intelligence/page.tsx` | Overview |
| `frontend/app/(cms)/intelligence/alerts/page.tsx` | Alert list |
| `frontend/app/(cms)/intelligence/alerts/[id]/page.tsx` | Alert detail + evidence |
| `frontend/app/(cms)/intelligence/projects/[id]/page.tsx` | Project + milestones + linked letters |
| `frontend/app/(cms)/intelligence/matches/page.tsx` | Match confirmation queue |
| `frontend/components/cms/intelligence-*.tsx` | UI bodies reusing existing CMS patterns |
| `frontend/services/intelligence.ts` | API client |

Route names may be adjusted to avoid collisions; keep under one section label **Project Intelligence**.

---

## 6. Configuration placeholders (example only)

Document in `.env.example` — **never commit real secrets**:

```env
PMS_INTEGRATION_ENABLED=false
PMS_BASE_URL=https://pms.example.internal/api
PMS_AUTH_METHOD=oauth2_client_credentials
PMS_TOKEN_URL=
PMS_CLIENT_ID=
PMS_CLIENT_SECRET=
PMS_API_KEY=
PMS_TIMEOUT_SECONDS=30
PMS_RETRY_MAX=3
PMS_RETRY_BACKOFF_SECONDS=2
PMS_SYNC_INTERVAL_SECONDS=10800
PMS_SYNC_WORKER_ENABLED=false
PMS_PAGE_SIZE=100
PMS_INCREMENTAL_SYNC=false
PMS_DATA_FRESHNESS_SECONDS=14400
# Endpoint paths filled only after approved docs:
PMS_PATH_PROJECTS=
PMS_PATH_MILESTONES=
PMS_PATH_RISKS=
PMS_PATH_ACTIONS=
PMS_PATH_DEPENDENCIES=
```

---

## 7. Authorization matrix (initial proposal)

| Capability | Administrator | Management | Manager / Coordinator | Actionist |
|------------|---------------|------------|----------------------|-----------|
| View radar overview (aggregates) | Yes | Yes | Configurable | No (default) |
| View alert list (non-letter fields) | Yes | Yes | Own-dept / linked | Linked letters only |
| View letter evidence on alert | Per `letter_access` | Per `letter_access` | Per `letter_access` | Per `letter_access` |
| Confirm/reject project match | Yes | Yes | Yes (if letter accessible) | If letter accessible |
| Review/resolve alert | Yes | Yes | Limited | No |
| Manual sync / sync history | Yes | No | No | No |

Refine against `cms_roles.permissions_json` in Phase 5; add permission keys such as `intelligence.view`, `intelligence.review`, `pms.sync`.

---

## 8. Definition of done (global)

Feature complete only when all items in the requirements §14 are met, including:

- Reliable scheduled sync + freshness reporting
- Idempotent project/milestone cache keyed by **external IDs**
- Traceable letter–project links; ambiguous cases require review
- Deduplicated evidence-backed alerts
- Dashboard shows **real** backend data with empty/error/loading states
- Existing AILMS functionality intact
- Tests pass on mocks; no live PMS dependency
- Read-only to PMS; no credential leakage

---

## 9. Out of scope

- Replacing PMS or AILMS workflows
- Write-back / mutation APIs to PMS
- Second auth system
- Decorative charts with fabricated numbers
- Adding Redis/Celery/Kafka without necessity proof
- Cloud AI outside approved LLM infrastructure
- Inventing PMS API contracts
