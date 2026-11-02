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
    "Summarize the marking workflow so far",
    "Who currently holds this letter?",
    "What comments have been written?",
    "Are there any pending responses?",
)

_QUESTION_MAX_NORM = 500
_NOTE_PROMPT_CHARS = 1_500
_INSTRUCTION_PROMPT_CHARS = 600
_MAX_MARKINGS_IN_PROMPT = 50
_MAX_COMMENTS_IN_PROMPT = 40


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _truncate(value: str | None, limit: int) -> str:
    text = (value or "").strip()
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"


def normalize_question(question: str) -> str:
    """Lowercase, collapse whitespace, strip trailing punctuation for stable keys."""
    text = (question or "").strip().lower()
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"[?!.,;:]+$", "", text).strip()
    return text[:_QUESTION_MAX_NORM]


def question_hash(question: str) -> str:
    return hashlib.sha256(normalize_question(question).encode("utf-8")).hexdigest()


def _flatten_marking_tree(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    flat: list[dict[str, Any]] = []
    for node in nodes:
        children = list(node.get("children") or [])
        item = {key: value for key, value in node.items() if key != "children"}
        flat.append(item)
        if children:
            flat.extend(_flatten_marking_tree(children))
    return flat


def build_letter_qa_workflow_context(
    db: Session,
    letter_id: int,
    actor_name: str | None = None,
) -> dict[str, Any]:
    """Markings, batch remarks, and comments visible to the actor for letter Q&A."""
    from app.config import get_settings
    from app.marking_workflow_service import (
        current_holder_names,
        list_notes,
        marking_tree,
        serialize_batch,
    )
    from app.models import MarkingBatch

    actor = (actor_name or current_user_name(db) or "").strip()
    if not get_settings().marking_workflow_enabled:
        return {
            "enabled": False,
            "currentHolders": [],
            "markings": [],
            "batches": [],
            "comments": [],
            "pendingResponses": [],
        }

    tree = marking_tree(db, letter_id, actor_name=actor or None)
    flat_rows = _flatten_marking_tree(tree)
    markings: list[dict[str, Any]] = []
    for row in flat_rows[:_MAX_MARKINGS_IN_PROMPT]:
        markings.append(
            {
                "id": row.get("id"),
                "batchId": row.get("batchId"),
                "parentMarkingId": row.get("parentMarkingId"),
                "fromUser": row.get("fromUser") or "",
                "toUser": row.get("toUser") or "",
                "action": row.get("action") or "",
                "direction": row.get("direction") or "forward",
                "responseType": row.get("responseType") or "",
                "responseTypeOther": row.get("responseTypeOther") or "",
                "instructions": _truncate(str(row.get("instructions") or ""), _INSTRUCTION_PROMPT_CHARS),
                "dueAt": row.get("dueAt") or "",
                "priority": row.get("priority") or "",
                "status": row.get("status") or "",
                "acceptanceStatus": row.get("acceptanceStatus") or "",
                "rejectionReason": _truncate(str(row.get("rejectionReason") or ""), 400),
                "createdAt": row.get("createdAt") or "",
                "respondedAt": row.get("respondedAt") or "",
            }
        )

    batch_ids = sorted(
        {
            int(row.get("batchId"))
            for row in flat_rows
            if row.get("batchId") is not None
        }
    )
    batches: list[dict[str, Any]] = []
    if batch_ids:
        batch_rows = (
            db.query(MarkingBatch)
            .filter(MarkingBatch.id.in_(batch_ids))
            .order_by(MarkingBatch.id.asc())
            .all()
        )
        for batch in batch_rows:
            payload = serialize_batch(batch)
            payload["remarks"] = _truncate(payload.get("remarks") or "", _INSTRUCTION_PROMPT_CHARS)
            batches.append(payload)

    notes = list_notes(db, letter_id, actor_name=actor or None)
    comments: list[dict[str, Any]] = []
    for note in notes[:_MAX_COMMENTS_IN_PROMPT]:
        comments.append(
            {
                "id": note.get("id"),
                "markingId": note.get("markingId"),
                "batchId": note.get("batchId"),
                "authorUser": note.get("authorUser") or "",
                "toUser": note.get("toUser") or "",
                "forUser": note.get("forUser") or "",
                "markingAction": note.get("markingAction") or "",
                "bodyText": _truncate(str(note.get("bodyText") or ""), _NOTE_PROMPT_CHARS),
                "audience": note.get("audience") or "",
                "isResponse": bool(note.get("isResponse")),
                "createdAt": note.get("createdAt") or "",
            }
        )

    holders = current_holder_names(db, letter_id)
    visible_to_users = {(row.get("toUser") or "").strip() for row in markings}
    if actor and visible_to_users:
        scoped = [h for h in holders if h in visible_to_users]
        if scoped:
            holders = scoped

    pending: list[dict[str, Any]] = []
    for row in markings:
        if (row.get("action") or "") != "response_required":
            continue
        if (row.get("status") or "") != "active":
            continue
        if row.get("respondedAt"):
            continue
        pending.append(
            {
                "markingId": row.get("id"),
                "fromUser": row.get("fromUser") or "",
                "toUser": row.get("toUser") or "",
                "responseType": row.get("responseType") or row.get("responseTypeOther") or "",
                "dueAt": row.get("dueAt") or "",
                "instructions": row.get("instructions") or "",
            }
        )

    return {
        "enabled": True,
        "viewer": actor,
        "currentHolders": holders,
        "markings": markings,
        "batches": batches,
        "comments": comments,
        "pendingResponses": pending,
    }


def letter_content_fingerprint(
    letter: Letter,
    db: Session | None = None,
    actor_name: str | None = None,
) -> str:
    """Hash of fields that affect Q&A answers; changes invalidate cache rows.

    When ``db`` is provided, include the actor-visible marking/workflow/comments
    digest so answers about pathway state invalidate correctly and are not shared
    across users with different visibility.
    """
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
        str(getattr(letter, "close_reason", "") or ""),
    ]
    if db is not None and getattr(letter, "id", None):
        actor = (actor_name or current_user_name(db) or "").strip()
        workflow = build_letter_qa_workflow_context(db, int(letter.id), actor)
        parts.append(f"viewer:{workflow.get('viewer') or actor}")
        parts.append("holders:" + ",".join(workflow.get("currentHolders") or []))
        for marking in workflow.get("markings") or []:
            parts.append(
                "m:"
                + "|".join(
                    str(marking.get(key) or "")
                    for key in (
                        "id",
                        "status",
                        "fromUser",
                        "toUser",
                        "action",
                        "acceptanceStatus",
                        "instructions",
                        "dueAt",
                        "respondedAt",
                        "rejectionReason",
                    )
                )
            )
        for batch in workflow.get("batches") or []:
            parts.append(f"b:{batch.get('id')}|{batch.get('remarks') or ''}")
        for comment in workflow.get("comments") or []:
            parts.append(
                "c:"
                + "|".join(
                    str(comment.get(key) or "")
                    for key in ("id", "authorUser", "bodyText", "isResponse", "audience", "forUser")
                )
            )
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
    *,
    actor_name: str | None = None,
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
    actor = actor_name or current_user_name(db)
    if row.content_fingerprint != letter_content_fingerprint(letter, db, actor):
        return None
    # Avoid serving another user's answer when fingerprints collide on legacy rows.
    asked_by = (row.asked_by or "").strip()
    if asked_by and actor and asked_by != actor.strip():
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
    user = actor or current_user_name(db)
    fingerprint = letter_content_fingerprint(letter, db, user)
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
    actor = current_user_name(db)
    fingerprint = letter_content_fingerprint(letter, db, actor)
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
        # Show this viewer's questions first; still list others as prompts without reuse hint.
        item = _serialize_row(row)
        same_viewer = not row.asked_by or row.asked_by == actor
        item["valid"] = (
            same_viewer
            and row.content_fingerprint == fingerprint
            and bool((row.answer or "").strip())
        )
        previous.append(item)
        seen_norms.add(normalize_question(row.question))

    suggested = [q for q in SUGGESTED_LETTER_QUESTIONS if normalize_question(q) not in seen_norms]
    return {
        "letterId": letter_id,
        "questions": previous,
        "suggested": suggested,
    }


