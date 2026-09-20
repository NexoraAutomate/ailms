# Spec 03 — OCR Normalization (LLM-Ready)

## A. Purpose

Transform raw OCR JSON into a stable, page-aware text representation for the LLM **without** discarding raw OCR (spec 02).

## B. Preconditions

- `ocr-output.json` exists for job.
- Job status at least `OCR_COMPLETE`.

## C. Inputs

- File: `storage/ai/jobs/{job_id}/ocr-output.json`

## D. Processing

1. Read raw OCR artifact (read-only).
2. For each page:
   - Sort lines top-to-bottom, left-to-right (using bbox center).
   - Normalize whitespace (collapse runs, preserve paragraph breaks when vertical gap > threshold).
   - Escape or strip control characters except `\n\t`.
3. Build structured intermediate:
   - `llm-input.json` with blocks tagged by page.
4. Build plain text view `llm-input.txt`:

```text
=== PAGE 1 ===
Ref: MOIT/2026/1234
Date: 15 March 2026
…
=== PAGE 2 ===
…
```

5. Store both under `storage/ai/jobs/{job_id}/`.
6. Update job `normalized_artifact_key`.

**Rules:**

- Page markers must be deterministic (regex-parseable).
- Include `sourcePage` index on each logical paragraph in JSON form for evidence mapping.

## E. Outputs

**llm-input.json (excerpt):**

```json
{
  "schemaVersion": 1,
  "jobId": "7",
  "pageCount": 2,
  "pages": [
    {
      "pageNumber": 1,
      "paragraphs": [
        { "text": "Ref: MOIT/2026/1234", "sourceLineIndices": [0] }
      ]
    }
  ],
  "combinedText": "=== PAGE 1 ===\n…"
}
```

## F. Components

- `backend/app/ai/ocr_normalize.py`
- Unit tests: `backend/tests/test_ai_registration_ocr_normalize.py`

## G. Data model

- Job: `normalized_artifact_key`

## H. API contract

- `GET /api/ai-registration/jobs/{id}/artifacts/normalized` → JSON when ready.

## I. UI behavior

Optional “View extracted text” tab in review (read-only, monospace) using normalized text — clearly labeled not official record.

## J. Failure modes

- Missing OCR file → job `FAILED`
- Malformed OCR JSON → `FAILED` with parse error
- Page with empty text → include page marker with `[no text detected]`

## K. Security controls

- Normalization is pure function — no eval, no HTML rendering server-side.
- Truncate combined text to LLM context budget with explicit `[TRUNCATED]` marker and log warning.

## L. Verification

**Unit test:** Feed minimal synthetic `ocr-output.json` → expect exact `combinedText` string.

```bash
python -m pytest backend/tests/test_ai_registration_ocr_normalize.py
```

**Artifact check:**

```bash
test -f backend/storage/ai/jobs/7/llm-input.json
test -f backend/storage/ai/jobs/7/llm-input.txt
grep -q "PAGE 1" backend/storage/ai/jobs/7/llm-input.txt
```

## M. Acceptance criteria

1. Given valid raw OCR for 3 pages, `llm-input.txt` contains exactly three `=== PAGE n ===` headers.
2. Given raw OCR, output files are produced without modifying `ocr-output.json`.
3. Given paragraph mapping, each paragraph references valid `sourceLineIndices` on that page.
