# AI Letter Registration — Current Repository State

**Status:** CURRENT STATE (as inspected 2026-09-20; frontend routing updated 2026-09-22)  
**Scope:** Describes what exists today. Not the proposed AI registration design.

---

## Repository layout

| Area | Path | Notes |
|------|------|--------|
| Backend API | `backend/` | FastAPI, SQLAlchemy 2, PostgreSQL via `psycopg` |
| Frontend | `frontend/` | Next.js 16 (App Router), React 19, Tailwind 4; CMS under `app/(cms)/` + `components/cms/` |
| Workspace | `AILMS.code-workspace` | Multi-root workspace file |
| Docker / Compose | — | **Not present** in repository |
| AI planning docs | `docs/ai-letter-registration/` | Created by this planning phase |

---

## Frontend architecture

- **Framework:** Next.js App Router (`frontend/app/`). CMS screens use **file-based routes** in the `(cms)` route group (URLs unchanged by the group name). Shared chrome lives in `app/(cms)/layout.tsx` → `CmsShell` (`components/cms/shell.tsx`).
- **Feature UI:** Screen bodies live under `frontend/components/cms/` (e.g. `register-letter.tsx`, `dashboard.tsx`, `letter-details.tsx`). Thin `page.tsx` files under `app/(cms)/…` mount those components.
- **Navigation:** Sidebar uses `Link` + `hrefForLabel` (`lib/cms-nav.ts`). In-app helpers still call `go(target)` via `useGo()` (`hooks/use-go.ts`), which maps legacy labels / ids (`Register Letter`, bare letter id, `meeting:…`, `Settings:users`) to real paths (`/letters/register`, `/letters/{id}`, etc.).
- **API access:** `frontend/lib/api.ts` — JSON fetch to `/api/*`; `next.config.mjs` rewrites `/api/*` → `http://127.0.0.1:8000/api/*`. `NEXT_PUBLIC_API_URL` is optional and unset by default (relative `/api` + rewrite).
- **State:** `frontend/components/app-provider.tsx` wraps the CMS layout; loads letters, users, departments, etc., and exposes `registerLetter`. Header search/AI NL query lives in `CmsSearchProvider`.
- **Styling:** Tailwind + shadcn-style `Button` component.
- **Demo/marketing:** `frontend/app/demo/*` — showcase/video routes **outside** the CMS layout (no shared shell/provider).

### Key CMS routes (current)

| Screen | Path |
|--------|------|
| Dashboard | `/` |
| All Letters | `/letters` |
| Register Letter | `/letters/register` |
| Letter detail | `/letters/[id]` |
| AI Assistant / Insights / Analysis | `/ai/assistant`, `/ai/insights`, `/ai/analysis` |
| Meetings | `/meetings`, `/meetings/[id]` |
| Import / Export | `/operations/import`, `/operations/export` |
| Settings | `/settings`, `/settings/[tab]` |

### Letter registration (current UX)

- Sidebar / nav **Register Letter** → `/letters/register` → `Register` in `components/cms/register-letter.tsx`.
- Flow today:
  1. User fills manual form (number, dates, subject, from/to, department, etc.).
  2. `POST /api/letters` creates `cms_letters` row immediately.
  3. Optional file upload **after** letter exists via `POST /api/letters/{id}/documents/upload`.
  4. Optional correspondence relations and reference document uploads.
  5. On success, `go(created.id)` navigates to `/letters/{id}`.
- **No OCR, no document-first staging, no human-in-the-loop AI registration.**

### Existing AI UI (advisory only)

- `frontend/components/ai/letter-tools.tsx` — panels for summarize, extract, classify, etc., on **existing** letters (letter detail route).
- `AIAnalyzeDocument` explicitly states: *“Mock document analysis… No OCR or live model is used.”* It calls `summarizeLetter` on letter metadata only, not file content.
- `frontend/services/ai.ts` — API client + **rule-based fallbacks** when LLM unavailable.
- AI routes: Assistant, Insights, Analysis — operate on register metadata, not uploaded PDF text.

