# Spec 12 — Testing & Acceptance

## A. Purpose

Define unit, integration, security, and end-to-end acceptance tests with objective pass/fail criteria for AI letter registration.

## B. Preconditions

- Specs 01–11 implemented.
- Fixture dataset (spec 13).

## C. Inputs

- Fixture documents under `fixtures/ai-letter-registration/`
- Test database (use existing `ailms` or isolated DB — **RECOMMEND** transaction rollback per test)

## D. Processing

### Unit tests

| Area | Module | Cases |
|------|--------|-------|
| OCR normalization | `test_ai_registration_ocr_normalize.py` | Page markers, sort order, truncation |
| Schema validation | `test_ai_registration_validation.py` | Master data, dates, duplicates |
| Extraction parsing | `test_ai_registration_extraction.py` | Pydantic parse, mock LLM responses |
| Field normalization | same | `from`/`to` mapping |
| Authorization | `test_ai_registration_security.py` | Job ownership |
| Registration rules | `test_ai_registration_commit.py` | Required fields, 409 duplicate |

### Integration tests

Pipeline with **mocked** OCR and LLM (default CI):

```text
upload → job → worker (mock) → NEEDS_REVIEW → approve → PostgreSQL
```

File: `backend/tests/test_ai_registration_e2e.py`

Optional `@pytest.mark.live` for real Ollama + PaddleOCR (developer machine only).

### Security tests

See spec 11 — `test_ai_registration_security.py`.

### End-to-end acceptance (controlled sample)

**Fixture:** `sample-01-typed-letter.pdf`  
**Known content (embedded in PDF at generation time):**

- Ref: `ACCEPT-TEST-2026-001`
- Date: 2026-01-15
- Subject: `Acceptance Test Letter`
- From: `Ministry of Example`
- Action: `Provide comments within 14 days`

**Procedure:**

1. Run script `backend/scripts/run_acceptance_ai_registration.sh` (to be added) OR pytest live marker.
2. Human approves with default proposal (or fully automated approve in test).
3. Verify SQL + artifacts.

**Expected final state:**

- Letter `number = ACCEPT-TEST-2026-001` (or as extracted and confirmed)
- Document linked
- Job `REGISTERED`
- Artifacts present

## E. Outputs

- pytest JUnit XML (optional CI)
- Saved artifacts under `backend/storage/ai/jobs/` for failed runs

## F. Components

- `backend/tests/test_ai_registration_*.py`
- `fixtures/ai-letter-registration/expected/*.json`

## G. Data model

Tests may create letters; use unique numbers per run (`ACCEPT-TEST-{uuid}`) to avoid collisions.

## H. API contract

Tests use httpx AsyncClient against FastAPI app (`from app.main import app`).

## I. UI behavior

Manual QA checklist (release):

- [ ] Upload PDF on Register screen
- [ ] Wait for review
- [ ] Preview visible left
- [ ] Edit + approve
- [ ] Letter detail shows document

## J. Failure modes

- Live tests skipped if Ollama not running (`pytest -m "not live"`)

## K. Security controls

Tests must not commit real secrets; use `.env.test` example.

## L. Verification

**CI command (mocked):**

```bash
cd backend && python -m pytest tests/test_ai_registration_*.py -m "not live" -v
```

**Pass criteria:** 0 failures.

**Live E2E (developer):**

```bash
cd backend && python -m pytest tests/test_ai_registration_e2e.py -m live -v
```

Requires Ollama + OCR deps running.

**Database assertion helper:**

```sql
SELECT l.number, j.status
FROM cms_ai_registration_jobs j
JOIN cms_letters l ON l.id = j.letter_id
WHERE l.number LIKE 'ACCEPT-TEST-%'
ORDER BY j.id DESC LIMIT 1;
```

## M. Acceptance criteria

1. Mocked integration test proves no letter exists before approve and exactly one after.
2. All unit tests in `test_ai_registration_*` pass in CI without GPU.
3. Live acceptance test (when run) produces letter matching fixture reference number within human-approved proposal.
