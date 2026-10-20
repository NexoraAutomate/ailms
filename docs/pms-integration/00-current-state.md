# SUPARCO PMS Integration — Current Repository State

**Status:** CURRENT STATE (as inspected 2026-10-13)  
**Scope:** Describes what exists today. Not the proposed PMS integration design.  
**Precondition for implementation:** Read this file before changing code.

---

## 1. Repository layout

| Area | Path | Notes |
|------|------|--------|
| Backend API | `backend/` | FastAPI, SQLAlchemy 2 (`Mapped` / `mapped_column`), PostgreSQL via `psycopg` |
| Frontend | `frontend/` | Next.js App Router, React, Tailwind; CMS under `app/(cms)/` + `components/cms/` |
| Existing planning docs | `docs/ai-letter-registration/` | Spec package pattern to mirror |
| Fixtures | `fixtures/` | Shared sample assets |
| Docker / Compose | — | **Not present** in repository |
| Workspace | `AILMS.code-workspace` | Multi-root workspace |

### Backend structure (relevant)

```text
backend/
  run.py
  requirements.txt
  .env / .env.example
  pytest.ini
  app/
    main.py              # FastAPI entry, router mount, startup
    config.py            # Pydantic Settings
    database.py          # Engine / SessionLocal / ensure_database
    db_upgrade.py        # Imperative schema upgrades (no Alembic)
    models.py            # All ORM tables
    schemas.py           # Shared Pydantic I/O
    jobs.py              # In-process reminder + AI worker hooks
    auth_deps.py         # JWT CurrentUser / require_admin / require_roles
    auth_middleware.py
    auth_service.py
    letter_access.py     # Record-level letter visibility
    reminder_service.py
    llm_client.py / runpod_client.py   # httpx.AsyncClient patterns
    ai/                  # Registration OCR/LLM pipeline
    routers/             # Thin APIRouter modules under /api/*
  tests/
  scripts/
```

### Frontend structure (relevant)

```text
frontend/
  app/(cms)/             # Authenticated CMS routes
  app/(auth)/            # Login / signup
  components/cms/        # Screen bodies (dashboard, letters, …)
  components/ai/         # AI assistant / insights / letter tools
  services/              # Typed API clients
  lib/api.ts             # Fetch helper → /api/*
  lib/cms-nav.ts         # Sidebar NAV_GROUPS + href map
  lib/auth.ts
```

---

## 2. FastAPI entry and routing conventions

- **Entry:** `backend/app/main.py`
- **Prefix:** Routers mounted with `prefix="/api"` (e.g. letters → `/api/letters`).
- **There is no `/api/v1` version prefix today.** New intelligence routes should follow existing `/api/...` conventions (e.g. `/api/intelligence/...`) unless a versioning policy is introduced for the whole API.
- **OpenAPI:** `http://127.0.0.1:8000/docs`
- **Health:** `GET /api/health` (unauthenticated liveness; already returns AI worker warnings).
- **Pattern:** Service modules (`*_service.py`) + thin routers; avoid fat route handlers.

### Current router surface

| Prefix | Module | Purpose |
|--------|--------|---------|
| `/api/auth` | `auth.py` | Login, session, JWT |
| `/api/letters` | `letters.py` | Letter CRUD / list / access |
| `/api/documents` | `documents.py` | Attachments |
| `/api/workflow` | `workflow.py` | Enterprise workflow |
| `/api/approvals` | `approvals.py` | Approvals |
| `/api/escalations` | `escalations.py` | Escalations |
| `/api/reminders` | `reminders.py` | Reminder ops |
| `/api/correspondence-relations` | `correspondence.py` | Letter graph |
| `/api/ai` | `ai.py` | LLM tools on existing letters |
| `/api/ai-registration` | `ai_registration.py` | Document-first registration jobs |
| `/api/admin` | `administration.py` | Roles / permissions / sessions |
| `/api/departments`, `/users`, `/audit`, … | `management.py` | Admin/master data |
| Dashboard bootstrap | `dashboard.py` | Aggregated CMS payload |

---

## 3. Database configuration and migrations

