"""HTTP API for simple marking workflow (spec 06)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.client_ip import client_ip_from_request
from app.config import get_settings
from app.database import get_db
from app.letter_access import assert_letter_access
from app.marking_workflow_service import (
    add_note,
    available_marking_actions,
    batch_tracker,
    close_letter,
    create_mark_batch,
    list_notes,
    list_tracked,
    marking_tree,
    revoke_marking,
    serialize_batch,
    serialize_marking,
)
from app.models import Letter, Marking
from app.services import current_user_name, serialize_letter

router = APIRouter(prefix="/markings", tags=["markings"])


def _require_enabled() -> None:
    if not get_settings().marking_workflow_enabled:
        raise HTTPException(status_code=404, detail="Marking workflow is disabled")


def _get_letter(db: Session, letter_id: int) -> Letter:
    letter = db.get(Letter, letter_id)
    if not letter:
        raise HTTPException(status_code=404, detail="Letter not found")
    return letter


class MarkRecipientIn(BaseModel):
    toUser: str
    action: str = "forward"
    responseType: str | None = None
    responseTypeOther: str | None = None
    instructions: str | None = None
    dueAt: str | None = None
    priority: str | None = None
    track: bool = True
    remindersEnabled: bool | None = None


class MarkBatchIn(BaseModel):
    recipients: list[MarkRecipientIn]
    remarks: str = ""
    pathwayNotify: bool = False
    parentMarkingId: int | None = None


class RevokeIn(BaseModel):
    remarks: str = ""


class NoteIn(BaseModel):
    bodyText: str
    markingId: int | None = None
    isResponse: bool = False
    attachments: list[dict[str, Any]] = Field(default_factory=list)


class RespondIn(BaseModel):
    bodyText: str
    attachments: list[dict[str, Any]] = Field(default_factory=list)


class CloseIn(BaseModel):
    remarks: str = ""
    force: bool = False


@router.get("/letters/{letter_id}/actions")
def get_actions(letter_id: int, db: Session = Depends(get_db)) -> dict:
    _require_enabled()
    letter = _get_letter(db, letter_id)
    actor = current_user_name(db)
    assert_letter_access(db, letter, actor)
    return {
        "letterId": str(letter.id),
        "currentStatus": letter.status,
        "actions": available_marking_actions(db, letter, actor),
    }


@router.get("/letters/{letter_id}/tree")
def get_tree(letter_id: int, db: Session = Depends(get_db)) -> list[dict]:
    _require_enabled()
    letter = _get_letter(db, letter_id)
    assert_letter_access(db, letter, current_user_name(db))
    return marking_tree(db, letter_id)


@router.post("/letters/{letter_id}/mark")
def mark_letter(
    letter_id: int,
    payload: MarkBatchIn,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    _require_enabled()
    letter = _get_letter(db, letter_id)
    actor = current_user_name(db)
    assert_letter_access(db, letter, actor)
    batch = create_mark_batch(
        db,
        letter=letter,
        actor_name=actor,
        recipients=[r.model_dump() for r in payload.recipients],
        remarks=payload.remarks,
        pathway_notify=payload.pathwayNotify,
        parent_marking_id=payload.parentMarkingId,
        client_ip=client_ip_from_request(request),
    )
    db.commit()
    db.refresh(batch)
    markings = db.query(Marking).filter(Marking.batch_id == batch.id).all()
    return {
        "batch": serialize_batch(batch),
        "markings": [serialize_marking(m) for m in markings],
        "letter": serialize_letter(letter),
    }


@router.post("/{marking_id}/revoke")
def revoke(
    marking_id: int,
    payload: RevokeIn,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    _require_enabled()
    marking = db.get(Marking, marking_id)
    if not marking:
        raise HTTPException(status_code=404, detail="Marking not found")
    letter = _get_letter(db, marking.letter_id)
    actor = current_user_name(db)
    assert_letter_access(db, letter, actor)
    revoke_marking(
        db,
        marking=marking,
        actor_name=actor,
        remarks=payload.remarks,
        client_ip=client_ip_from_request(request),
    )
    db.commit()
    db.refresh(marking)
    return {"marking": serialize_marking(marking), "letter": serialize_letter(letter)}


@router.get("/letters/{letter_id}/notes")
def get_notes(letter_id: int, db: Session = Depends(get_db)) -> list[dict]:
    _require_enabled()
    letter = _get_letter(db, letter_id)
    assert_letter_access(db, letter, current_user_name(db))
    return list_notes(db, letter_id)


@router.post("/letters/{letter_id}/notes")
def post_note(
    letter_id: int,
    payload: NoteIn,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    _require_enabled()
    letter = _get_letter(db, letter_id)
    actor = current_user_name(db)
    assert_letter_access(db, letter, actor)
    note = add_note(
        db,
        letter=letter,
        actor_name=actor,
        body_text=payload.bodyText,
        marking_id=payload.markingId,
        is_response=payload.isResponse,
        attachments=payload.attachments,
        client_ip=client_ip_from_request(request),
    )
    db.commit()
    notes = list_notes(db, letter_id)
    created = next((n for n in notes if n["id"] == note.id), notes[-1] if notes else {})
    return {"note": created, "letter": serialize_letter(letter)}


@router.post("/{marking_id}/respond")
def respond(
    marking_id: int,
    payload: RespondIn,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    _require_enabled()
    marking = db.get(Marking, marking_id)
    if not marking:
        raise HTTPException(status_code=404, detail="Marking not found")
    letter = _get_letter(db, marking.letter_id)
    actor = current_user_name(db)
    assert_letter_access(db, letter, actor)
    note = add_note(
        db,
        letter=letter,
        actor_name=actor,
        body_text=payload.bodyText,
        marking_id=marking_id,
        is_response=True,
        attachments=payload.attachments,
        client_ip=client_ip_from_request(request),
    )
    db.commit()
    db.refresh(marking)
    notes = list_notes(db, letter_id=letter.id)
    created = next((n for n in notes if n["id"] == note.id), {})
    return {
        "note": created,
        "marking": serialize_marking(marking),
        "letter": serialize_letter(letter),
    }


@router.get("/tracked")
def tracked(db: Session = Depends(get_db)) -> list[dict]:
    _require_enabled()
    return list_tracked(db, current_user_name(db))


@router.get("/batches/{batch_id}/tracker")
def tracker(batch_id: int, db: Session = Depends(get_db)) -> dict:
    _require_enabled()
    return batch_tracker(db, batch_id, current_user_name(db))


@router.post("/letters/{letter_id}/close")
def close(
    letter_id: int,
    payload: CloseIn,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    _require_enabled()
    letter = _get_letter(db, letter_id)
    actor = current_user_name(db)
    assert_letter_access(db, letter, actor)
    close_letter(
        db,
        letter=letter,
        actor_name=actor,
        remarks=payload.remarks,
        force=payload.force,
        client_ip=client_ip_from_request(request),
    )
    db.commit()
    db.refresh(letter)
    return {"letter": serialize_letter(letter)}
