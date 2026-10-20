"""OpenAI-compatible embeddings client (OpenAI / Ollama / vLLM)."""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException

from app.config import Settings, get_settings

logger = logging.getLogger(__name__)

_LOCAL_PROVIDERS = frozenset({"ollama", "vllm"})


class EmbeddingNotConfiguredError(Exception):
    pass


class EmbeddingHostNotAllowedError(Exception):
    pass


def embeddings_are_configured(settings: Settings | None = None) -> bool:
    cfg = settings or get_settings()
    if not cfg.embedding_enabled:
        return False
    if not cfg.active_embedding_base_url or not cfg.active_embedding_model:
        return False
    provider = cfg.embedding_provider_key
    if provider in _LOCAL_PROVIDERS:
        return True
    return bool(cfg.active_embedding_api_key)


def allowed_embedding_hosts(settings: Settings | None = None) -> set[str]:
    cfg = settings or get_settings()
    raw = (cfg.active_embedding_allowed_hosts or "").strip()
    if not raw:
        return set()
    return {part.strip().lower() for part in raw.split(",") if part.strip()}


def assert_embedding_host_allowed(settings: Settings | None = None) -> None:
    cfg = settings or get_settings()
    allowed = allowed_embedding_hosts(cfg)
    if not allowed:
        return
    base = cfg.active_embedding_base_url
    if not base:
        return
    host = (urlparse(base).hostname or "").strip().lower()
    if not host or host not in allowed:
        raise EmbeddingHostNotAllowedError(
            f"Embedding host '{host or '(missing)'}' is not in EMBEDDING_ALLOWED_HOSTS"
        )


def _auth_header_value(settings: Settings) -> str | None:
    key = settings.active_embedding_api_key
    provider = settings.embedding_provider_key
    if key:
        return key
    if provider in _LOCAL_PROVIDERS:
        return "ollama" if provider == "ollama" else "EMPTY"
    return None


def _headers(settings: Settings) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    token = _auth_header_value(settings)
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _embeddings_url(settings: Settings) -> str:
    base = settings.active_embedding_base_url.rstrip("/")
    if base.endswith("/embeddings"):
        return base
    return f"{base}/embeddings"


async def embed_texts(texts: list[str], *, settings: Settings | None = None) -> list[list[float]]:
    """Embed one or more strings via OpenAI-compatible POST /v1/embeddings."""
    cfg = settings or get_settings()
    if not embeddings_are_configured(cfg):
        raise EmbeddingNotConfiguredError(
            "Embeddings not configured. Set EMBEDDING_ENABLED=true and "
            "EMBEDDING_PROVIDER (openai|ollama|vllm) with model/base URL."
        )
    cleaned = [((t or "").strip() or " ") for t in texts]
    if not cleaned:
        return []

    try:
        assert_embedding_host_allowed(cfg)
    except EmbeddingHostNotAllowedError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    url = _embeddings_url(cfg)
    payload: dict[str, Any] = {
        "model": cfg.active_embedding_model,
        "input": cleaned if len(cleaned) > 1 else cleaned[0],
    }
    timeout = httpx.Timeout(cfg.embedding_timeout_seconds)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(url, headers=_headers(cfg), json=payload)
    except httpx.HTTPError as exc:
        logger.exception("Embedding request failed")
        raise HTTPException(status_code=503, detail=f"Embedding provider error: {exc}") from exc

    if response.status_code >= 400:
        detail = response.text[:500]
        logger.error("Embedding HTTP %s: %s", response.status_code, detail)
        raise HTTPException(
            status_code=503,
            detail=f"Embedding provider returned {response.status_code}",
        )

    data = response.json()
    items = data.get("data") or []
    # OpenAI returns objects with index; sort to preserve order.
    ordered = sorted(items, key=lambda row: int(row.get("index", 0)))
    vectors: list[list[float]] = []
    for row in ordered:
        emb = row.get("embedding")
        if not isinstance(emb, list):
            raise HTTPException(status_code=503, detail="Invalid embedding response shape")
        vectors.append([float(x) for x in emb])

    if len(vectors) != len(cleaned):
        raise HTTPException(
            status_code=503,
            detail=f"Expected {len(cleaned)} embeddings, got {len(vectors)}",
        )

    expected_dim = int(cfg.embedding_dimensions)
    if vectors and len(vectors[0]) != expected_dim:
        logger.warning(
            "Embedding dim mismatch: got %s, EMBEDDING_DIMENSIONS=%s (model=%s)",
            len(vectors[0]),
            expected_dim,
            cfg.active_embedding_model,
        )
    return vectors


async def embed_query(text: str, *, settings: Settings | None = None) -> list[float]:
    vectors = await embed_texts([text], settings=settings)
    return vectors[0]