- **Config:** `backend/app/config.py` → `POSTGRES_*` from `backend/.env`
- **URL:** `postgresql+psycopg://…` via `Settings.database_url`
- **Create:** `Base.metadata.create_all` on startup + `ensure_database()`
- **Migrations:** **Not Alembic.** Schema evolution uses imperative helpers in `backend/app/db_upgrade.py` (inspect + `CREATE TABLE` / `ALTER TABLE`), called from `on_startup`.
- **Implication for PMS:** Add `upgrade_pms_integration_schema(engine)` (or equivalent) following the same pattern; keep changes reversible via documented down-SQL or guarded column drops.

---

## 4. Letter model (authoritative correspondence)

**Table:** `cms_letters`  
**Model:** `Letter` in `backend/app/models.py`  
**Primary key:** integer `id`  
**Business key:** `number` (unique, indexed)

### Core fields (non-exhaustive)

| Field | Role |
|-------|------|
| `number` | Letter reference |
| `letter_date`, `received_date`, `due_date`, `completion_date` | Dates |
| `type` | Incoming / Outgoing |
| `subject`, `sender`, `recipient`, `department` | Metadata |
| `priority`, `status`, `confidentiality` | Classification / workflow |
| `assigned_to`, `created_by`, `assigned_by` | Ownership |
| `action_required`, `remarks`, `body_text` | Content / OCR body |
| `is_archived`, `archived_at` | Archive |
| `department_id` | FK → `cms_departments` |
| `validated_at`, `classified_at` | Workflow timestamps |

### Related workflow entities

| Table | Model | Notes |
|-------|-------|-------|
| `cms_route_steps` | `RouteStep` | Routing history |
| `cms_action_items` | `ActionItem` | Parallel actionists; `status`, `due_date` |
| `cms_response_versions` | `ResponseVersion` | Draft/reply versions |
| `cms_approval_steps` / `cms_approvals` | Approval lifecycle | |
| `cms_letter_relations` | `LetterRelation` | Correspondence graph |
| `cms_documents` | `Document` | File attachments |
| `cms_ai_*` | AI registration jobs / staged docs | Separate from letters until commit |

### Closed / pending status sets

Defined in `backend/app/services.py`:

- **Closed:** `Completed`, `Closed`, `Archived`, `Rejected`, `Information Delivered`, …
- **Pending:** `Draft`, `Registered`, `Under Review`, `Assigned`, `Action in Progress`, …

**Do not invent a second letter table.** `letter_project_links.letter_id` must FK `cms_letters.id`.

---

## 5. Authentication, roles, permissions, audit

### Auth (current — superseded older “no JWT” docs)

- JWT Bearer (+ optional `ailms_token` cookie)
- `AuthMiddleware` + `auth_deps.CurrentUser` / `AdminUser` / `require_roles`
- `AUTH_REQUIRED` flag (tests may disable)
- Bootstrap via `ensure_auth_bootstrap`

### Roles (enterprise)

Canonical roles include: `Administrator`, `Management`, `Manager`, `Coordinator`, `Actionist`, …  
Permission matrices live in `cms_roles.permissions_json` and workflow constants in `enterprise_workflow_service.py`.

### Letter visibility (record-level)

`backend/app/letter_access.py`:

- Administrators / Management: broad access
- Others: assignee, creator, assigned_by, route recipient, action assignee, department rules for Coordinator/Manager

**PMS implication:** Project summaries must not leak letter bodies or confidential fields to users who only have project-level access. Alerts that reference letters must apply `user_can_access_letter` (or redact letter detail).

### Audit

`cms_audit_records` via `add_audit(...)` in `services.py` — modules such as Users, Letters, AI.  
Manual match confirmations, alert reviews, and admin sync triggers **must** write audit rows.

---

## 6. Dashboard and frontend API conventions

- Frontend calls relative `/api/*`; Next rewrite proxies to FastAPI (`next.config.mjs`).
- CMS shell: `app/(cms)/layout.tsx` → `CmsShell`
- Nav: `NAV_GROUPS` in `frontend/lib/cms-nav.ts` — add **Project Intelligence** under Management or AI Intelligence without inventing a parallel shell.
- Dashboard metrics today come from `dashboard.py` bootstrap + letter aggregations — **real data only**; empty/loading/error states required for new views.
- Existing AI UI: `/ai/assistant`, `/ai/insights`, `/ai/analysis` — advisory; must remain independent of PMS sync.