def try_deterministic_answer(
    letter: Letter,
    question: str,
    *,
    db: Session | None = None,
    actor_name: str | None = None,
    workflow: dict[str, Any] | None = None,
) -> str | None:
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

    if re.search(r"\b(action|actions required|next step|what.*required)\b", q) and not re.search(
        r"\b(pending response|response required|marking|workflow|comment)\b", q
    ):
        action = (getattr(letter, "action_required", None) or letter.last_action or "").strip()
        if action:
            return f"The recorded action for {number} is: {action}."
        return f"No specific action required field is recorded for {number}."

    ctx = workflow
    if ctx is None and db is not None and getattr(letter, "id", None):
        ctx = build_letter_qa_workflow_context(db, int(letter.id), actor_name)

    if ctx and ctx.get("enabled"):
        holders = [h for h in (ctx.get("currentHolders") or []) if h]
        if re.search(r"\b(who (currently )?holds|current holder|who (has|holds) this)\b", q):
            if holders:
                joined = ", ".join(holders)
                return f"{number} is currently held by {joined}."
            assigned = (letter.assigned_to or "").strip()
            if assigned:
                return f"{number} is currently assigned to {assigned}."
            return f"No current marking holder is recorded for {number}."

        pending = ctx.get("pendingResponses") or []
        if re.search(
            r"\b(pending responses?|response required|awaiting responses?)\b",
            q,
        ):
            if not pending:
                return f"There are no pending Response Required markings visible on {number}."
            bits = []
            for item in pending[:5]:
                who = item.get("toUser") or "someone"
                kind = item.get("responseType") or "a response"
                due = f" (due {item['dueAt']})" if item.get("dueAt") else ""
                bits.append(f"{who} owes {kind}{due}")
            return f"Pending responses on {number}: " + "; ".join(bits) + "."

        comments = ctx.get("comments") or []
        if re.search(r"\b(comments?|notes?)\b", q) and re.search(
            r"\b(what|which|any|list|show|written|wrote)\b", q
        ):
            if not comments:
                return f"No workflow comments are visible to you on {number}."
            recent = comments[:3]
            snippets = []
            for note in recent:
                author = note.get("authorUser") or "Someone"
                body = (note.get("bodyText") or "").strip()
                if len(body) > 160:
                    body = body[:159].rstrip() + "…"
                snippets.append(f"{author}: {body}" if body else f"{author}: (empty)")
            more = f" ({len(comments)} total visible)" if len(comments) > 3 else ""
            return f"Recent comments on {number}{more}: " + " | ".join(snippets)

        markings = ctx.get("markings") or []
        if re.search(r"\b(marking workflow|workflow so far|pathway)\b", q) or re.search(
            r"summarize.*\bworkflow\b", q
        ):
            if not markings:
                return f"No marking pathway is visible to you on {number}."
            hops = []
            for row in markings[-6:]:
                hops.append(
                    f"{row.get('fromUser') or '?'} → {row.get('toUser') or '?'} "
                    f"({row.get('action') or 'mark'}, {row.get('status') or ''})"
                )
            holder_bit = f" Current holders: {', '.join(holders)}." if holders else ""
            return (
                f"Visible marking pathway on {number} ({len(markings)} hop(s)): "
                + "; ".join(hops)
                + "."
                + holder_bit
            )

    return None
