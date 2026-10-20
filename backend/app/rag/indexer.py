"""Index / reindex letter body text into cms_letter_chunks."""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Letter, LetterChunk
from app.rag.chunker import chunk_letter, content_hash
from app.rag.embed_client import EmbeddingNotConfiguredError, embed_texts, embeddings_are_configured

logger = logging.getLogger(__name__)


def _letter_source_fingerprint(letter: Letter) -> str:
    raw = "\n".join(
        [
            (letter.number or "").strip(),
            (letter.subject or "").strip(),
            (getattr(letter, "body_text", "") or "").strip(),
        ]
    )
    return content_hash(raw)


async def index_letter(db: Session, letter: Letter, *, force: bool = False) -> dict[str, Any]:
    """Chunk + embed a single letter. No-op when embeddings disabled or empty body/subject."""
    cfg = get_settings()
    if not cfg.embedding_enabled or not embeddings_are_configured(cfg):
        return {"letterId": letter.id, "status": "skipped", "reason": "embeddings_disabled"}

    chunks = chunk_letter(
        subject=letter.subject or "",
        body_text=getattr(letter, "body_text", "") or "",
        number=letter.number or "",
    )
    if not chunks:
        db.execute(delete(LetterChunk).where(LetterChunk.letter_id == letter.id))
        db.flush()
        return {"letterId": letter.id, "status": "cleared", "chunks": 0}

    model = cfg.active_embedding_model
    fingerprint = _letter_source_fingerprint(letter)
    existing = (
        db.query(LetterChunk)
        .filter(LetterChunk.letter_id == letter.id)
        .order_by(LetterChunk.chunk_index.asc())
        .all()
    )
    if (
        not force
        and len(existing) == len(chunks)
        and all(row.embedding_model == model for row in existing)
        and all(row.content_hash == content_hash(chunks[i]) for i, row in enumerate(existing))
        and existing
        and existing[0].content_hash  # sanity
    ):
        # Also require source fingerprint match via concatenated content hashes.
        joined = content_hash("|".join(row.content_hash for row in existing))
        if joined == content_hash("|".join(content_hash(c) for c in chunks)):
            return {"letterId": letter.id, "status": "unchanged", "chunks": len(existing)}

    try:
        vectors = await embed_texts(chunks, settings=cfg)
    except EmbeddingNotConfiguredError as exc:
        return {"letterId": letter.id, "status": "skipped", "reason": str(exc)}

    db.execute(delete(LetterChunk).where(LetterChunk.letter_id == letter.id))
    for idx, (text, vector) in enumerate(zip(chunks, vectors)):
        db.add(
            LetterChunk(
                letter_id=letter.id,
                chunk_index=idx,
                content=text,
                embedding=vector,
                content_hash=content_hash(text),
                embedding_model=model,
            )
        )
    db.flush()
    logger.info(
        "Indexed letter_id=%s chunks=%s model=%s fingerprint=%s",
        letter.id,
        len(chunks),
        model,
        fingerprint[:12],
    )
    return {"letterId": letter.id, "status": "indexed", "chunks": len(chunks), "model": model}


async def index_letter_id(db: Session, letter_id: int, *, force: bool = False) -> dict[str, Any]:
    letter = db.get(Letter, letter_id)
    if letter is None:
        return {"letterId": letter_id, "status": "missing"}
    return await index_letter(db, letter, force=force)


async def reindex_all_letters(
    db: Session,
    *,
    force: bool = False,
    limit: int | None = None,
) -> dict[str, Any]:
    """Backfill embeddings for letters that have subject or body_text."""
    cfg = get_settings()
    if not cfg.embedding_enabled or not embeddings_are_configured(cfg):
        return {
            "status": "skipped",
            "reason": "embeddings_disabled",
            "indexed": 0,
            "unchanged": 0,
            "cleared": 0,
            "failed": 0,
        }

    query = (
        db.query(Letter)
        .filter(Letter.is_archived.is_(False))
        .order_by(Letter.id.asc())
    )
    if limit is not None:
        query = query.limit(int(limit))
    letters = query.all()

    indexed = unchanged = cleared = failed = skipped = 0
    errors: list[dict[str, Any]] = []
    for letter in letters:
        body = (getattr(letter, "body_text", "") or "").strip()
        subject = (letter.subject or "").strip()
        if not body and not subject:
            continue
        try:
            result = await index_letter(db, letter, force=force)
            db.commit()
            status = result.get("status")
            if status == "indexed":
                indexed += 1
            elif status == "unchanged":
                unchanged += 1
            elif status == "cleared":
                cleared += 1
            elif status == "skipped":
                skipped += 1
            else:
                failed += 1
        except Exception as exc:  # noqa: BLE001 — continue batch
            failed += 1
            errors.append({"letterId": letter.id, "error": str(exc)[:300]})
            logger.exception("Failed to index letter_id=%s", letter.id)
            try:
                db.rollback()
            except Exception:  # noqa: BLE001
                pass

    return {
        "status": "ok",
        "model": cfg.active_embedding_model,
        "dimensions": cfg.embedding_dimensions,
        "indexed": indexed,
        "unchanged": unchanged,
        "cleared": cleared,
        "skipped": skipped,
        "failed": failed,
        "errors": errors[:20],
        "scanned": len(letters),
    }


def index_letter_blocking(db: Session, letter: Letter, *, force: bool = False) -> dict[str, Any]:
    """Run index_letter from sync FastAPI routes (threadpool has no running loop)."""
    import asyncio

    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(index_letter(db, letter, force=force))
    # Already inside an event loop — caller should await index_letter instead.
    raise RuntimeError("index_letter_blocking called from async context; await index_letter")


def try_index_letter(db: Session, letter: Letter) -> None:
    """Best-effort index after body_text write; never raises to callers."""
    cfg = get_settings()
    if not cfg.embedding_enabled or not embeddings_are_configured(cfg):
        return
    try:
        index_letter_blocking(db, letter, force=False)
    except Exception:  # noqa: BLE001
        logger.exception("Background index failed for letter_id=%s", getattr(letter, "id", None))