---

## 7. Docker / deployment

- **No Docker Compose** in repo.
- Typical local: `start.bat` / `stop.bat`, backend `run.py`, frontend Next dev.
- Background work runs **in-process** inside the API process (see below). Multi-worker production would need a single elected scheduler or external cron — **not present today**.

---

## 8. Scheduling / background jobs

| Mechanism | File | Behavior |
|-----------|------|----------|
| Reminder scheduler | `jobs.py` → `reminder_service` | Daemon thread; `REMINDER_INTERVAL_SECONDS` (default 3600) |
| AI registration worker | `ai/job_worker.py` | Optional poll loop; `AI_REGISTRATION_WORKER_ENABLED` |
| Startup | `main.on_startup` | Schema upgrades, seeds, `start_background_workers()` |

**No Celery, Redis, Kafka, or RQ.**

**PMS sync recommendation:** Extend `jobs.py` with a PMS sync scheduler gated by config + **DB advisory lock / sync_runs lock row** so overlapping runs (and multi-worker accidents) are prevented. Do not add Redis/Celery unless a measured need is documented.

---

## 9. Test framework

- **pytest** (`backend/pytest.ini`, `testpaths = tests`)
- ~30+ test modules covering workflow, AI registration, LLM/Runpod clients, security
- Pattern: mock external HTTP (`httpx.AsyncClient`), isolated DB where needed, `AUTH_REQUIRED=false` for some suites
- Marker: `live` for optional live OCR/LLM

**PMS tests must use mocked/sanitized fixtures only** — never live SUPARCO PMS.

---

## 10. Existing AI / LLM integration

| Piece | Location | Notes |
|-------|----------|-------|
| Provider switch | `config.py` `LLM_PROVIDER` | `ollama` \| `runpod` \| `vllm` \| `openai` |
| Clients | `llm_client.py`, `runpod_client.py` | `httpx.AsyncClient`, retries, host allowlist |
| AI registration | `app/ai/*` | OCR local; LLM extraction; human review before commit |
| Letter AI tools | `ai_service.py`, `routers/ai.py` | Summarize/extract/classify on existing letters |
| Security posture | Spec 11 letter-registration | Untrusted document text; no tool-calling from letters |

**PMS AI layer (Phase 6 only):** reuse approved LLM provider; never send data outside approved infrastructure; deterministic rules remain authoritative if LLM is down.

---

## 11. HTTP client pattern to reuse

`httpx.AsyncClient` is already used for LLM/Runpod. PMS client should follow the same style:

- Explicit timeouts
- Bounded retries on transient failures
- Credential redaction in logs
- Clear exception taxonomy

---

## 12. Files expected to extend (preview)

See `01-master-plan.md` for the full map. High-confidence touch points:

| Existing file | Extension |
|---------------|-----------|
| `backend/app/config.py` | PMS_* settings |
| `backend/app/models.py` | PMS + link + alert tables |
| `backend/app/db_upgrade.py` | `upgrade_pms_integration_schema` |
| `backend/app/main.py` | Mount routers; call upgrade; start sync worker |
| `backend/app/jobs.py` | Sync scheduler hook |
| `backend/.env.example` | Placeholder PMS config |
| `frontend/lib/cms-nav.ts` | Project Intelligence nav |
| `frontend/services/` | New API client module |

**New files (suggested):** under `backend/app/` — `pms_client.py`, `pms_sync_service.py`, `project_matching_service.py`, `intelligence_rules_service.py`, `routers/intelligence.py`, `routers/pms_admin.py`; frontend pages under `app/(cms)/intelligence/` (or `project-intelligence/`).

---

## 13. Open blockers (do not invent)

| Item | Status |
|------|--------|
| PMS base URL, auth method, token endpoint | **Awaiting PMS developer** |
| Exact endpoint paths & response schemas | **Awaiting approved API docs + samples** |
| Whether risks/actions/dependencies APIs exist | **Unknown — treat as optional** |
| Incremental sync / cursor field | **Unknown** |
| Approved project status enum values | **Unknown** |
| Production multi-process deployment topology | **Unknown — design for single-process + DB lock** |

Document answers in `OPEN-QUESTIONS.md` as they arrive. Build adapters with pluggable mappers; do not hard-code guessed paths.
