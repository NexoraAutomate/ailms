# Spec 08 — Registration Commit (PostgreSQL)

## A. Purpose

After explicit human approval, atomically create the official letter record, attach the staged document, and link audit/traceability — reusing existing CMS services.

## B. Preconditions

- Job `NEEDS_REVIEW` or `APPROVED` (intermediate optional).
- Re-validation passes (spec 06).
- User invoked `POST …/approve`.

## C. Inputs

- Final `proposal_json` (AI + human overrides)
- Staged document record
- Job id

## D. Processing

1. Begin DB transaction.
2. Build `LetterCreate` from proposal (map `from`→sender, dates, etc.).
3. Call same business logic as `create_letter` in `letters.py` (extract shared function `register_letter_from_proposal()` to avoid duplication).
4. **Document attach:**
   - Create `cms_documents` row with `document_type` from proposal `documentCategory`.
   - Create `cms_document_versions` pointing to staged file — **move or copy** storage key from staging to canonical `documents/{letter_id}/…` path (copy recommended to preserve staging audit).
5. Optional: create `cms_letter_relations` for each resolved `relatedLetterNumbers` (lookup by number).
6. Update job: `letter_id`, status `REGISTERED`, `completed_at`.
7. `add_audit` — `AI Registration`, `Letter Registered via AI`, record number.
8. Commit.

**Order invariant:** Steps 2–7 only inside approve handler — never in OCR/LLM stages.

## E. Outputs

- **API:** `{ "letterId": "123", "number": "…", "jobId": "7", "status": "REGISTERED" }`
- **PostgreSQL:** row in `cms_letters`, `cms_documents`, version row
- **Filesystem:** document under letter path

## F. Components

- `backend/app/ai/registration_commit.py`
- Refactor: `backend/app/correspondence_service.py` or `letters.py` shared create helper
- Reuse `document_service.create_document_with_upload` patterns where applicable (may need variant for existing bytes)

## G. Data model

- `cms_ai_registration_jobs.letter_id` FK set
- Existing letter/document tables unchanged structurally

## H. API contract

`POST /api/ai-registration/jobs/{id}/approve`

Errors:
- 409 duplicate number
- 422 validation failure
- 404 job not found
- 400 wrong status

## I. UI behavior

On success → navigate to letter detail (`go(letterId)` → `/letters/{id}` via `useGo` / `resolveNavHref`), toast “Letter registered”.

## J. Failure modes

- Partial failure mid-transaction → rollback, job stays `NEEDS_REVIEW`, error logged
- File copy fail → rollback
- Related letter number not found → skip relation + warning notification

## K. Security controls

- All DB writes via SQLAlchemy ORM / parameterized queries
- No LLM involvement in this step

## L. Verification

**SQL (after approving job 7):**

```sql
SELECT j.id, j.status, j.letter_id, l.number, l.subject
FROM cms_ai_registration_jobs j
LEFT JOIN cms_letters l ON l.id = j.letter_id
WHERE j.id = 7;
```

**Expected:** `status = 'REGISTERED'`, `letter_id` NOT NULL, subject matches edited proposal.

**Document link:**

```sql
SELECT d.id, d.letter_id, d.document_type
FROM cms_documents d
WHERE d.letter_id = (SELECT letter_id FROM cms_ai_registration_jobs WHERE id = 7);
```

**Traceability:**

```sql
SELECT module, action, record FROM cms_audit_records
WHERE module = 'AI Registration' ORDER BY id DESC LIMIT 5;
```

**Integration test:** `test_ai_registration_e2e.py` asserts letter count +1 only after approve endpoint.

## M. Acceptance criteria

1. Given approved job, exactly one new `cms_letters` row exists with field values matching final proposal.
2. Given approved job, staged document is linked via `cms_documents` for that letter.
3. Given job still in `NEEDS_REVIEW`, zero letters reference that job’s `letter_id`.
