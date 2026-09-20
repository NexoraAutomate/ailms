# Spec 10 — Background Processing & Job State Machine

## A. Purpose

Run OCR and LLM asynchronously so upload/review API stays responsive, using the **smallest** mechanism consistent with the repo (daemon thread + DB-backed jobs).

## B. Preconditions

- Schema for `cms_ai_registration_jobs` (master plan).
- Staged document (spec 01).

## C. Inputs

- `POST /api/ai-registration/jobs` body: `{ "stagedDocumentId": "42" }`

## D. Processing

### State machine

```text
QUEUED → PROCESSING → OCR_COMPLETE → EXTRACTION_COMPLETE → (validation) → NEEDS_REVIEW
                                                                              ↓
                                        FAILED ←──────────────── reject ─── REJECTED
                                                                              ↓ approve
                                        REGISTERED ←──────────────────────── APPROVED (optional intermediate)
```

Implementations may collapse `OCR_COMPLETE` and `EXTRACTION_COMPLETE` as internal substatus; external API exposes listed states.

### Worker

- Extend `backend/app/jobs.py`:
  - New thread `ai-registration-worker` OR single scheduler tick processing one job at a time (MVP).
  - Poll: `SELECT … FROM cms_ai_registration_jobs WHERE status = 'QUEUED' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED` (PostgreSQL).
- Pipeline steps in order: OCR → normalize → extract → validate → `NEEDS_REVIEW`.
- On exception: `FAILED` + error fields; do not auto-retry whole job (manual re-queue endpoint optional).

### API polling

- `GET /api/ai-registration/jobs/{id}` — current status + progress hint (`currentStage`: `ocr`|`llm`|`validation`).

### Re-processing

- `POST /api/ai-registration/jobs/{id}/retry` — from `FAILED` → `QUEUED` if artifacts stale.

## E. Outputs

- Job row with lifecycle timestamps: `started_at`, `ocr_completed_at`, `extraction_completed_at`, `review_ready_at`
- Worker logs at INFO

## F. Components

- `backend/app/ai/job_worker.py`
- `backend/app/jobs.py` — start worker on startup if `AI_REGISTRATION_WORKER_ENABLED=true`
- `backend/app/main.py` — hook startup
- `backend/app/routers/ai_registration.py`

## G. Data model

`cms_ai_registration_jobs.status` indexed for worker query.

## H. API contract

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ai-registration/jobs` | POST | Create job → `QUEUED` |
| `/api/ai-registration/jobs/{id}` | GET | Status + proposal when ready |
| `/api/ai-registration/jobs/{id}/retry` | POST | Re-queue failed job |

Create response:

```json
{ "jobId": "7", "status": "QUEUED", "stagedDocumentId": "42" }
```

## I. UI behavior

- Progress bar with states while polling every 2s (backoff to 5s).
- Allow user to leave page and return via “Pending AI registrations” list — **optional MVP**: store last job id in sessionStorage.

## J. Failure modes

- Worker disabled → jobs stuck `QUEUED` — health check warns
- Double worker (multiple uvicorn workers) → use `SKIP LOCKED` or single-worker deployment note
- LLM slow → job stays `PROCESSING` until timeout

## K. Security controls

- Worker runs with same DB credentials; no elevated OS privileges
- No arbitrary code execution from job payload

## L. Verification

**Test:**

```bash
python -m pytest backend/tests/test_ai_registration_worker.py -k queued_to_needs_review
```

Uses mocked OCR/LLM for speed.

**Manual with live services:**

1. POST create job.
2. Within 120s, GET returns `NEEDS_REVIEW` for sample-01.

**Evidence:** Log line `AI job 7 → NEEDS_REVIEW`.

## M. Acceptance criteria

1. Given job creation, HTTP response returns before OCR completes (< 500ms typical).
2. Given worker running, job transitions from `QUEUED` to `NEEDS_REVIEW` without user intervention.
3. Given worker stopped and env flag false, job remains `QUEUED` and API documents worker disabled state.
