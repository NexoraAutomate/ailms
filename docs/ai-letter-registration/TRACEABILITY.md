# AI Letter Registration — Traceability Matrix

**Requirement → Specification → Implementation (planned) → Test → Evidence**

Implementation columns list **planned** modules from `01-master-plan.md` (not yet built).

Legend: **Spec** = file in `docs/ai-letter-registration/specs/`

---

## Core workflow requirements

| ID | Requirement | Spec | Implementation step | Test | Verification / evidence |
|----|-------------|------|---------------------|------|-------------------------|
| R-W1 | User uploads/scans document | 01 | `ingestion_service`, staged upload API | `test_ai_registration_ingestion.py` | curl upload → `stagedDocumentId`; file on disk |
| R-W2 | OCR extracts text | 02 | `ocr_service`, worker | `test_ai_registration_ocr.py` | `ocr-output.json` with pages |
| R-W3 | OCR normalized for LLM | 03 | `ocr_normalize.py` | `test_ai_registration_ocr_normalize.py` | `llm-input.txt` PAGE markers |
| R-W4 | Local LLM analyzes OCR | 04, 05 | `llm_provider`, `extraction_service` | `test_ai_registration_extraction.py`, `verify_ollama.py` | `extraction-result.json` |
| R-W5 | Structured fields extracted | 05 | `extraction_schema.py`, prompts v1 | schema unit tests | Pydantic validate artifact |
| R-W6 | Fields validated | 06 | `validation_service.py` | `test_ai_registration_validation.py` | `validation-result.json` |
| R-W7 | User reviews/edits proposal | 07 | review API + `registration-review.tsx` | manual + PATCH test | edited subject in GET |
| R-W8 | Human approval mandatory | 07, 08 | approve endpoint only commits | `test_ai_registration_e2e.py` | no letter before approve SQL |
| R-W9 | Official record in PostgreSQL | 08 | `registration_commit.py` | e2e test | `cms_letters` row |
| R-W10 | Document + artifacts traceable | 09 | artifacts + audit | audit GET + ls artifacts | 4 JSON files + audit rows |

---

## Architecture principles

| ID | Requirement | Spec | Implementation | Test | Evidence |
|----|-------------|------|----------------|------|----------|
| R-A1 | PostgreSQL system of record | 08 | reuse `Letter` model | e2e | letter in `cms_letters` |
| R-A2 | No vector DB phase 1 | — | no pgvector | n/a | schema inspection |
| R-A3 | AI does not control DB | 05, 08, 11 | LLM read-only; ORM commit | security tests | no SQL from model |
| R-A4 | Untrusted AI output | 06, 07 | validation + review | validation tests | invalid priority rejected |
| R-A5 | Model provider abstraction | 04 | `llm_provider.py` | `test_llm_provider.py` | swap env model id |
| R-A6 | Future RAG/embeddings ready | 09, 03 | page OCR + stable IDs | n/a | job id + page JSON |

---

## Field alignment (CMS data model)

| ID | Requirement | Spec | Implementation | Test | Evidence |
|----|-------------|------|----------------|------|----------|
| R-F1 | number | 05, 06, 08 | maps to `Letter.number` | validation duplicate | DB unique |
| R-F2 | letterDate / receivedDate | 05, 06 | `letter_date`, `received_date` | date parse tests | ISO in proposal |
| R-F3 | sender/recipient (from/to) | 05 | alias mapping | unit | LetterCreate dump |
| R-F4 | subject, department, priority | 05, 06 | master data validation | validation | field issues |
| R-F5 | actionRequired, dueDate | 05 | optional inference | sample-04 | null deadline |
| R-F6 | summary (non-column) | 05 | proposal_json | UI manual | shown not required for commit |
| R-F7 | document type/category | 05, 08 | `Document.document_type` | e2e | document row type |
| R-F8 | related correspondence | 05, 08 | `LetterRelation` optional | e2e optional | relation row |
| R-F9 | confidence/evidence | 05, 09 | evidence array | extraction test | snippet + page |

---

## Ollama / Qwen

