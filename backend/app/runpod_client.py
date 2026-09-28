"""Runpod Serverless queue-based vLLM client (/run, /runsync, /status)."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx
from fastapi import HTTPException

from app.config import Settings, get_settings

logger = logging.getLogger(__name__)

_API_BASE = "https://api.runpod.ai/v2"
_TERMINAL_OK = frozenset({"COMPLETED"})
_TERMINAL_FAIL = frozenset({"FAILED", "CANCELLED", "TIMED_OUT"})


def runpod_is_configured(settings: Settings | None = None) -> bool:
    cfg = settings or get_settings()
    return bool(cfg.runpod_api_key.strip() and cfg.runpod_endpoint_id.strip())


def _endpoint_base(settings: Settings) -> str:
    endpoint_id = settings.runpod_endpoint_id.strip()
    return f"{_API_BASE}/{endpoint_id}"


def _headers(settings: Settings) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.runpod_api_key.strip()}",
        "Content-Type": "application/json",
    }


def _job_payload(
    *,
    system: str,
    user: str,
    temperature: float,
    max_tokens: int,
    settings: Settings,
) -> dict[str, Any]:
    # executionTimeout/ttl in ms — leave room for cold start + long extractions.
    wait_ms = max(60_000, int(settings.runpod_max_wait_seconds * 1000))
    return {
        "input": {
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "sampling_params": {
                "temperature": temperature,
                "max_tokens": max_tokens,
            },
        },
        "policy": {
            "executionTimeout": wait_ms,
            "ttl": wait_ms + 600_000,
        },
    }


def _join_tokens(tokens: Any) -> str | None:
    if isinstance(tokens, str):
        return tokens
    if isinstance(tokens, list):
        parts = [str(t) for t in tokens if t is not None]
        if not parts:
            return None
        # Prefer concatenation without spaces when pieces look like subword tokens.
        if all(isinstance(t, str) for t in tokens):
            joined = "".join(parts)
            if joined.strip():
                return joined
        return " ".join(parts)
    return None


def extract_text_from_runpod_output(output: Any) -> str:
    """Parse Runpod job ``output`` including RAW_OPENAI_OUTPUT shapes."""
    if output is None:
        raise ValueError("Runpod output is empty")

    if isinstance(output, str):
        text = output.strip()
        if text:
            return text
        raise ValueError("Runpod output string is empty")

    if isinstance(output, list):
        if not output:
            raise ValueError("Runpod output list is empty")
        # Prefer first non-empty extraction from list items.
        errors: list[str] = []
        for item in output:
            try:
                return extract_text_from_runpod_output(item)
            except ValueError as exc:
                errors.append(str(exc))
        raise ValueError(errors[0] if errors else "Runpod output list had no text")

    if not isinstance(output, dict):
        raise ValueError(f"Unsupported Runpod output type: {type(output).__name__}")

    # OpenAI chat-style: choices[0].message.content
    choices = output.get("choices")
    if isinstance(choices, list) and choices:
        first = choices[0]
        if isinstance(first, dict):
            message = first.get("message")
            if isinstance(message, dict):
                content = message.get("content")
                if isinstance(content, str) and content.strip():
                    return content
                if isinstance(content, list):
                    # Multimodal content parts
                    parts = [
                        str(p.get("text") if isinstance(p, dict) else p)
                        for p in content
                        if p is not None
                    ]
                    joined = "".join(parts).strip()
                    if joined:
                        return joined
            text = first.get("text")
            if isinstance(text, str) and text.strip():
                return text
            tokens = _join_tokens(first.get("tokens"))
            if tokens and tokens.strip():
                return tokens

    # Direct text / tokens fields on the object
    for key in ("text", "content", "response", "generated_text"):
        value = output.get(key)
        if isinstance(value, str) and value.strip():
            return value

    tokens = _join_tokens(output.get("tokens"))
    if tokens and tokens.strip():
        return tokens

    # Nested output (some workers wrap again)
    nested = output.get("output")
    if nested is not None and nested is not output:
        return extract_text_from_runpod_output(nested)

    raise ValueError("Could not extract text from Runpod output")


def _raise_http(detail: str, status_code: int = 503) -> None:
    raise HTTPException(status_code=status_code, detail=detail)


async def _wait_for_job(
    client: httpx.AsyncClient,
    *,
    settings: Settings,
    job_id: str,
) -> dict[str, Any]:
    status_url = f"{_endpoint_base(settings)}/status/{job_id}"
    deadline = time.perf_counter() + max(1, settings.runpod_max_wait_seconds)
    interval = max(0.2, settings.runpod_poll_interval_seconds)

    while True:
        try:
            response = await client.get(status_url, headers=_headers(settings))
        except httpx.RequestError as exc:
            _raise_http(f"Runpod status request failed: {exc}")

        if response.status_code >= 400:
            _raise_http(
                f"Runpod status error ({response.status_code}): {response.text[:400]}"
            )

        data = response.json()
        if not isinstance(data, dict):
            _raise_http("Runpod status returned unexpected JSON")

        status = str(data.get("status") or "").upper()
        if status in _TERMINAL_OK:
            return data
        if status in _TERMINAL_FAIL:
            err = data.get("error") or data.get("output") or status
            _raise_http(f"Runpod job {status}: {err}")

        if time.perf_counter() >= deadline:
            _raise_http(
                f"Runpod job timed out after {settings.runpod_max_wait_seconds}s "
                f"(last status={status or 'unknown'}, id={job_id}). "
                "Cold starts for large models can exceed this — raise RUNPOD_MAX_WAIT_SECONDS "
                "or set endpoint min workers > 0."
            )
        logger.debug("Runpod job id=%s status=%s", job_id, status or "unknown")
        await asyncio.sleep(interval)


async def chat_completion_runpod(
    *,
    system: str,
    user: str,
    temperature: float = 0.2,
    max_tokens: int | None = None,
) -> str:
    settings = get_settings()
    if not runpod_is_configured(settings):
        _raise_http("Runpod is not configured (RUNPOD_API_KEY / RUNPOD_ENDPOINT_ID)")

    token_limit = max_tokens if max_tokens is not None else settings.llm_max_tokens
    payload = _job_payload(
        system=system,
        user=user,
        temperature=temperature,
        max_tokens=token_limit,
        settings=settings,
    )
    base = _endpoint_base(settings)
    # Cold starts + generation can exceed local Ollama defaults.
    timeout = httpx.Timeout(
        connect=30.0,
        read=max(float(settings.llm_timeout_seconds), float(settings.runpod_max_wait_seconds), 60.0),
        write=60.0,
        pool=30.0,
    )
    started = time.perf_counter()
    use_async = settings.runpod_use_async

    async with httpx.AsyncClient(timeout=timeout) as client:
        if use_async:
            try:
                response = await client.post(
                    f"{base}/run", headers=_headers(settings), json=payload
                )
            except httpx.RequestError as exc:
                raise HTTPException(
                    status_code=503, detail=f"Runpod request failed: {exc}"
                ) from exc

            if response.status_code >= 400:
                raise HTTPException(
                    status_code=503,
                    detail=f"Runpod error ({response.status_code}): {response.text[:400]}",
                )

            submit = response.json()
            job_id = str(submit.get("id") or "").strip()
            if not job_id:
                raise HTTPException(
                    status_code=503, detail="Runpod /run did not return a job id"
                )
            logger.info(
                "Runpod job submitted id=%s status=%s (polling up to %ss for cold start)",
                job_id,
                submit.get("status"),
                settings.runpod_max_wait_seconds,
            )
            data = await _wait_for_job(client, settings=settings, job_id=job_id)
        else:
            try:
                response = await client.post(
                    f"{base}/runsync", headers=_headers(settings), json=payload
                )
            except httpx.RequestError as exc:
                raise HTTPException(
                    status_code=503, detail=f"Runpod request failed: {exc}"
                ) from exc

            if response.status_code >= 400:
                raise HTTPException(
                    status_code=503,
                    detail=f"Runpod error ({response.status_code}): {response.text[:400]}",
                )

            data = response.json()
            if not isinstance(data, dict):
                raise HTTPException(
                    status_code=503, detail="Runpod returned unexpected JSON"
                )

            status = str(data.get("status") or "").upper()
            if status in _TERMINAL_FAIL:
                err = data.get("error") or data.get("output") or status
                raise HTTPException(status_code=503, detail=f"Runpod job {status}: {err}")
            if status and status not in _TERMINAL_OK:
                # runsync sometimes returns IN_PROGRESS with an id — finish via status poll.
                job_id = str(data.get("id") or "").strip()
                if job_id:
                    logger.info(
                        "Runpod runsync returned status=%s id=%s; continuing via /status poll",
                        status,
                        job_id,
                    )
                    data = await _wait_for_job(client, settings=settings, job_id=job_id)
                else:
                    raise HTTPException(
                        status_code=503,
                        detail=f"Runpod job not completed (status={status})",
                    )

        latency_ms = int((time.perf_counter() - started) * 1000)
        try:
            text = extract_text_from_runpod_output(data.get("output"))
        except ValueError as exc:
            raise HTTPException(
                status_code=503,
                detail=f"Runpod returned an unexpected response shape: {exc}",
            ) from exc

        logger.info(
            "Runpod completion endpoint=%s model=%s latencyMs=%d status=%s",
            settings.runpod_endpoint_id,
            settings.llm_model,
            latency_ms,
            data.get("status"),
        )
        return text


async def probe_runpod_health() -> dict[str, Any]:
    """Probe Runpod endpoint health (GET /health)."""
    settings = get_settings()
    provider = "runpod"
    model = settings.llm_model
    if not runpod_is_configured(settings):
        return {
            "status": "error",
            "provider": provider,
            "model": model,
            "latencyMs": 0,
            "detail": "Runpod is not configured (RUNPOD_API_KEY / RUNPOD_ENDPOINT_ID)",
            "errorCode": "LLM_NOT_CONFIGURED",
            "endpointId": settings.runpod_endpoint_id,
        }

    url = f"{_endpoint_base(settings)}/health"
    timeout = httpx.Timeout(min(max(settings.llm_timeout_seconds, 10.0), 60.0))
    started = time.perf_counter()

    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            response = await client.get(url, headers=_headers(settings))
        except httpx.RequestError as exc:
            return {
                "status": "error",
                "provider": provider,
                "model": model,
                "latencyMs": int((time.perf_counter() - started) * 1000),
                "detail": f"Runpod unreachable: {exc}",
                "errorCode": "LLM_UNAVAILABLE",
                "endpointId": settings.runpod_endpoint_id,
            }

        latency_ms = int((time.perf_counter() - started) * 1000)
        if response.status_code >= 400:
            return {
                "status": "error",
                "provider": provider,
                "model": model,
                "latencyMs": latency_ms,
                "detail": f"Runpod health error ({response.status_code}): {response.text[:200]}",
                "errorCode": "LLM_UNAVAILABLE",
                "endpointId": settings.runpod_endpoint_id,
            }

        return {
            "status": "ok",
            "provider": provider,
            "model": model,
            "latencyMs": latency_ms,
            "endpointId": settings.runpod_endpoint_id,
        }
