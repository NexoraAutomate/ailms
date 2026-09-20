# Spec 04 — LLM Provider (vLLM / Qwen3-8B)

## A. Purpose

Provide a **model-provider abstraction** so FastAPI calls a local OpenAI-compatible vLLM server (default Qwen3-8B) without tight coupling; support health checks, timeouts, retries, and structured JSON extraction.

## B. Preconditions

- vLLM installed on developer machine (user confirmed).
- Network localhost access between FastAPI and vLLM.

## C. Inputs

- Environment configuration (see § Model configuration).
- Chat messages: system + user strings (user content is **document data**, not instructions).

## D. Processing

### Model acquisition & vLLM startup (one-time / per environment)

1. **Verify Hugging Face model id** at implementation time. Expected family: **Qwen3 8B** — commonly served as:
   - `Qwen/Qwen3-8B` or
   - `Qwen/Qwen3-8B-Instruct` (prefer Instruct for extraction tasks if available)
2. Download (optional pre-download):
   ```bash
   huggingface-cli download Qwen/Qwen3-8B
   ```
3. Start vLLM (use port **8001** — FastAPI uses 8000):
   ```bash
   vllm serve Qwen/Qwen3-8B --host 127.0.0.1 --port 8001
   ```
4. For structured JSON, disable Qwen3 “thinking” mode when supported:
   ```python
   extra_body={"chat_template_kwargs": {"enable_thinking": False}}
   ```
   (Wire through provider when calling httpx.)

### FastAPI communication

- Extend `llm_client.py` or new `ai/llm_provider.py`:
  - `class LlmProvider(Protocol): async def complete_json(...) -> dict`
  - Implementations: `OpenAiCompatibleProvider` (existing behavior), `VllmProvider` (same HTTP, different config rules).
- `llm_is_configured()`: treat `llm_provider in ("ollama", "vllm")` as configured when `llm_base_url` set (no cloud API key required). Dummy key `EMPTY` sent if vLLM expects Authorization header.

### Retries & timeouts

- Timeout: `LLM_TIMEOUT_SECONDS` (default 90; consider 120 for 8B on CPU).
- Retries: max 2 on 502/503/timeout with exponential backoff (1s, 3s) — **not** on 400/json parse failures.
- Logging: log model id, latency, token usage if returned; **never** log full document text at INFO (DEBUG gated by env `AI_LOG_DOCUMENT_TEXT=false` default).

### Structured JSON output

- Use `chat_json` pattern: system prompt requires single JSON object.
- Optional vLLM `guided_json` / JSON schema if enabled in vLLM version — **OPEN QUESTION** per installed vLLM version.

### Failure when vLLM unavailable

- Job stage fails with `error_code: LLM_UNAVAILABLE`.
- API health: `GET /api/ai/health/llm` → 503 with message.

## E. Outputs

- Parsed `dict` from model response.
- Health endpoint JSON: `{ "status": "ok"|"error", "provider", "model", "latencyMs" }`.

## F. Components

| File | Role |
|------|------|
| `backend/app/config.py` | `llm_provider`, optional `llm_extra_body_json` |
| `backend/app/llm_client.py` | HTTP client, retry |
| `backend/app/ai/llm_provider.py` | Abstraction + factory |
| `backend/scripts/verify_vllm.py` | Standalone verification |
| `backend/.env.example` | vLLM block |

## G. Data model

None for provider alone. Jobs store `model_id`, `model_config_json` snapshot at extraction time.

## H. API contract

| Endpoint | Method | Response |
|----------|--------|----------|
| `/api/ai/health/llm` | GET | Health probe |
| `/api/ai/status` | GET | Existing; include provider vllm |

## I. UI behavior

Register/upload screen shows badge: “LLM: connected” from `/api/ai/health/llm` or warning to start vLLM.

## J. Failure modes

- vLLM down → 503 health; jobs fail LLM stage
- Model timeout → retry then fail
- Invalid JSON → one repair prompt (“fix JSON only”); then fail
- Wrong model name → 503 from vLLM — surface clearly

## K. Security controls

- LLM endpoint URL allow-list: only `llm_base_url` host (default 127.0.0.1); reject SSRF configs in production review.
- No tool calling / function execution in vLLM request.
- API keys in env only, not in job records.

## L. Verification

### L1 — vLLM standalone

```bash
curl -s http://127.0.0.1:8001/v1/models | head
curl -s http://127.0.0.1:8001/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer EMPTY" \
  -d '{"model":"Qwen/Qwen3-8B","messages":[{"role":"user","content":"Reply with JSON only: {\"ok\": true}"}],"temperature":0}'
```

**Pass:** HTTP 200 and response contains `"ok"` or valid JSON.

### L2 — Application script

```bash
cd backend && python scripts/verify_vllm.py
```

**Pass:** exit code 0, prints model id and sample completion.

### L3 — FastAPI integration

```bash
curl -s http://127.0.0.1:8000/api/ai/health/llm
```

**Pass:** `"status":"ok"` with configured model.

### L4 — Unit test

```bash
python -m pytest backend/tests/test_llm_provider.py -k vllm_configured_without_api_key
```

## M. Acceptance criteria

1. With vLLM running Qwen3-8B on 8001, `verify_vllm.py` exits 0.
2. With `LLM_PROVIDER=vllm` and empty API key, `llm_is_configured()` returns True.
3. When vLLM stopped, health endpoint returns non-ok within timeout and does not hang indefinitely.

## Model configuration (.env example)

```env
LLM_ENABLED=true
LLM_PROVIDER=vllm
LLM_BASE_URL=http://127.0.0.1:8001/v1
LLM_API_KEY=EMPTY
LLM_MODEL=Qwen/Qwen3-8B
LLM_TIMEOUT_SECONDS=120
LLM_MAX_TOKENS=4096
```

**ASSUMPTION:** Model string must match vLLM `--served-model-name` (defaults to HF id).