---

## Backend architecture

- **Entry:** `backend/app/main.py` — CORS, router mounting, startup (DB create, seeds, reminder scheduler).
- **Config:** `backend/app/config.py` — Pydantic settings from `backend/.env` (PostgreSQL, storage path, LLM).
- **Database:** `backend/app/database.py` — SQLAlchemy engine; `ensure_database()` creates DB if missing.
- **Migrations:** Lightweight imperative upgrades in `backend/app/db_upgrade.py` (column adds), not Alembic.
- **Patterns:** Service modules (`*_service.py`) + thin routers (`backend/app/routers/`).

### HTTP API surface (relevant)

| Prefix | Router | Purpose |
|--------|--------|---------|
| `/api/letters` | `letters.py` | CRUD, actions, status |
| `/api/documents`, uploads | `documents.py` | Documents tied to **existing** `letter_id` |
| `/api/ai/*` | `ai.py` | LLM features on existing letters (summarize, extract fields from **DB record**, etc.) |
| `/api/correspondence-relations` | `correspondence.py` | Letter graph / thread |
| `/api/import`, `/api/export` | `data_operations.py` | CSV import jobs, export |
| `/api/health` | `main.py` | Liveness |

OpenAPI: `http://127.0.0.1:8000/docs`

---

## Authentication and authorization (current)

**ASSUMPTION verified in code:** There is **no** JWT/session middleware on API routes.

- **Actor identity:** `current_user_name(db)` reads `AppSetting` key `currentUser` (default `"A. Rahman"`) — see `backend/app/services.py`.
- **Users & roles:** `cms_users`, `cms_roles` with `permissions_json`; used heavily in **workflow** and **bulk** operations, not on most letter/document endpoints.
- **Sessions:** `cms_user_sessions` tracked for administration UI; not used as API auth gate.
- **Frontend:** No login gate on CMS routes; administration settings can change “current user” via settings API.

**OPEN QUESTION:** Production auth model (SSO, API keys) is out of scope for this repo snapshot; AI registration plan must align with whatever auth is added later, but should use the same `current_user_name` + role checks as other mutating operations until then.

---

## PostgreSQL data model (correspondence)

All application tables use prefix `cms_*` in database `ailms` (configurable).

### Core letter register — `cms_letters` (`Letter` model)

| DB column | API (camelCase) | Notes |
|-----------|-----------------|--------|
| `number` | `number` | Unique, required on create |
| `letter_date` | `letterDate` | Required |
| `received_date` | `receivedDate` | Defaults to letter date |
| `type` | `type` | Incoming / Outgoing / etc. (master data) |
| `subject` | `subject` | Required |
| `sender` | `from` | |
| `recipient` | `to` | |
| `department` | `department` | Validated on CSV import against departments |
| `priority` | `priority` | Master: Routine, Important, Urgent |
| `status` | `status` | Workflow statuses |
| `due_date` | `dueDate` | Optional |
| `assigned_to` | `assignedTo` | |
| `confidentiality` | `confidentiality` | |
| `action_required` | `actionRequired` | Maps to user’s “action item” concept |
| `remarks` | `remarks` | Free text |
| `is_archived`, etc. | | Archive support |

**Not in schema today:** dedicated `summary` field, `document_type/category` on letter (type is letter direction), explicit “references to other correspondence” (handled via `cms_letter_relations`).

### Documents — `cms_documents`, `cms_document_versions`

- Documents **require** `letter_id` (FK).
- Version stores: filename, mime, size, SHA-256 checksum, `storage_key` (relative path under storage root).
- Upload validation: extension allow-list, max 25 MiB (`max_upload_bytes` in config).

### Audit — `cms_audit_records`

- Module/action/record/description; used for letter registration, document upload, some AI calls.

### Import jobs — `cms_import_jobs`, `cms_import_errors`

- Pattern for **persistent job state** with status fields and JSON payload — useful precedent for AI jobs.

