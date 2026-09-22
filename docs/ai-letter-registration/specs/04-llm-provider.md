# Spec 04 — LLM Provider (Ollama / Qwen)

## A. Purpose

Provide a **model-provider abstraction** so FastAPI calls a local OpenAI-compatible **Ollama** server (default Qwen family, e.g. `qwen2.5:7b`) without tight coupling; support health checks, timeouts, retries, and structured JSON extraction.

**Default runtime:** Ollama on Windows (or Linux) with NVIDIA GPU — preferred for this project because it avoids WSL-native vLLM setup.

**Optional alternate:** vLLM remains supported via the same OpenAI-compatible client (`LLM_PROVIDER=vllm`) if a working Linux/WSL CUDA environment is available later.

## B. Preconditions

- Ollama installed on the developer machine ([ollama.com](https://ollama.com)).
- Network localhost access between FastAPI and Ollama (default port **11434**).
- GPU optional but recommended (e.g. RTX 4070 Ti 12 GB); CPU works with longer timeouts.

## C. Inputs

- Environment configuration (see § Model configuration).
- Chat messages: system + user strings (user content is **document data**, not instructions).

## D. Processing

### Model acquisition & Ollama startup (one-time / per environment)

1. **Install Ollama** for the host OS (Windows native is the supported path for this plan).
2. **Choose a model tag** that fits local VRAM. Recommended defaults:
   - `qwen2.5:7b` — solid JSON extraction; fits ~12 GB VRAM comfortably
   - `qwen3:8b` (or newer Qwen3 tags on the Ollama library) — use if available and it fits after pull
   - Smaller tags (`qwen2.5:3b`) acceptable for smoke tests only
3. Pull and verify:
   ```bash
   ollama pull qwen2.5:7b
   ollama list
   ```
4. Ollama serves OpenAI-compatible APIs at `http://127.0.0.1:11434/v1` when the app is running (Windows tray / background service is typical). Explicit serve is usually unnecessary after install.
5. For structured JSON: system prompt requires a single JSON object; use low `temperature` (0–0.2). If a Qwen3 “thinking” tag pollutes output, prefer Instruct/`qwen2.5` tags or strip non-JSON via the existing `chat_json` repair path.

### FastAPI communication

- Extend `llm_client.py` or new `ai/llm_provider.py`:
  - `class LlmProvider(Protocol): async def complete_json(...) -> dict`
  - Implementations: `OpenAiCompatibleProvider` (existing behavior); Ollama and optional vLLM share the same HTTP path with different config rules.
- `llm_is_configured()`: treat `llm_provider in ("ollama", "vllm")` as configured when `llm_base_url` set (no cloud API key required). Dummy key `ollama` or `EMPTY` sent if the server expects an Authorization header.

### Retries & timeouts

- Timeout: `LLM_TIMEOUT_SECONDS` (default 90; consider 120 for larger models on CPU).
- Retries: max 2 on 502/503/timeout with exponential backoff (1s, 3s) — **not** on 400/json parse failures.
- Logging: log model id, latency, token usage if returned; **never** log full document text at INFO (DEBUG gated by env `AI_LOG_DOCUMENT_TEXT=false` default).

### Structured JSON output

- Use `chat_json` pattern: system prompt requires single JSON object.
- Optional provider-specific guided JSON (Ollama format / vLLM `guided_json`) — **OPEN QUESTION** per installed runtime version; not required for phase 1 if repair pass exists.

### Failure when Ollama unavailable

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
| `backend/scripts/verify_ollama.py` | Standalone verification |
| `backend/.env.example` | Ollama block (default); optional vLLM commented |

## G. Data model

None for provider alone. Jobs store `model_id`, `model_config_json` snapshot at extraction time.

## H. API contract

| Endpoint | Method | Response |
|----------|--------|----------|
| `/api/ai/health/llm` | GET | Health probe |
| `/api/ai/status` | GET | Existing; include provider `ollama` |

## I. UI behavior

Register/upload screen shows badge: “LLM: connected” from `/api/ai/health/llm` or warning to start Ollama / pull the model.

## J. Failure modes

- Ollama down → 503 health; jobs fail LLM stage
- Model timeout → retry then fail
- Invalid JSON → one repair prompt (“fix JSON only”); then fail
- Wrong model name / not pulled → clear error from Ollama — surface clearly

## K. Security controls

- LLM endpoint URL allow-list: only `llm_base_url` host (default 127.0.0.1); reject SSRF configs in production review.
- No tool calling / function execution in LLM request.
- API keys in env only, not in job records.
- Prefer localhost bind; do not expose Ollama on LAN without auth for phase 1.

## L. Verification

### L1 — Ollama standalone

```bash
curl -s http://127.0.0.1:11434/v1/models | head
curl -s http://127.0.0.1:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen2.5:7b","messages":[{"role":"user","content":"Reply with JSON only: {\"ok\": true}"}],"temperature":0}'
```

**Pass:** HTTP 200 and response contains `"ok"` or valid JSON.

### L2 — Application script

```bash
cd backend && python scripts/verify_ollama.py
```

**Pass:** exit code 0, prints model id and sample completion.

### L3 — FastAPI integration

```bash
curl -s http://127.0.0.1:8000/api/ai/health/llm
```

**Pass:** `"status":"ok"` with configured model.

### L4 — Unit test

```bash
python -m pytest backend/tests/test_llm_provider.py -k ollama_configured_without_api_key
```

## M. Acceptance criteria

1. With Ollama running and the configured model pulled, `verify_ollama.py` exits 0.
2. With `LLM_PROVIDER=ollama` and empty/dummy API key, `llm_is_configured()` returns True.
3. When Ollama is stopped, health endpoint returns non-ok within timeout and does not hang indefinitely.

## Model configuration (.env example)

```env
LLM_ENABLED=true
LLM_PROVIDER=ollama
LLM_BASE_URL=http://127.0.0.1:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=qwen2.5:7b
LLM_TIMEOUT_SECONDS=120
LLM_MAX_TOKENS=4096
```

**ASSUMPTION:** `LLM_MODEL` must match an Ollama tag from `ollama list` (e.g. `qwen2.5:7b`).

### Optional: vLLM alternate (.env)

```env
# LLM_PROVIDER=vllm
# LLM_BASE_URL=http://127.0.0.1:8001/v1
# LLM_API_KEY=EMPTY
# LLM_MODEL=Qwen/Qwen3-8B
```

Use only when vLLM runs successfully (typically Linux/WSL2 with working CUDA). Keep FastAPI on 8000; bind vLLM to 8001+.
