"""Lightweight query router for hybrid RAG modes."""

from __future__ import annotations

import re
from enum import Enum

_LETTER_NUMBER_RE = re.compile(
    r"\b(?:letter\s*(?:no\.?|number|#)?\s*)?([A-Z]{1,6}[-/]?\d{2,6}(?:[-/]\d{1,6})?)\b",
    re.IGNORECASE,
)
_EXACT_PHRASE_RE = re.compile(r'^["\']([^"\']{2,80})["\']$')
_NL_HINT_RE = re.compile(
    r"\b(?:about|regarding|related|concerning|pertaining|summar(?:y|ise|ize)|"
    r"what|which|find|search|any|letters?|correspondence)\b",
    re.IGNORECASE,
)


class RetrievalMode(str, Enum):
    KEYWORD = "keyword"
    SEMANTIC = "semantic"
    HYBRID = "hybrid"


def extract_letter_number_hints(query: str) -> list[str]:
    return [m.group(1).strip() for m in _LETTER_NUMBER_RE.finditer(query or "")]


def route_query(query: str) -> RetrievalMode:
    """Heuristics: exact refs → keyword; natural language → hybrid; else hybrid."""
    q = (query or "").strip()
    if not q:
        return RetrievalMode.HYBRID

    if _EXACT_PHRASE_RE.match(q):
        return RetrievalMode.KEYWORD

    # Short queries that look like letter numbers / codes.
    if len(q.split()) <= 3 and extract_letter_number_hints(q):
        return RetrievalMode.KEYWORD

    # Pure alphanumeric id-like token.
    if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9./_-]{2,40}", q) and not _NL_HINT_RE.search(q):
        return RetrievalMode.KEYWORD

    if _NL_HINT_RE.search(q) or len(q.split()) >= 4:
        return RetrievalMode.HYBRID

    return RetrievalMode.HYBRID
