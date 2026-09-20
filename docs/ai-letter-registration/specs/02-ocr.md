# Spec 02 — OCR (Raw Output)

## A. Purpose

Extract text from staged documents locally, preserving **page structure**, confidence, and layout metadata for traceability and downstream LLM input.

## B. Preconditions

- Staged document exists (spec 01).
- AI registration job in `QUEUED` or `PROCESSING` (spec 10).
- OCR dependencies installed (see § F).

## C. Inputs

- **Job input:** `staged_document_id`, filesystem path from `storage_key`
- **File types:** PDF (multi-page), single/multi-page images

## D. Processing

1. Transition job → `PROCESSING`.
2. **PDF:** Render each page to image (PyMuPDF `fitz` recommended) at DPI sufficient for OCR (150–300 DPI — tune in implementation).
3. **Images:** Treat as single page.
4. Run **PaddleOCR** per page (recommended — **not in repo today**).
5. Collect per line/word: text, confidence, bounding box `[x1,y1,x2,y2]` in page coordinates.
6. Write **immutable** raw artifact `storage/ai/jobs/{job_id}/ocr-output.json`.
7. Set job status `OCR_COMPLETE`; store `ocr_artifact_key`.

**CURRENT STATE:** No OCR library in project.  
**PROPOSED:** Add PaddleOCR + PyMuPDF + Pillow.  
**Alternative:** Tesseract via `pytesseract` — acceptable fallback with weaker layout metadata.

## E. Outputs

**Artifact:** `ocr-output.json`

```json
{
  "schemaVersion": 1,
  "jobId": "7",
  "stagedDocumentId": "42",
  "sourceChecksum": "sha256:…",
  "engine": "paddleocr",
  "engineVersion": "2.x",
  "processedAt": "2026-09-20T12:05:00Z",
  "pages": [
    {
      "pageNumber": 1,
      "width": 2480,
      "height": 3508,
      "status": "ok",
      "lines": [
        {
          "text": "Ref: MOIT/2026/1234",
          "confidence": 0.94,
          "bbox": [100, 200, 800, 240]
        }
      ],
      "fullText": "Ref: MOIT/2026/1234\n…"
    }
  ],
  "errors": []
}
```

## F. Components

| Component | Action |
|-----------|--------|
| `backend/app/ai/ocr_service.py` | OCR orchestration |
| `backend/app/ai/job_worker.py` | Invokes OCR stage |
| `backend/requirements.txt` | Add paddleocr, pymupdf, pillow |

## G. Data model

- Job row: `ocr_artifact_key`, status timestamps.
- No separate OCR table required if JSON artifact is canonical (optional `cms_ai_artifacts` later).

## H. API contract

OCR not exposed as standalone public API in phase 1; triggered by worker.

**Debug CLI (implementation):**

```bash
python -m backend.scripts.run_ai_job --job-id 7 --stage ocr
```

**Optional:** `GET /api/ai-registration/jobs/{id}/artifacts/ocr` (auth required) returns JSON or 404 if not ready.

## I. UI behavior

Show processing spinner with state label “Running OCR…” when job status is `PROCESSING` and OCR substep active (optional substatus field).

## J. Failure modes

| Failure | Behavior |
|---------|----------|
| Unreadable scan | Page `status: "low_quality"`; continue other pages |
| OCR engine crash | Job `FAILED`, `error_code: OCR_ENGINE_ERROR` |
| Encrypted PDF | Job `FAILED`, `error_code: PDF_ENCRYPTED` |
| Empty text all pages | Job `FAILED` or `NEEDS_REVIEW` with warning — **DECISION:** prefer `NEEDS_REVIEW` with empty proposal |

## K. Security controls

- OCR runs in API/worker process — no shell invocation on user filenames.
- Limit max pages (e.g. 50) and pixel count to prevent DoS.
- Do not follow external URLs embedded in PDF.

## L. Verification

**Input:** `fixtures/ai-letter-registration/sample-01-typed-letter.pdf`

**Command (after implementation):**

```bash
python -m pytest backend/tests/test_ai_registration_ocr.py -k sample_01
```

**Manual:**

1. Create staged doc + job.
2. Run OCR stage.
3. Assert `ocr-output.json` has `pages.length >= 1` and `pages[0].fullText` contains substring `"Ref"` or known fixture text.

**Golden file:** `fixtures/ai-letter-registration/expected/sample-01-ocr-output.partial.json` (subset match, not exact OCR text).

## M. Acceptance criteria

1. Given a readable single-page PDF fixture, `ocr-output.json` exists and lists page 1 with non-empty `fullText`.
2. Given a multi-page fixture (sample-06), artifact contains one entry per page with monotonic `pageNumber`.
3. Raw artifact file is not modified after write (immutable; re-runs write new job or version suffix).
