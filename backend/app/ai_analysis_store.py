"""Persist and serve AI Intelligence Panel results so reopen skips LLM calls."""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.letter_access import assert_letter_access, is_administrator, resolve_user_role
from app.models import Letter, LetterAiAnalysis, Role
from app.services import current_user_name


def _utcnow() -> datetime:
    return datetime.now(UTC)

ANALYSIS_KINDS = (
    "summarize",
    "extract",
    "classify",
    "recommend_actions",
    "urgency",
    "draft_response",
    "analyze_correspondence",
)

REGENERATE_OPTION = "Regenerate analysis"

GenerateFn = Callable[[], Awaitable[Any]]
Transform = Callable[[Any], Any]


def _loads(raw: str | None, default: Any) -> Any:
    if not raw:
        return default
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return default


def _serialize_row(row: LetterAiAnalysis) -> dict[str, Any]:
    return {
        "kind": row.kind,
        "payload": _loads(row.payload_json, {}),
        "decisions": _loads(row.decisions_json, {}),
        "meta": _loads(row.meta_json, {}),
        "generatedBy": row.generated_by or "",
        "generatedAt": row.generated_at.isoformat() if row.generated_at else None,
        "updatedAt": row.updated_at.isoformat() if row.updated_at else None,
    }


def get_row(db: Session, letter_id: int, kind: str) -> LetterAiAnalysis | None:
    return (
        db.query(LetterAiAnalysis)
        .filter(LetterAiAnalysis.letter_id == letter_id, LetterAiAnalysis.kind == kind)
        .one_or_none()
    )


def get_cached_payload(db: Session, letter_id: int, kind: str) -> Any | None:
    row = get_row(db, letter_id, kind)
    if not row or not row.payload_json:
        return None
    return _loads(row.payload_json, None)


def user_can_regenerate_ai(db: Session, user_name: str, role: str | None = None) -> bool:
    resolved = role if role is not None else resolve_user_role(db, user_name)
    if is_administrator(resolved):
        return True
    role_row = db.query(Role).filter(Role.name == resolved).one_or_none()
    if not role_row:
        return resolved.strip().lower() in {"manager", "clerk"}
    matrix = _loads(role_row.permissions_json, {})
    entry = matrix.get("ai_intelligence") or {}
    other = entry.get("other") or {}
    if other.get(REGENERATE_OPTION):
        return True
    if entry.get("edit") and REGENERATE_OPTION not in other:
        return True
    return False


def assert_can_regenerate_ai(db: Session, user_name: str | None = None) -> None:
    actor = user_name or current_user_name(db)
    if user_can_regenerate_ai(db, actor):
        return
    raise HTTPException(
        status_code=403,
        detail="You do not have permission to regenerate AI analysis for this letter",
    )


def assert_letter_for_ai(db: Session, letter_id: int) -> Letter:
    letter = db.get(Letter, letter_id)
    if not letter:
        raise HTTPException(status_code=404, detail="Letter not found")
    actor = current_user_name(db)
    role = resolve_user_role(db, actor)
    assert_letter_access(db, letter, actor, role)
    return letter


def list_letter_analyses(db: Session, letter_id: int) -> dict[str, Any]:
    assert_letter_for_ai(db, letter_id)
    actor = current_user_name(db)
    role = resolve_user_role(db, actor)
    rows = db.query(LetterAiAnalysis).filter(LetterAiAnalysis.letter_id == letter_id).all()
    by_kind = {row.kind: _serialize_row(row) for row in rows}
    analyses = {kind: by_kind.get(kind) for kind in ANALYSIS_KINDS}
    return {
        "letterId": letter_id,
        "canRegenerate": user_can_regenerate_ai(db, actor, role),
        "analyses": analyses,
    }


def upsert_generated(
    db: Session,
    letter_id: int,
    kind: str,
    payload: Any,
    *,
    meta: dict[str, Any] | None = None,
    actor: str | None = None,
) -> None:
    if kind not in ANALYSIS_KINDS:
        raise HTTPException(status_code=422, detail=f"Unknown analysis kind: {kind}")
    user = actor or current_user_name(db)
    row = get_row(db, letter_id, kind)
    if not row:
        row = LetterAiAnalysis(letter_id=letter_id, kind=kind, decisions_json="{}")
        db.add(row)
    row.payload_json = json.dumps(payload if payload is not None else {})
    row.meta_json = json.dumps(meta or {})
    row.generated_by = user
    row.generated_at = _utcnow()
    row.updated_at = _utcnow()
    db.flush()


def save_client_analysis(
    db: Session,
    letter_id: int,
    kind: str,
    payload: Any,
    *,
    decisions: dict[str, Any] | None = None,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Persist analysis from the client (mock path) when none exists, or overwrite when allowed."""
    if kind not in ANALYSIS_KINDS:
        raise HTTPException(status_code=422, detail=f"Unknown analysis kind: {kind}")
    assert_letter_for_ai(db, letter_id)
    actor = current_user_name(db)
    row = get_row(db, letter_id, kind)
    if row:
        assert_can_regenerate_ai(db, actor)
    upsert_generated(db, letter_id, kind, payload, meta=meta, actor=actor)
    if decisions is not None:
        stored = get_row(db, letter_id, kind)
        if stored:
            stored.decisions_json = json.dumps(decisions)
            db.flush()
    stored = get_row(db, letter_id, kind)
    if not stored:
        raise HTTPException(status_code=500, detail="Failed to persist analysis")
    return _serialize_row(stored)


def save_decisions(db: Session, letter_id: int, kind: str, decisions: dict[str, Any]) -> dict[str, Any]:
    if kind not in ANALYSIS_KINDS:
        raise HTTPException(status_code=422, detail=f"Unknown analysis kind: {kind}")
    assert_letter_for_ai(db, letter_id)
    row = get_row(db, letter_id, kind)
    if not row:
        raise HTTPException(status_code=404, detail="No stored analysis for this kind")
    row.decisions_json = json.dumps(decisions or {})
    row.updated_at = _utcnow()
    db.flush()
    return _serialize_row(row)


async def get_or_generate(
    db: Session,
    letter_id: int,
    kind: str,
    *,
    force: bool,
    generate: GenerateFn,
    to_response: Transform | None = None,
    meta: dict[str, Any] | None = None,
) -> Any:
    """Return cached payload (optionally wrapped) unless force regenerates via LLM."""
    assert_letter_for_ai(db, letter_id)
    wrap = to_response or (lambda payload: payload)

    if not force:
        cached = get_cached_payload(db, letter_id, kind)
        if cached is not None:
            return wrap(cached)

    if force and get_row(db, letter_id, kind):
        assert_can_regenerate_ai(db)

    result = await generate()
    upsert_generated(db, letter_id, kind, result, meta=meta)
    return wrap(result)