### AI / OCR tables

**None.** No OCR artifacts, no AI run history, no pgvector.

---

## Document storage

- **Implementation:** `backend/app/storage_service.py` — local filesystem under `DOCUMENT_STORAGE_PATH` (default `backend/storage`).
- **Layout:** `documents/{letter_id}/{document_id}/{version_id}_{uuid}_{filename}`.
- **Security:** Path traversal blocked in `resolve_storage_path`.
- **Preview:** PDF and common images via `/api/document-versions/{id}/preview`.

---

## LLM integration (current)

| Component | Location | Behavior |
|-----------|----------|----------|
| Client | `backend/app/llm_client.py` | OpenAI-compatible `POST …/chat/completions`; `chat_json()` parses JSON from model text |
| Config | `backend/.env.example` | `LLM_ENABLED`, `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, timeouts |
| “Configured” check | `llm_is_configured()` | Provider `ollama`: only base URL; else requires non-empty `LLM_API_KEY` |
| Features | `backend/app/ai_service.py` | Summarize, extract, classify, etc. — input is **serialized letter row**, not document OCR |
| Router | `backend/app/routers/ai.py` | Returns 503 if not configured |
| Tests | `backend/tests/test_llm.py` | Config boolean only |

**Ollama / Qwen (planned default):** Repo already supports `LLM_PROVIDER=ollama` without a cloud API key. Planning docs and `.env.example` default to Ollama + a Qwen Ollama tag (e.g. `qwen2.5:7b`) on port **11434**. Optional `vllm` remains for Linux/WSL CUDA.

---

## OCR (current)

**Not implemented.** No Python dependencies for PaddleOCR, Tesseract, pdf2image, PyMuPDF, etc. in `backend/requirements.txt`.

Document text is never extracted server-side today.

---

## Background processing (current)

- **Reminders only:** `backend/app/jobs.py` — daemon `threading.Thread` on interval; runs `process_reminders`.
- **No** Celery, Redis, RQ, or ARQ.
- Import validation runs **inline** in request handler (job row persisted, but not a separate worker process).

---

## Testing (current)

- Backend: `unittest` modules under `backend/tests/` — workflow, phase4 features, minimal LLM config test.
- **No** frontend test runner configured in `package.json`.
- **No** integration tests for AI or documents.

---

## Deployment (current)

- Documented manual run: PostgreSQL 16, `uvicorn` on 8000, `pnpm/npm run dev` on 3000 (`backend/README.md`).
- No container definitions in repo.

---

## Dependencies snapshot

**Python (`backend/requirements.txt`):** fastapi, uvicorn, sqlalchemy, psycopg, pydantic-settings, python-dotenv, python-multipart, httpx.

**Node (`frontend/package.json`):** next, react, tailwind, lucide-react — no PDF.js in dependencies (preview uses browser/native via API URL).

---

## Summary: gaps relative to target AI registration workflow

| Capability | Current state |
|------------|----------------|
| Upload before register | **No** — letter must exist first |
| OCR | **Missing** |
| LLM on document text | **Missing** (LLM uses DB metadata only) |
| Structured extraction schema aligned to `Letter` | Partial — ad hoc “fields” array in existing `/api/ai/extract` |
| Human approval before commit | **No** — register creates DB row immediately |
| AI audit / provenance | **No** |
| Async OCR/LLM pipeline | **No** dedicated worker (only reminder thread) |
| Security hardening for untrusted document text | **Not designed** |

---

## Decisions required (discovered during inspection)

1. **Document-first staging:** New tables/flow for uploads without `letter_id` vs. temporary “draft” letter rows.
2. **Auth:** Whether AI registration endpoints will require real authentication before production.
3. **OCR engine:** PaddleOCR vs alternatives (see spec `02-ocr.md`) — none in repo today.
4. **Local LLM runtime:** Default is **Ollama** on Windows (port 11434). Optional vLLM on Linux/WSL must use a port other than FastAPI `8000` (e.g. `8001`).
