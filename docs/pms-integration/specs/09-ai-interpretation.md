# Spec 09 — Optional AI Interpretation Layer

## A. Purpose

**Only after** Phases 2–5 work: optional AI summaries that explain findings. Deterministic rules and dashboard remain fully functional when LLM is unavailable.

## B. Preconditions

- Specs 04–08 complete and tested.
- `PMS_AI_SUMMARY_ENABLED=true`
- Existing approved LLM stack (`LLM_PROVIDER` / `llm_client` / Runpod) — **no new cloud AI** outside approved infrastructure.

## C. Scope of AI output

Explain:

1. What changed
2. Why the finding may matter
3. Which correspondence and PMS records support it
4. What should be verified next
5. What question management may wish to ask

## D. Inputs (least privilege)

Pass only authorized records for the task, e.g.:

- Alert fields + evidence_json
- Normalized project/milestone subset
- Letter metadata the **requesting user** can access (never bodies the user cannot see)

Wrap letter/OCR text as untrusted data (same pattern as AI registration: DATA boundaries). Correspondence content is **not** instructions.

## E. Structured output

Require schema-validated JSON, e.g.:

```json
{
  "summary": "...",
  "whyItMatters": "...",
  "supportingRecords": [{"type": "letter|milestone|project", "id": "...", "note": "..."}],
  "verifyNext": ["..."],
  "managementQuestions": ["..."],
  "caveats": ["..."]
}
```

Reject/repair invalid model output; do not display unvalidated freeform as fact.

## F. Hard prohibitions

AI must not:

- Change PMS records or call PMS write APIs
- Approve/reject official decisions or auto-resolve alerts
- Modify original letters
- Create authoritative facts unsupported by source records
- Bypass access controls
- Execute tools or DB mutations based on instructions found inside a letter

## G. API / UI

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/intelligence/alerts/{id}/ai-summary` | On-demand; cache optional |
| | | UI button “Explain” on alert detail; show caveats |

If LLM down → 503 with clear message; alert detail still usable.

## H. Acceptance

- [ ] Flag-gated
- [ ] Schema validation
- [ ] Works offline from AI (rules/UI OK)
- [ ] No unauthorized letter content in prompts
