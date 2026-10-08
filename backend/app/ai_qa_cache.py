"""Persist and serve letter Q&A answers so repeated questions skip LLM calls."""

from __future__ import annotations

import hashlib
import re
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.letter_access import assert_letter_access, resolve_user_role
from app.models import Letter, LetterQaCache
from app.services import current_user_name

SUGGESTED_LETTER_QUESTIONS = (
    "What is this letter about?",
    "What actions are required?",
    "When is the deadline?",
    "Who sent this letter?",
    "What is the current status?",
)

_QUESTION_MAX_NORM = 500


def _utcnow() -> datetime:
    return datetime.now(UTC)


def normalize_question(question: str) -> str:
    """Lowercase, collapse whitespace, strip trailing punctuation for stable keys."""
    text = (question or "").strip().lower()
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"[?!.,;:]+$", "", text).strip()
    return text[:_QUESTION_MAX_NORM]


def question_hash(question: str) -> str:
    return hashlib.sha256(normalize_question(question).encode("utf-8")).hexdigest()


def letter_content_fingerprint(letter: Letter) -> str:
    """Hash of fields that affect Q&A answers; changes invalidate cache rows."""
    parts = [
        str(letter.subject or ""),
        str(letter.status or ""),
        str(letter.sender or ""),
        str(letter.due_date or ""),
        str(getattr(letter, "action_required", "") or ""),
        str(getattr(letter, "body_text", "") or ""),
        str(letter.remarks or ""),
        str(letter.assigned_to or ""),
        str(letter.priority or ""),
        str(letter.department or ""),
        str(letter.last_action or ""),
    ]
    raw = "\n".join(parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:40]


def _serialize_row(row: LetterQaCache, *, include_answer: bool = False) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": row.id,
        "question": row.question,
        "hitCount": row.hit_count or 0,
        "askedBy": row.asked_by or "",
        "askedAt": row.asked_at.isoformat() if row.asked_at else None,
        "updatedAt": row.updated_at.isoformat() if row.updated_at else None,
        "source": row.source or "llm",
    }
    if include_answer:
        out["answer"] = row.answer or ""
    return out


def assert_letter_for_qa(db: Session, letter_id: int) -> Letter:
    letter = db.get(Letter, letter_id)
    if not letter:
        raise ValueError("Letter not found")
    actor = current_user_name(db)
    role = resolve_user_role(db, actor)
    assert_letter_access(db, letter, actor, role)
    return letter


def get_cached_answer(
    db: Session,
    letter: Letter,
    question: str,
) -> LetterQaCache | None:
    """Return a valid cache row when question + content fingerprint match."""
    qhash = question_hash(question)
    row = (
        db.query(LetterQaCache)
        .filter(LetterQaCache.letter_id == letter.id, LetterQaCache.question_hash == qhash)
        .one_or_none()
    )
    if not row or not (row.answer or "").strip():
        return None
    if row.content_fingerprint != letter_content_fingerprint(letter):
        return None
    return row


def record_cache_hit(db: Session, row: LetterQaCache) -> None:
    row.hit_count = int(row.hit_count or 0) + 1
    row.updated_at = _utcnow()
    db.flush()


def upsert_qa_answer(
    db: Session,
    letter: Letter,
    question: str,
    answer: str,
    *,
    source: str = "llm",
    model_id: str = "",
    actor: str | None = None,
) -> LetterQaCache:
    q_raw = (question or "").strip()
    q_norm = normalize_question(q_raw)
    qhash = question_hash(q_raw)
    fingerprint = letter_content_fingerprint(letter)
    user = actor or current_user_name(db)
    row = (
        db.query(LetterQaCache)
        .filter(LetterQaCache.letter_id == letter.id, LetterQaCache.question_hash == qhash)
        .one_or_none()
    )
    if not row:
        row = LetterQaCache(
            letter_id=letter.id,
            question_hash=qhash,
            hit_count=0,
        )
        db.add(row)
    row.question = q_raw
    row.question_normalized = q_norm
    row.answer = (answer or "").strip()
    row.content_fingerprint = fingerprint
    row.model_id = model_id or ""
    row.source = source
    row.asked_by = user
    row.asked_at = _utcnow()
    row.updated_at = _utcnow()
    db.flush()
    return row


def list_letter_questions(
    db: Session,
    letter_id: int,
    *,
    limit: int = 12,
) -> dict[str, Any]:
    """Previous questions for a letter plus static suggested prompts."""
    letter = assert_letter_for_qa(db, letter_id)
    fingerprint = letter_content_fingerprint(letter)
    rows = (
        db.query(LetterQaCache)
        .filter(LetterQaCache.letter_id == letter_id)
        .order_by(LetterQaCache.hit_count.desc(), LetterQaCache.asked_at.desc())
        .limit(max(1, min(limit, 50)))
        .all()
    )
    previous: list[dict[str, Any]] = []
    seen_norms: set[str] = set()
    for row in rows:
        item = _serialize_row(row)
        item["valid"] = row.content_fingerprint == fingerprint and bool((row.answer or "").strip())
        previous.append(item)
        seen_norms.add(normalize_question(row.question))

    suggested = [q for q in SUGGESTED_LETTER_QUESTIONS if normalize_question(q) not in seen_norms]
    return {
        "letterId": letter_id,
        "questions": previous,
        "suggested": suggested,
    }


def try_deterministic_answer(letter: Letter, question: str) -> str | None:
    """Answer common field lookups without an LLM call."""
    q = normalize_question(question)
    number = letter.number or f"letter #{letter.id}"

    if re.search(r"\b(deadline|due date)\b", q) or re.search(r"when.*(due|respond)", q):
        if letter.due_date:
            return f"The recorded due date for {number} is {letter.due_date.isoformat()}."
        return f"No official due date is recorded for {number}."

    if re.search(r"\b(who sent|who wrote|sender|originat)\b", q) or q.startswith("from "):
        if letter.sender:
            return f"{number} was sent by {letter.sender}."
        return f"The sender organization is not recorded for {number}."

    if re.search(r"\b(status|progress)\b", q) or "where does this stand" in q:
        owner = f" It is currently owned by {letter.assigned_to}." if letter.assigned_to else ""
        return f"{number} is currently marked {letter.status}.{owner}"

    if re.search(r"\b(action|actions required|next step|what.*required)\b", q):
        action = (getattr(letter, "action_required", None) or letter.last_action or "").strip()
        if action:
            return f"The recorded action for {number} is: {action}."
        return f"No specific action required field is recorded for {number}."

    return None
