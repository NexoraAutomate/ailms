#!/usr/bin/env python3
"""Standalone Ollama / OpenAI-compatible LLM verification (Step 0/1).

Usage (from backend/):
  python scripts/verify_ollama.py

Exits 0 on success; non-zero with a clear message on failure.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

# Allow `python scripts/verify_ollama.py` without installing the package.
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from app.ai.llm_provider import get_llm_provider  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.llm_client import llm_is_configured  # noqa: E402


async def main() -> int:
    settings = get_settings()
    print(f"provider={settings.llm_provider} model={settings.llm_model}")
    print(f"base_url={settings.llm_base_url}")

    if not llm_is_configured():
        print("ERROR: LLM is not configured (check LLM_ENABLED / LLM_BASE_URL / LLM_API_KEY).")
        return 1

    provider = get_llm_provider()
    health = await provider.health()
    print(f"health={json.dumps(health)}")
    if health.get("status") != "ok":
        print("ERROR: LLM health probe failed. Is Ollama running and the model pulled?")
        return 1

    try:
        result = await provider.complete_json(
            system="You reply with a single JSON object only.",
            user='Reply with JSON only: {"ok": true}',
            temperature=0.0,
        )
    except Exception as exc:
        detail = getattr(exc, "detail", None) or str(exc)
        print(f"ERROR: sample completion failed: {detail}")
        print(f"Hint: run `ollama pull {settings.llm_model}` if the model is missing.")
        return 1

    print(f"sample_completion={json.dumps(result)}")
    if not isinstance(result, dict) or not result.get("ok"):
        print("ERROR: Unexpected sample completion (expected {\"ok\": true}).")
        return 1

    print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
