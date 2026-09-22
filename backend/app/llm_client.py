"""OpenAI-compatible chat completions client (Ollama, OpenAI, Azure, optional vLLM)."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from typing import Any

import httpx
from fastapi import HTTPException

from app.config import get_settings

logger = logging.getLogger(__name__)

# Local OpenAI-compatible runtimes do not require a cloud API key.
_LOCAL_PROVIDERS = frozenset({"ollama", "vllm"})
_RETRY_STATUS = frozenset({502, 503})
_RETRY_BACKOFF_SECONDS = (1.0, 3.0)
_MAX_ATTEMPTS = 1 + len(_RETRY_BACKOFF_SECONDS)


class LlmNotConfiguredError(Exception):
    pass


def llm_is_configured() -> bool:
    settings = get_settings()
    if not settings.llm_enabled:
        return False
    provider = settings.llm_provider.strip().lower()
    if provider in _LOCAL_PROVIDERS:
        return bool(settings.llm_base_url.strip())
    return bool(settings.llm_api_key.strip())


def _auth_header_value() -> str | None:
    """Return Authorization bearer token, or None if omitted.

    Local providers accept a dummy key (``ollama`` / ``EMPTY``) when the server
    expects an Authorization header; empty key still sends a local default.
    """
    settings = get_settings()
    key = settings.llm_api_key.strip()
    provider = settings.llm_provider.strip().lower()
    if key:
        return key
    if provider in _LOCAL_PROVIDERS:
        return "ollama" if provider == "ollama" else "EMPTY"
    return None


def _headers() -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    token = _auth_header_value()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _extra_body() -> dict[str, Any]:
    settings = get_settings()
    raw = settings.llm_extra_body_json.strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("LLM_EXTRA_BODY_JSON is not valid JSON; ignoring")
        return {}
    if not isinstance(parsed, dict):
        logger.warning("LLM_EXTRA_BODY_JSON must be a JSON object; ignoring")
        return {}
    return parsed


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


def _log_prompt_preview(system: str, user: str) -> None:
    settings = get_settings()
    if settings.ai_log_document_text:
        logger.debug("LLM system (%d chars): %s", len(system), system[:500])
        logger.debug("LLM user (%d chars): %s", len(user), user[:500])
    else:
        logger.debug("LLM prompt sizes: system=%d user=%d chars", len(system), len(user))


def _is_retryable_request_error(exc: Exception) -> bool:
    return isinstance(exc, (httpx.TimeoutException, httpx.NetworkError, httpx.RemoteProtocolError))


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
    payload.update(_extra_body())

    _log_prompt_preview(system, user)
    timeout = httpx.Timeout(settings.llm_timeout_seconds)
    last_error: Exception | HTTPException | None = None

    async with httpx.AsyncClient(timeout=timeout) as client:
        for attempt in range(_MAX_ATTEMPTS):
            started = time.perf_counter()
            try:
                response = await client.post(url, headers=_headers(), json=payload)
            except httpx.RequestError as exc:
                last_error = exc
                if attempt < _MAX_ATTEMPTS - 1 and _is_retryable_request_error(exc):
                    delay = _RETRY_BACKOFF_SECONDS[attempt]
                    logger.warning(
                        "LLM request error (attempt %d/%d): %s; retrying in %.1fs",
                        attempt + 1,
                        _MAX_ATTEMPTS,
                        exc,
                        delay,
                    )
                    await asyncio.sleep(delay)
                    continue
                raise HTTPException(status_code=503, detail=f"LLM request failed: {exc}") from exc

            latency_ms = int((time.perf_counter() - started) * 1000)

            if response.status_code in _RETRY_STATUS and attempt < _MAX_ATTEMPTS - 1:
                delay = _RETRY_BACKOFF_SECONDS[attempt]
                logger.warning(
                    "LLM HTTP %s (attempt %d/%d); retrying in %.1fs",
                    response.status_code,
                    attempt + 1,
                    _MAX_ATTEMPTS,
                    delay,
                )
                await asyncio.sleep(delay)
                continue

            if response.status_code >= 400:
                raise HTTPException(
                    status_code=503,
                    detail=f"LLM error ({response.status_code}): {response.text[:400]}",
                )

            data = response.json()
            usage = data.get("usage") if isinstance(data, dict) else None
            logger.info(
                "LLM completion model=%s provider=%s latencyMs=%d usage=%s",
                settings.llm_model,
                settings.llm_provider,
                latency_ms,
                usage,
            )
            try:
                return data["choices"][0]["message"]["content"]
            except (KeyError, IndexError, TypeError) as exc:
                raise HTTPException(
                    status_code=503,
                    detail="LLM returned an unexpected response shape",
                ) from exc

    if isinstance(last_error, HTTPException):
        raise last_error
    raise HTTPException(status_code=503, detail=f"LLM request failed: {last_error}")


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
    except json.JSONDecodeError:
        # One repair attempt — not retried for parse failures on the first call's HTTP layer.
        repair = await chat_completion(
            system=(
                "Fix the following into a single valid JSON object only. "
                "No markdown fences, commentary, or thinking tags."
            ),
            user=content,
            temperature=0.0,
            max_tokens=settings.llm_max_tokens,
        )
        try:
            return _extract_json(repair)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=503, detail="LLM did not return valid JSON") from exc


async def probe_llm_health() -> dict[str, Any]:
    """Lightweight health probe against the configured OpenAI-compatible base URL.

    Prefers ``GET /models``; falls back to a tiny chat completion if models is unavailable.
    """
    settings = get_settings()
    provider = settings.llm_provider.strip().lower()
    model = settings.llm_model
    if not llm_is_configured():
        return {
            "status": "error",
            "provider": provider,
            "model": model,
            "latencyMs": 0,
            "detail": "LLM is not configured",
        }

    base = settings.llm_base_url.rstrip("/")
    timeout = httpx.Timeout(min(settings.llm_timeout_seconds, 30.0))
    started = time.perf_counter()

    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            models_resp = await client.get(f"{base}/models", headers=_headers())
        except httpx.RequestError as exc:
            latency_ms = int((time.perf_counter() - started) * 1000)
            return {
                "status": "error",
                "provider": provider,
                "model": model,
                "latencyMs": latency_ms,
                "detail": f"LLM unreachable: {exc}",
                "errorCode": "LLM_UNAVAILABLE",
            }

        latency_ms = int((time.perf_counter() - started) * 1000)
        if models_resp.status_code < 400:
            return {
                "status": "ok",
                "provider": provider,
                "model": model,
                "latencyMs": latency_ms,
            }

        # Some local servers omit /models; try a minimal completion.
        try:
            chat_resp = await client.post(
                f"{base}/chat/completions",
                headers=_headers(),
                json={
                    "model": model,
                    "temperature": 0,
                    "max_tokens": 8,
                    "messages": [{"role": "user", "content": 'Reply with JSON only: {"ok": true}'}],
                },
            )
        except httpx.RequestError as exc:
            return {
                "status": "error",
                "provider": provider,
                "model": model,
                "latencyMs": int((time.perf_counter() - started) * 1000),
                "detail": f"LLM unreachable: {exc}",
                "errorCode": "LLM_UNAVAILABLE",
            }

        latency_ms = int((time.perf_counter() - started) * 1000)
        if chat_resp.status_code >= 400:
            return {
                "status": "error",
                "provider": provider,
                "model": model,
                "latencyMs": latency_ms,
                "detail": f"LLM error ({chat_resp.status_code}): {chat_resp.text[:200]}",
                "errorCode": "LLM_UNAVAILABLE",
            }
        return {
            "status": "ok",
            "provider": provider,
            "model": model,
            "latencyMs": latency_ms,
        }
