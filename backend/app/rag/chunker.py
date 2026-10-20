"""Split letter subject + body into overlapping text chunks for embedding."""

from __future__ import annotations

import hashlib
import re

from app.config import get_settings

_WS_RE = re.compile(r"[ \t]+")


def content_hash(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def _normalize(text: str) -> str:
    lines = [(line or "").strip() for line in (text or "").replace("\r\n", "\n").split("\n")]
    collapsed = "\n".join(line for line in lines if line)
    return _WS_RE.sub(" ", collapsed).strip()


def build_letter_source_text(*, subject: str = "", body_text: str = "", number: str = "") -> str:
    parts: list[str] = []
    if number and number.strip():
        parts.append(f"Letter number: {number.strip()}")
    if subject and subject.strip():
        parts.append(f"Subject: {subject.strip()}")
    body = (body_text or "").strip()
    if body:
        parts.append(body)
    return _normalize("\n\n".join(parts))


def chunk_text(
    text: str,
    *,
    chunk_size: int | None = None,
    overlap: int | None = None,
) -> list[str]:
    """Character-window chunking with overlap (approx token-sized for English)."""
    cfg = get_settings()
    size = int(chunk_size if chunk_size is not None else cfg.rag_chunk_size)
    ov = int(overlap if overlap is not None else cfg.rag_chunk_overlap)
    size = max(200, size)
    ov = max(0, min(ov, size // 2))

    source = _normalize(text)
    if not source:
        return []
    if len(source) <= size:
        return [source]

    chunks: list[str] = []
    start = 0
    length = len(source)
    while start < length:
        end = min(start + size, length)
        # Prefer breaking on paragraph / sentence boundaries near the window end.
        if end < length:
            window = source[start:end]
            break_at = max(window.rfind("\n\n"), window.rfind(". "), window.rfind("\n"))
            if break_at >= size // 3:
                end = start + break_at + 1
        piece = source[start:end].strip()
        if piece:
            chunks.append(piece)
        if end >= length:
            break
        start = max(end - ov, start + 1)
    return chunks


def chunk_letter(
    *,
    subject: str = "",
    body_text: str = "",
    number: str = "",
    chunk_size: int | None = None,
    overlap: int | None = None,
) -> list[str]:
    source = build_letter_source_text(subject=subject, body_text=body_text, number=number)
    return chunk_text(source, chunk_size=chunk_size, overlap=overlap)
