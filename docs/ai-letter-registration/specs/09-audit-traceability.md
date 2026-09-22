# Spec 09 — Audit & Traceability

## A. Purpose

Ensure every AI registration run is reconstructable: source document, OCR, model configuration, prompts, extractions, validation, human edits, and final commit — without over-logging confidential content.

## B. Preconditions

- Job pipeline defined (specs 01–08).
- Existing `cms_audit_records` available.

## C. Inputs

- Events: upload, job state change, OCR complete, extraction complete, validation, edit, reject, approve, register

## D. Processing

### AI audit structure (logical)

| Field | Storage |
|-------|---------|
| `ai_run_id` | `cms_ai_runs.id` or job id + run sequence |
| `document_id` | `staged_document_id` + eventual `document_id` |
| `model` | job.`model_id` |
| `model_version/config` | job.`model_config_json` |
| `prompt_version` | job.`prompt_version` |
| `timestamp` | per-stage `updated_at` / run table |
| `processing_status` | job.`status` |
| `extracted_output` | artifact path `extraction-result.json` |
| `validation_result` | `validation-result.json` |
| `user_approval` | `approved_by`, `approved_at` |
| `source_document` | staged checksum + storage_key |
| `source_ocr` | `ocr_artifact_key` |
| `errors` | job.`error_code`, `error_message` |

### Provenance for field values

- LLM `evidence[]` in extraction result (page + snippet).
- Optional `cms_ai_field_evidence` if querying needed; else keep in JSON artifacts.
- Human overrides stored in `proposal_json.userOverrides`.

### Logging policy

- **INFO:** job id, status transitions, durations, model id.
- **DEBUG:** truncated text previews only if `AI_LOG_DOCUMENT_TEXT=true`.
- Never log full OCR/LLM payloads in production default.

### Integration with existing audit

Use `add_audit` for user-visible actions:

| Action | Module |
|--------|--------|
| Staged upload | AI Registration |
| Job created | AI Registration |
| Approved / Rejected | AI Registration |
| Letter registered | AI Registration / Letters |

## E. Outputs

- Artifact files on disk under `storage/ai/jobs/{job_id}/`
- DB job + optional run rows
- Audit rows in `cms_audit_records`

## F. Components

- `backend/app/models.py` — `AiRegistrationJob`, optional `AiRun`
- `backend/app/ai/job_worker.py` — emit stage timestamps
- Existing `add_audit`

## G. Data model

See master plan §5. Optional:

```sql
CREATE TABLE cms_ai_runs (
  id SERIAL PRIMARY KEY,
  job_id INT NOT NULL REFERENCES cms_ai_registration_jobs(id),
  stage VARCHAR(40),
  model_id VARCHAR(120),
  prompt_version VARCHAR(40),
  input_artifact_key VARCHAR(512),
  output_artifact_key VARCHAR(512),
  latency_ms INT,
  status VARCHAR(20),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

## H. API contract

- `GET /api/ai-registration/jobs/{id}/audit` — metadata + artifact links (not for unauthenticated users).

Response excerpt:

```json
{
  "jobId": "7",
  "artifacts": {
    "ocr": "/api/ai-registration/jobs/7/artifacts/ocr",
    "extraction": "…",
    "validation": "…"
  },
  "model": { "id": "qwen2.5:7b", "promptVersion": "registration_v1" },
  "approval": { "by": "A. Rahman", "at": "…" }
}
```

## I. UI behavior

“Processing history” collapsible on review screen: timestamps per stage, link to download OCR JSON (role-gated).

## J. Failure modes

- Missing artifact file → audit API lists `missing: true`, job may still be reviewable if proposal in DB

## K. Security controls

- Artifact download endpoints check job access
- Redact snippets in audit API for low-privilege roles — **OPEN QUESTION**

## L. Verification

After full pipeline:

```bash
ls backend/storage/ai/jobs/7/
# expect: ocr-output.json, llm-input.json, extraction-result.json, validation-result.json
```

```sql
SELECT status, prompt_version, model_id, ocr_artifact_key, letter_id
FROM cms_ai_registration_jobs WHERE id = 7;
```

```sql
SELECT action, description FROM cms_audit_records
WHERE module = 'AI Registration' AND record = '7' OR record LIKE '%job%';
```

## M. Acceptance criteria

1. Given completed job, all four core artifact files exist and checksums match staged source document reference.
2. Given approved registration, audit trail includes approve action with user name and resulting letter number.
3. Given default logging config, application logs do not contain full document text at INFO level.
