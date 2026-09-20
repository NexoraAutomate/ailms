# Spec 06 — Validation (Schema + Business Rules)

## A. Purpose

Treat LLM output as **untrusted**; enforce Pydantic structure, CMS master data, and registration rules before human review.

## B. Preconditions

- `extraction-result.json` exists.
- Job status `EXTRACTION_COMPLETE`.

## C. Inputs

- Parsed `LetterExtractionResult`
- DB master data: departments, priorities, letter types, users (for assignedTo if extracted)

## D. Processing

1. Structural validation: Pydantic parse (already done at extraction).
2. Field-level business rules:
   - `number`: non-empty for submit; check duplicate against `cms_letters.number` → warning `DUPLICATE_NUMBER` (blocking at approve unless overridden).
   - Dates: parse ISO; reject impossible dates; `receivedDate` default today if null at commit time only.
   - `type`, `priority`, `confidentiality`: must be in master lists (fallback to seed defaults).
   - `department`: if not in list, flag `UNKNOWN_DEPARTMENT` — require human pick.
   - String max lengths match DB columns (e.g. subject 400).
3. Produce `validation-result.json`:

```json
{
  "schemaVersion": 1,
  "jobId": "7",
  "passed": false,
  "blockingErrors": [],
  "fieldIssues": {
    "department": [{ "code": "UNKNOWN_DEPARTMENT", "message": "…" }]
  },
  "normalizedProposal": { }
}
```

4. `normalizedProposal` = flat `LetterCreate`-compatible dict + metadata flags.
5. If no blocking errors → job `NEEDS_REVIEW`; else `NEEDS_REVIEW` with errors shown (still allow human fix) OR `FAILED` if unrecoverable — **DECISION:** use `NEEDS_REVIEW` always when OCR succeeded.

## E. Outputs

- `validation-result.json`
- Job `validation_artifact_key`, `proposal_json` updated, status `NEEDS_REVIEW`

## F. Components

- `backend/app/ai/validation_service.py`
- Reuse import validators from `import_service.py` where possible (`_parse_date`, master value sets)

## G. Data model

Uses existing master tables; no new tables.

## H. API contract

- `GET /api/ai-registration/jobs/{id}` includes `validation`, `proposal`, `status`.

## I. UI behavior

Show blocking errors in red at top; field-level issues inline on review form.

## J. Failure modes

- DB unreachable during duplicate check → fail job with retry
- Invalid JSON artifact → `FAILED`

## K. Security controls

- Parameterized queries only for duplicate check (no string SQL from AI).
- Strip HTML from all string fields (`<script>` → removed or escaped for UI).

## L. Verification

**Unit tests:**

```bash
python -m pytest backend/tests/test_ai_registration_validation.py
```

Cases:
- Unknown department → issue code present
- Duplicate number in DB → blocking error
- Oversized subject → truncation or error

**Artifact:**

```bash
jq '.passed' backend/storage/ai/jobs/7/validation-result.json
```

## M. Acceptance criteria

1. Given extraction with invalid priority `"SuperUrgent"`, validation adds field issue and normalizes to allowed value or leaves blank requiring user input.
2. Given duplicate letter number in DB, validation reports `DUPLICATE_NUMBER` before approve.
3. Given valid sample-01 extraction, validation reaches `NEEDS_REVIEW` with zero blocking errors.