| ID | Requirement | Spec | Implementation | Test | Evidence |
|----|-------------|------|----------------|------|----------|
| R-L1 | Model download/configure | 04 | docs + Ollama tag | manual | `ollama list` shows model |
| R-L2 | Ollama startup | 04 | CLI / Windows service | curl `/v1/models` | 200 response |
| R-L3 | Health check | 04 | `/api/ai/health/llm` | pytest | status ok |
| R-L4 | Test inference | 04 | `verify_ollama.py` | script exit 0 | JSON in response |
| R-L5 | App connectivity | 04 | httpx client | integration | health via FastAPI |
| R-L6 | Not hard-coded to one model | 04 | env `LLM_MODEL` | config test | change model string |

---

## OCR

| ID | Requirement | Spec | Implementation | Test | Evidence |
|----|-------------|------|----------------|------|----------|
| R-O1 | Local OCR (none today) | 02 | PaddleOCR + PyMuPDF | ocr tests | engine metadata in JSON |
| R-O2 | Raw OCR retained | 02, 03 | immutable `ocr-output.json` | normalize test | file mtime unchanged |
| R-O3 | Page numbers | 02, 03 | page objects | sample-06 | 3 pages |
| R-O4 | Confidence/bbox when available | 02 | line-level fields | ocr test | bbox array present |
| R-O5 | OCR errors/status | 02 | page status | low quality fixture | status field |

---

## Background processing

| ID | Requirement | Spec | Implementation | Test | Evidence |
|----|-------------|------|----------------|------|----------|
| R-B1 | Non-blocking UI | 10 | worker thread | worker test | fast POST response |
| R-B2 | Job states | 10 | status column | worker test | NEEDS_REVIEW reached |
| R-B3 | Reuse repo pattern | 10 | extend `jobs.py` | code review | no Redis added |

---

## Security

| ID | Requirement | Spec | Implementation | Test | Evidence |
|----|-------------|------|----------------|------|----------|
| R-S1 | Prompt injection | 05, 11 | prompt + sample-07 | security test | priority not hacked |
| R-S2 | XSS | 07, 11 | React escape | security test | script not executed |
| R-S3 | SQL injection | 06, 08, 11 | ORM | security test | — |
| R-S4 | Unauthorized access | 07, 11 | created_by filter | security test | 404 |
| R-S5 | Oversized/unsupported files | 01, 11 | storage limits | ingestion test | 413/415 |
| R-S6 | LLM outage | 04, 10 | fail job | security test | FAILED, no letter |
| R-S7 | Logging confidentiality | 09, 11 | env flags | log review | no full text at INFO |

---

## Testing & acceptance

| ID | Requirement | Spec | Implementation | Test | Evidence |
|----|-------------|------|----------------|------|----------|
| R-T1 | Unit tests | 12 | pytest modules | CI | green |
| R-T2 | Integration pipeline | 12 | e2e mocked | `test_ai_registration_e2e.py` | — |
| R-T3 | Security tests | 11, 12 | security module | pytest | green |
| R-T4 | E2E sample letter | 12, 13 | acceptance script | live marker | SQL letter row |
| R-T5 | Fixture dataset | 13 | `fixtures/…` | file check | 7 PDFs |

---

## Document index

| Spec file | Primary topics |
|-----------|----------------|
| `01-file-ingestion.md` | Staging upload |
| `02-ocr.md` | Raw OCR |
| `03-ocr-normalization.md` | LLM-ready text |
| `04-llm-provider.md` | Ollama, Qwen tags, abstraction (optional vLLM) |
| `05-structured-extraction.md` | Prompts, schema, evidence |
| `06-validation.md` | Business rules |
| `07-human-review.md` | Review UI/API |
| `08-registration.md` | PostgreSQL commit |
| `09-audit-traceability.md` | Artifacts, audit |
| `10-background-processing.md` | Jobs, worker |
| `11-security.md` | Threat controls |
| `12-testing-and-acceptance.md` | Test strategy |
| `13-sample-test-data.md` | Fixtures |

---

## Open requirements (decisions pending)

| ID | Topic | Spec reference |
|----|-------|----------------|
| D1 | Staged-only vs draft letter | 01, 08 |
| D2 | summary column on letter | 05, 08 |
| D3 | Permission key for AI registration | 07, 11 |
| D4 | Auto letter number generation | 06, 08 |
| D5 | Multilingual OCR | 02 |

Update this matrix when decisions close.
