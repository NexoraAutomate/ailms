# Spec 01 — Staged File Ingestion

## A. Purpose

Accept correspondence documents **before** an official `cms_letters` row exists. Persist the original bytes securely and create a durable staging record for downstream OCR/AI jobs.

## B. Preconditions

- PostgreSQL running; FastAPI starts successfully.
- Spec 02 (schema): `cms_ai_staged_documents` table exists **or** this step includes minimal schema add (see master plan step 2–3 ordering: schema must land first in implementation).

## C. Inputs

- **HTTP:** `POST /api/ai-registration/staged-documents`
- **Content-Type:** `multipart/form-data`
- **Fields:**
  - `file` (required): PDF, PNG, JPG, JPEG, WEBP (reuse `ALLOWED_EXTENSIONS` subset focused on OCR types: `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`)
  - `source` (optional): `"register-letter"` | `"scan"` — analytics only

## D. Processing

1. Authenticate actor as `current_user_name(db)` (existing pattern).
2. Read upload into memory with size cap (`max_upload_bytes`).
3. Validate extension/MIME using same rules as `storage_service.validate_upload` (may extract shared validator).
4. Compute SHA-256 checksum.
5. Write file to `storage/ai/staging/{staged_id}/{uuid}_{safe_filename}` — **not** under `letter_id` path (letter does not exist).
6. Insert `cms_ai_staged_documents` row.
7. Return staged document id; **do not** run OCR in this request.

## E. Outputs

- **API response:**
  ```json
  {
    "stagedDocumentId": "42",
    "originalFilename": "sample-letter.pdf",
    "mimeType": "application/pdf",
    "fileSize": 123456,
    "checksum": "sha256:…",
    "createdAt": "2026-09-20T12:00:00Z"
  }
  ```
- **Filesystem artifact:** original bytes at `storage_key`.

## F. Components

| Component | Action |
|-----------|--------|
| `backend/app/routers/ai_registration.py` | New endpoint |
| `backend/app/ai/ingestion_service.py` | Staging logic |
| `backend/app/storage_service.py` | Reuse validation helpers (refactor optional) |
| `frontend/services/ai-registration.ts` | `uploadStagedDocument(file)` |
| `frontend/components/ai/registration-upload.tsx` | File picker UI |

## G. Data model

**Table:** `cms_ai_staged_documents` (see master plan).

No FK to `cms_letters`.

## H. API contract

| | |
|--|--|
| **Endpoint** | `POST /api/ai-registration/staged-documents` |
| **Method** | POST |
| **Auth** | Same as rest of API (future: real auth); record `uploaded_by` |
| **Errors** | 413 too large; 415 unsupported type; 422 empty file |
| **Idempotency** | None — each upload creates new staged doc (duplicate detection deferred to job level via checksum optional warning) |

## I. UI behavior

On **Register Letter**, add mode toggle: **Manual** (existing form) | **Upload & analyze**.

Upload mode: user selects file → upload → show staged id + “Start analysis” (creates job in spec 10).

## J. Failure modes

| Failure | Behavior |
|---------|----------|
| Unsupported file | 415, no row |
| Disk full | 500, rollback DB insert if file write fails |
| Duplicate upload | Allow; optional UI warning if checksum matches recent staged doc |
| Malicious PDF | Stored but not parsed until OCR step; sandbox limits in spec 11 |

## K. Security controls

- Extension allow-list; max size; sanitize filename (`_safe_original_name`).
- Storage path traversal prevention (reuse `resolve_storage_path` pattern with staging root).
- Do not execute embedded scripts; OCR parser treats as data.
- Log filename + id only, not file contents.

## L. Verification

**Unit test:** `test_staged_upload_rejects_exe` — post `.exe` → 415.

**Integration test:**

```bash
curl -s -F "file=@fixtures/ai-letter-registration/sample-01-typed-letter.pdf" \
  http://127.0.0.1:8000/api/ai-registration/staged-documents
```

**Expected:** JSON with `stagedDocumentId`; file exists under `backend/storage/ai/staging/`.

**DB:**

```sql
SELECT id, original_filename, checksum FROM cms_ai_staged_documents ORDER BY id DESC LIMIT 1;
```

## M. Acceptance criteria

1. Given a valid PDF ≤ 25 MiB, API returns 201 with `stagedDocumentId` and checksum matching file bytes.
2. Given a valid upload, no row is created in `cms_letters`.
3. Given `.exe` upload, API returns 415 and no staged row is created.
