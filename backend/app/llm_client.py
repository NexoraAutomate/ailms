"""OpenAI-compatible chat completions client (OpenAI, Azure, Ollama, etc.)."""

from __future__ import annotations

import json
import re
from typing import Any

import httpx
from fastapi import HTTPException

from app.config import get_settings


class LlmNotConfiguredError(Exception):
    pass


def llm_is_configured() -> bool:
    settings = get_settings()
    if not settings.llm_enabled:
        return False
    if settings.llm_provider == "ollama":
        return bool(settings.llm_base_url.strip())
    return bool(settings.llm_api_key.strip())


def _headers() -> dict[str, str]:
    settings = get_settings()
    headers = {"Content-Type": "application/json"}
    if settings.llm_api_key:
        headers["Authorization"] = f"Bearer {settings.llm_api_key}"
    return headers


def _extract_json(text: str) -> Any:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", text)
        if match:
            return json.loads(match.group(0))
        raise


async def chat_completion(
    *,
    system: str,
    user: str,
    temperature: float = 0.2,
    max_tokens: int | None = None,
) -> str:
    settings = get_settings()
    if not llm_is_configured():
        raise LlmNotConfiguredError("LLM is not configured")

    url = f"{settings.llm_base_url.rstrip('/')}/chat/completions"
    payload: dict[str, Any] = {
        "model": settings.llm_model,
        "temperature": temperature,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    if max_tokens is not None:
        payload["max_tokens"] = max_tokens

    timeout = httpx.Timeout(settings.llm_timeout_seconds)
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            response = await client.post(url, headers=_headers(), json=payload)
        except httpx.RequestError as exc:
            raise HTTPException(status_code=503, detail=f"LLM request failed: {exc}") from exc

    if response.status_code >= 400:
        raise HTTPException(status_code=503, detail=f"LLM error ({response.status_code}): {response.text[:400]}")

    data = response.json()
    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=503, detail="LLM returned an unexpected response shape") from exc


async def chat_json(*, system: str, user: str, temperature: float = 0.15) -> Any:
    settings = get_settings()
    content = await chat_completion(
        system=f"{system}\n\nRespond with a single valid JSON object only. No markdown fences or commentary.",
        user=user,
        temperature=temperature,
        max_tokens=settings.llm_max_tokens,
    )
    try:
        return _extract_json(content)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=503, detail="LLM did not return valid JSON") from exc
