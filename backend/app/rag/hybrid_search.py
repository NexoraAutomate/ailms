"""Hybrid keyword + vector retrieval with Reciprocal Rank Fusion."""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.letter_access import is_administrator, owned_letter_filter, resolve_user_role
from app.models import Letter
from app.rag.embed_client import embed_query, embeddings_are_configured
from app.rag.router import RetrievalMode, extract_letter_number_hints, route_query
from app.services import current_user_name, serialize_letter

logger = logging.getLogger(__name__)


def rrf_fuse(
    ranked_lists: list[list[int]],
    *,
    k: int = 60,
    limit: int = 20,
) -> list[int]:
    """Reciprocal Rank Fusion over ranked letter-id lists."""
    scores: dict[int, float] = {}
    for ranked in ranked_lists:
        for rank, letter_id in enumerate(ranked):
            if letter_id is None:
                continue
            lid = int(letter_id)
            scores[lid] = scores.get(lid, 0.0) + 1.0 / (k + rank + 1)
    ordered = sorted(scores.items(), key=lambda item: (-item[1], item[0]))
    return [lid for lid, _ in ordered[:limit]]


def _accessible_letter_query(db: Session):
    actor = current_user_name(db)
    role = resolve_user_role(db, actor)
    query = db.query(Letter).filter(Letter.is_archived.is_(False))
    if not is_administrator(role):
        query = query.filter(owned_letter_filter(actor))
    return query


def keyword_search_letter_ids(db: Session, query: str, *, limit: int = 50) -> list[int]:
    """Reuse in-process keyword matching; return ordered letter ids."""
    from app.ai_service import _text_match_letters

    # Prefer exact letter-number hits first.
    hints = extract_letter_number_hints(query)
    hits: list[Letter] = []
    if hints:
        q = _accessible_letter_query(db)
        for hint in hints:
            rows = q.filter(Letter.number.ilike(f"%{hint}%")).limit(limit).all()
            hits.extend(rows)

    matched = _text_match_letters(db, query, limit=limit)
    seen: set[int] = set()
    ordered: list[int] = []
    for row in hits + matched:
        if row.id in seen:
            continue
        seen.add(row.id)
        ordered.append(row.id)
        if len(ordered) >= limit:
            break
    return ordered


async def vector_search_letter_ids(
    db: Session,
    query: str,
    *,
    limit: int = 20,
) -> tuple[list[int], dict[int, str]]:
    """ANN over cms_letter_chunks; returns letter ids + best chunk snippet per letter."""
    cfg = get_settings()
    snippets: dict[int, str] = {}
    if not cfg.embedding_enabled or not embeddings_are_configured(cfg):
        return [], snippets

    model = cfg.active_embedding_model
    try:
        vector = await embed_query(query, settings=cfg)
    except Exception:  # noqa: BLE001
        logger.exception("Vector query embedding failed")
        return [], snippets

    # Restrict to ACL-visible letters via subquery of accessible ids.
    access_ids = [row.id for row in _accessible_letter_query(db).with_entities(Letter.id).all()]
    if not access_ids:
        return [], snippets

    # pgvector cosine distance; filter to current embedding model + ACL ids.
    sql = text(
        """
        SELECT c.letter_id, c.content, c.embedding <=> CAST(:embedding AS vector) AS distance
        FROM cms_letter_chunks c
        WHERE c.embedding_model = :model
          AND c.letter_id IN :ids
          AND c.embedding IS NOT NULL
        ORDER BY c.embedding <=> CAST(:embedding AS vector)
        LIMIT :limit
        """
    ).bindparams(bindparam("ids", expanding=True))
    embedding_literal = "[" + ",".join(str(float(x)) for x in vector) + "]"
    rows = db.execute(
        sql,
        {
            "embedding": embedding_literal,
            "model": model,
            "ids": access_ids,
            "limit": max(limit * 3, limit),
        },
    ).fetchall()

    ordered_ids: list[int] = []
    seen: set[int] = set()
    for letter_id, content, _distance in rows:
        lid = int(letter_id)
        if lid not in snippets and content:
            snippets[lid] = str(content)[:1500]
        if lid in seen:
            continue
        seen.add(lid)
        ordered_ids.append(lid)
        if len(ordered_ids) >= limit:
            break
    return ordered_ids, snippets


async def hybrid_search(
    db: Session,
    query: str,
    *,
    top_k: int | None = None,
    mode: RetrievalMode | None = None,
) -> dict[str, Any]:
    """Run keyword and/or vector retrieval, fuse with RRF, return serialized letters."""
    cfg = get_settings()
    limit = int(top_k if top_k is not None else cfg.rag_top_k)
    limit = max(1, min(limit, 50))
    resolved_mode = mode or route_query(query)

    keyword_ids: list[int] = []
    vector_ids: list[int] = []
    snippets: dict[int, str] = {}

    use_keyword = resolved_mode in {RetrievalMode.KEYWORD, RetrievalMode.HYBRID}
    use_vector = (
        resolved_mode in {RetrievalMode.SEMANTIC, RetrievalMode.HYBRID}
        and cfg.rag_hybrid_enabled
        and cfg.embedding_enabled
        and embeddings_are_configured(cfg)
    )

    if use_keyword:
        keyword_ids = keyword_search_letter_ids(db, query, limit=max(limit * 2, 20))

    if use_vector:
        vector_ids, snippets = await vector_search_letter_ids(db, query, limit=max(limit * 2, 20))

    ranked_lists: list[list[int]] = []
    if keyword_ids:
        ranked_lists.append(keyword_ids)
    if vector_ids:
        ranked_lists.append(vector_ids)

    if not ranked_lists:
        # Last resort: keyword even if router said semantic but embeddings failed.
        keyword_ids = keyword_search_letter_ids(db, query, limit=limit)
        fused = keyword_ids[:limit]
        resolved_mode = RetrievalMode.KEYWORD
    elif len(ranked_lists) == 1:
        fused = ranked_lists[0][:limit]
    else:
        fused = rrf_fuse(ranked_lists, k=cfg.rag_rrf_k, limit=limit)

    letters: list[dict[str, Any]] = []
    if fused:
        rows = db.query(Letter).filter(Letter.id.in_(fused)).all()
        by_id = {row.id: row for row in rows}
        for lid in fused:
            row = by_id.get(lid)
            if not row:
                continue
            payload = serialize_letter(row).model_dump(by_alias=True)
            if lid in snippets:
                payload["ragSnippet"] = snippets[lid]
            letters.append(payload)

    filters: dict[str, str] = {"Retrieval": resolved_mode.value}
    if keyword_ids and vector_ids:
        filters["Fusion"] = "rrf"
    summary = (
        f"Hybrid retrieval ({resolved_mode.value}) matched {len(letters)} letter(s)."
        if letters
        else "No matching letters found for this query."
    )
    return {
        "query": query,
        "filters": filters,
        "summary": summary,
        "letters": letters,
        "mode": resolved_mode.value,
        "keywordHits": len(keyword_ids),
        "vectorHits": len(vector_ids),
    }
