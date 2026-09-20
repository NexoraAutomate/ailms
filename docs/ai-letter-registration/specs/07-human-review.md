# Spec 07 — Human Review & Approval Gate

## A. Purpose

Present AI proposal alongside the source document; allow edit, reject, or explicit approval — **without** creating `cms_letters` until approval.

## B. Preconditions

- Job status `NEEDS_REVIEW`.
- Artifacts available for preview (staged file) and proposal JSON.

## C. Inputs

- `GET /api/ai-registration/jobs/{id}` — job + proposal + validation issues
- `PATCH /api/ai-registration/jobs/{id}/proposal` — user edits (body: partial field map)
- `POST /api/ai-registration/jobs/{id}/reject` — optional reason
- `POST /api/ai-registration/jobs/{id}/approve` — triggers spec 08 (separate endpoint to keep approve explicit)

## D. Processing

### Review session

1. Load staged document preview URL (implementation: short-lived token or direct version endpoint for staged files — **new** `GET /api/ai-registration/staged-documents/{id}/preview`).
2. Render proposal fields on the right; mark AI-sourced values with visual badge.
3. User edits update server-side `proposal_json` and track `userOverrides: { field: { from, to, at, by } }`.
4. Reject → status `REJECTED`; retain artifacts for audit.
5. Approve → validate again server-side → call registration commit (spec 08).

### Mandatory human approval

- Approve button disabled until required fields filled: `number`, `letterDate`, `subject` (match manual register rules).
- Checkbox: “I confirm I have reviewed the document and fields” (optional but recommended).

## E. Outputs

- Updated `proposal_json` with human edits
- Audit: `add_audit` module `AI Registration`, action `Proposal Edited` / `Rejected` / `Approved`
- On approve only: letter id (spec 08)

## F. Components

| Layer | File |
|-------|------|
| API | `backend/app/routers/ai_registration.py` |
| UI | `frontend/components/ai/registration-review.tsx` |
| Service | `frontend/services/ai-registration.ts` |

## G. Data model

Job fields: `reviewed_by`, `approved_by`, `proposal_json` (includes overrides).

## H. API contract

### GET `/api/ai-registration/jobs/{id}`

```json
{
  "id": "7",
  "status": "NEEDS_REVIEW",
  "stagedDocument": { "id": "42", "previewUrl": "/api/ai-registration/staged-documents/42/preview" },
  "proposal": { "number": "…", "subject": "…" },
  "validation": { "passed": true, "fieldIssues": {} },
  "evidence": [ ],
  "aiGenerated": ["number", "subject"]
}
```

### PATCH `/api/ai-registration/jobs/{id}/proposal`

Request: `{ "subject": "Corrected subject" }`  
Response: full proposal + validation snapshot.

### POST `/api/ai-registration/jobs/{id}/reject`

Body: `{ "reason": "…" }` → status `REJECTED`.

### POST `/api/ai-registration/jobs/{id}/approve`

Body: `{ "confirm": true }` → spec 08; returns `{ "letterId": "123", "jobStatus": "REGISTERED" }`.

**Authorization:** Job `created_by` must match `current_user_name` unless role has admin permission — **OPEN QUESTION** define permission key `aiRegistration.approve`.

## I. UI behavior

**Layout:**

| Left (~50%) | Right (~50%) |
|-------------|--------------|
| PDF/image preview (iframe or img) | Form fields with AI badges |
| Page navigation if multi-page | Validation errors |
| | Evidence expanders per field |
| | Actions: Save edits, Reject, Approve |

**Register Letter flow:**

1. Upload → create job → poll status.
2. Auto-navigate to review when `NEEDS_REVIEW`.
3. Manual register path unchanged.

## J. Failure modes

- Approve while duplicate number → 409, stay on review
- Staged file missing → 404 on preview
- Concurrent edits → last-write-wins with `updated_at` check (optional 409)

## K. Security controls

- Escape all AI strings in React text nodes (no `dangerouslySetInnerHTML`).
- Preview endpoint: same auth as job; no guessable IDs without access check.
- Approve requires POST (no GET side effects).

## L. Verification

**Manual:**

1. Open review UI for job 7.
2. Change `subject` to `TEST-SUBJECT-123`.
3. Approve (with commit implemented).
4. Confirm letter subject equals edited value (spec 08).

**API test:**

```bash
curl -X PATCH …/jobs/7/proposal -d '{"subject":"Edited"}'
curl …/jobs/7 | jq '.proposal.subject'
# expect "Edited"
```

**Negative:** Before approve, `SELECT COUNT(*) FROM cms_letters WHERE number = '<proposed>'` may be 0.

## M. Acceptance criteria

1. Given job in `NEEDS_REVIEW`, user can edit fields via PATCH and GET reflects edits.
2. Given user clicks Reject, job status becomes `REJECTED` and no letter is created.
3. Given user has not clicked Approve, no new `cms_letters` row is linked to the job.
