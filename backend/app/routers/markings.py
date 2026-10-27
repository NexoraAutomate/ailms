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
    add_attachments_to_marking,
    add_draft_attachments,
    add_draft_note,
    add_note,
    batch_tracker,
    close_letter,
    create_mark_batch,
    delete_attachment,
    delete_draft_attachment,
    delete_draft_note,
    delete_note,
    update_draft_note,
    list_attachment_events,
    list_attachments,
    list_drafts,
    list_notes,
    list_tracked,
    marking_actions_payload,
    marking_tree,
    markings_for_path,
    replace_draft_roster,
    revoke_marking,
    serialize_attachment,
    serialize_batch,
    serialize_draft_attachment,
    serialize_draft_note,
    serialize_draft_recipient,
    serialize_marking,
    sync_attachment_after_replace,
    update_attachment_meta,
    update_note,
)
from app.models import (
    CorrespondenceAttachment,
    CorrespondenceDraftAttachment,
    CorrespondenceDraftNote,
    CorrespondenceNote,
    Letter,
    Marking,
)
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


class StagedNoteIn(BaseModel):
    bodyText: str


class StagedAttachmentIn(BaseModel):
    attachmentKind: str = "Other"
    documentId: int | None = None
    storageKey: str = ""
    originalFilename: str = ""


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
    # Drafted per-recipient content published when Forward/Reply is submitted.
    notes: list[StagedNoteIn] = Field(default_factory=list)
    attachments: list[StagedAttachmentIn] = Field(default_factory=list)


class MarkBatchIn(BaseModel):
    recipients: list[MarkRecipientIn]
    remarks: str = ""
    pathwayNotify: bool = False
    parentMarkingId: int | None = None
    # forward = onward (any recipients); reply = back to immediate previous marker only
    direction: str = "forward"
    # Shared drafts copied onto every recipient marking in this batch.
    commonNotes: list[StagedNoteIn] = Field(default_factory=list)
    commonAttachments: list[StagedAttachmentIn] = Field(default_factory=list)
    # When true, publish Add Comment / Add Attachment drafts for each recipient.
    consumeDrafts: bool = True


class RevokeIn(BaseModel):
    remarks: str = ""


class NoteIn(BaseModel):
    bodyText: str
    markingId: int | None = None
    isResponse: bool = False


class DraftNoteIn(BaseModel):
    bodyText: str
    # Empty = common draft for all recipients on Forward.
    targetUser: str = ""
    # forward | reply
    intent: str = "forward"


class DraftAttachmentsIn(BaseModel):
    targetUser: str = ""
    intent: str = "forward"
    attachments: list[dict[str, Any]] = Field(default_factory=list)


class DraftRosterRecipientIn(BaseModel):
    toUser: str
    role: str = "to"
    action: str = "forward"
    responseType: str = ""
    responseTypeOther: str = ""
    instructions: str = ""
    dueAt: str | None = None
    priority: str = ""
    track: bool = True
    remindersEnabled: bool = True


class DraftRosterIn(BaseModel):
    recipients: list[DraftRosterRecipientIn] = Field(default_factory=list)


class RespondIn(BaseModel):
    bodyText: str


class CloseIn(BaseModel):
    remarks: str = ""
    force: bool = False


class NoteUpdateIn(BaseModel):
    bodyText: str


class AttachmentUpdateIn(BaseModel):
    attachmentKind: str | None = None
    originalFilename: str | None = None


class AttachmentsAddIn(BaseModel):
    markingId: int | None = None
    attachments: list[dict[str, Any]] = Field(default_factory=list)


class AttachmentReplaceIn(BaseModel):
    originalFilename: str = ""


@router.get("/letters/{letter_id}/actions")
def get_actions(letter_id: int, db: Session = Depends(get_db)) -> dict:
    _require_enabled()
    letter = _get_letter(db, letter_id)
    actor = current_user_name(db)
    assert_letter_access(db, letter, actor)
    return marking_actions_payload(db, letter, actor)


@router.get("/letters/{letter_id}/tree")
def get_tree(letter_id: int, db: Session = Depends(get_db)) -> list[dict]:
    _require_enabled()
    letter = _get_letter(db, letter_id)
    actor = current_user_name(db)
    assert_letter_access(db, letter, actor)
    return marking_tree(db, letter_id, actor_name=actor)


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
        direction=payload.direction,
        common_notes=[n.model_dump() for n in payload.commonNotes],
        common_attachments=[a.model_dump() for a in payload.commonAttachments],
        consume_drafts=payload.consumeDrafts,
    )
    db.commit()
    db.refresh(batch)
    markings = db.query(Marking).filter(Marking.batch_id == batch.id).all()
    return {
        "batch": serialize_batch(batch),
        "markings": [serialize_marking(m) for m in markings],
        "letter": serialize_letter(letter, db=db, viewer=actor),
    }


@router.get("/paths/{path_id}")
def get_path(path_id: str, db: Session = Depends(get_db)) -> dict:
    """Return all markings on a workflow path (branch), ordered by creation."""
    _require_enabled()
    rows = markings_for_path(db, path_id)
    if not rows:
        raise HTTPException(status_code=404, detail="Path not found")
    letter = _get_letter(db, rows[0].letter_id)
    actor = current_user_name(db)
    assert_letter_access(db, letter, actor)
    return {
        "pathId": path_id,
        "letterId": str(letter.id),
        "markings": [serialize_marking(m) for m in rows],
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
    return {"marking": serialize_marking(marking), "letter": serialize_letter(letter, db=db, viewer=actor)}


@router.get("/letters/{letter_id}/drafts")
def get_drafts(letter_id: int, db: Session = Depends(get_db)) -> dict:
    _require_enabled()
    letter = _get_letter(db, letter_id)
    actor = current_user_name(db)
    assert_letter_access(db, letter, actor)
    return list_drafts(db, letter_id, actor)


@router.put("/letters/{letter_id}/drafts/roster")
def put_draft_roster(
    letter_id: int,
    payload: DraftRosterIn,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    _require_enabled()
    letter = _get_letter(db, letter_id)
    actor = current_user_name(db)
    assert_letter_access(db, letter, actor)
    rows = replace_draft_roster(
        db,
        letter=letter,
        actor_name=actor,
        recipients=[r.model_dump() for r in payload.recipients],
        client_ip=client_ip_from_request(request),
    )
    db.commit()
    for row in rows:
        db.refresh(row)
    return {
        "roster": [serialize_draft_recipient(r) for r in rows],
        "drafts": list_drafts(db, letter_id, actor),
    }


@router.post("/letters/{letter_id}/drafts/notes")
def post_draft_note(
    letter_id: int,
    payload: DraftNoteIn,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    _require_enabled()
    letter = _get_letter(db, letter_id)
    actor = current_user_name(db)
    assert_letter_access(db, letter, actor)
    row = add_draft_note(
        db,
        letter=letter,
        actor_name=actor,
        body_text=payload.bodyText,
        target_user=payload.targetUser,
        intent=payload.intent,
        client_ip=client_ip_from_request(request),
    )
    db.commit()
    db.refresh(row)
    return {"note": serialize_draft_note(row), "drafts": list_drafts(db, letter_id, actor)}


@router.post("/letters/{letter_id}/drafts/attachments")
def post_draft_attachments(
    letter_id: int,
    payload: DraftAttachmentsIn,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    _require_enabled()
    letter = _get_letter(db, letter_id)
    actor = current_user_name(db)
    assert_letter_access(db, letter, actor)
    created = add_draft_attachments(
        db,
        letter=letter,
        actor_name=actor,
        target_user=payload.targetUser,
        intent=payload.intent,
        attachments=payload.attachments,
        client_ip=client_ip_from_request(request),
    )
    db.commit()
    for row in created:
        db.refresh(row)
    return {
        "attachments": [serialize_draft_attachment(r) for r in created],
        "drafts": list_drafts(db, letter_id, actor),
    }


@router.patch("/drafts/notes/{note_id}")
def patch_draft_note(note_id: int, payload: NoteUpdateIn, db: Session = Depends(get_db)) -> dict:
    _require_enabled()
    row = db.get(CorrespondenceDraftNote, note_id)
    if not row:
        raise HTTPException(status_code=404, detail="Draft note not found")
    letter = _get_letter(db, row.letter_id)
    actor = current_user_name(db)
    assert_letter_access(db, letter, actor)
    updated = update_draft_note(db, note=row, actor_name=actor, body_text=payload.bodyText)
    db.commit()
    db.refresh(updated)
    return {"note": serialize_draft_note(updated), "drafts": list_drafts(db, letter.id, actor)}


@router.delete("/drafts/notes/{note_id}")
def remove_draft_note(note_id: int, db: Session = Depends(get_db)) -> dict:
    _require_enabled()
    row = db.get(CorrespondenceDraftNote, note_id)
    if not row:
        raise HTTPException(status_code=404, detail="Draft note not found")
    letter = _get_letter(db, row.letter_id)
    actor = current_user_name(db)
    assert_letter_access(db, letter, actor)
    delete_draft_note(db, note=row, actor_name=actor)
    db.commit()
    return {"ok": True, "drafts": list_drafts(db, letter.id, actor)}


@router.delete("/drafts/attachments/{attachment_id}")
def remove_draft_attachment(attachment_id: int, db: Session = Depends(get_db)) -> dict:
    _require_enabled()
    row = db.get(CorrespondenceDraftAttachment, attachment_id)
    if not row:
        raise HTTPException(status_code=404, detail="Draft attachment not found")
    letter = _get_letter(db, row.letter_id)
    actor = current_user_name(db)
    assert_letter_access(db, letter, actor)
    delete_draft_attachment(db, attachment=row, actor_name=actor)
    db.commit()
    return {"ok": True, "drafts": list_drafts(db, letter.id, actor)}


@router.get("/letters/{letter_id}/notes")
def get_notes(letter_id: int, db: Session = Depends(get_db)) -> list[dict]:
    _require_enabled()
    letter = _get_letter(db, letter_id)
    actor = current_user_name(db)
    assert_letter_access(db, letter, actor)
    return list_notes(db, letter_id, actor_name=actor)


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
        client_ip=client_ip_from_request(request),
    )
    db.commit()
    notes = list_notes(db, letter_id, actor_name=actor)
    created = next((n for n in notes if n["id"] == note.id), notes[-1] if notes else {})
    return {"note": created, "letter": serialize_letter(letter, db=db, viewer=actor)}


@router.get("/letters/{letter_id}/attachments")
def get_attachments(
    letter_id: int,
    include_deleted: bool = False,
    db: Session = Depends(get_db),
) -> list[dict]:
    _require_enabled()
    letter = _get_letter(db, letter_id)
    actor = current_user_name(db)
    assert_letter_access(db, letter, actor)
    return list_attachments(
        db, letter_id, actor_name=actor, include_deleted=include_deleted
    )


@router.get("/letters/{letter_id}/attachment-events")
def get_attachment_events(
    letter_id: int,
    marking_id: int | None = None,
    mine_only: bool = False,
    db: Session = Depends(get_db),
) -> list[dict]:
    """Per-level archive of add/replace/remove — juniors keep history when seniors replace files."""
    _require_enabled()
    letter = _get_letter(db, letter_id)
    actor = current_user_name(db)
    assert_letter_access(db, letter, actor)
    return list_attachment_events(
        db,
        letter_id,
        actor_name=actor,
        marking_id=marking_id,
        only_actor=actor if mine_only else None,
    )


@router.post("/letters/{letter_id}/attachments")
def post_letter_attachments(
    letter_id: int,
    payload: AttachmentsAddIn,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    _require_enabled()
    letter = _get_letter(db, letter_id)
    actor = current_user_name(db)
    assert_letter_access(db, letter, actor)
    created = add_attachments_to_marking(
        db,
        letter=letter,
        actor_name=actor,
        attachments=payload.attachments,
        marking_id=payload.markingId,
        client_ip=client_ip_from_request(request),
    )
    db.commit()
    return {
        "attachments": [serialize_attachment(db, row, editable=True) for row in created],
        "letter": serialize_letter(letter, db=db, viewer=actor),
    }


@router.patch("/notes/{note_id}")
def patch_note(
    note_id: int,
    payload: NoteUpdateIn,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    _require_enabled()
    note = db.get(CorrespondenceNote, note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    letter = _get_letter(db, note.letter_id)
    actor = current_user_name(db)
    assert_letter_access(db, letter, actor)
    update_note(
        db,
        note=note,
        actor_name=actor,
        body_text=payload.bodyText,
        client_ip=client_ip_from_request(request),
    )
    db.commit()
    notes = list_notes(db, letter.id, actor_name=actor)
    updated = next((n for n in notes if n["id"] == note_id), {})
    return {"note": updated, "letter": serialize_letter(letter, db=db, viewer=actor)}


@router.delete("/notes/{note_id}")
def remove_note(
    note_id: int,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    _require_enabled()
    note = db.get(CorrespondenceNote, note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    letter = _get_letter(db, note.letter_id)
    actor = current_user_name(db)
    assert_letter_access(db, letter, actor)
    delete_note(
        db,
        note=note,
        actor_name=actor,
        client_ip=client_ip_from_request(request),
    )
    db.commit()
    return {"ok": True, "letter": serialize_letter(letter, db=db, viewer=actor)}


def _attachment_letter(db: Session, attachment: CorrespondenceAttachment) -> Letter:
    if not attachment.letter_id:
        raise HTTPException(status_code=404, detail="Attachment is not linked to a letter")
    return _get_letter(db, attachment.letter_id)


@router.patch("/attachments/{attachment_id}")
def patch_attachment(
    attachment_id: int,
    payload: AttachmentUpdateIn,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    _require_enabled()
    attachment = db.get(CorrespondenceAttachment, attachment_id)
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    letter = _attachment_letter(db, attachment)
    actor = current_user_name(db)
    assert_letter_access(db, letter, actor)
    update_attachment_meta(
        db,
        attachment=attachment,
        actor_name=actor,
        attachment_kind=payload.attachmentKind,
        original_filename=payload.originalFilename,
        client_ip=client_ip_from_request(request),
    )
    db.commit()
    db.refresh(attachment)
    return {
        "attachment": serialize_attachment(db, attachment, editable=True),
        "letter": serialize_letter(letter, db=db, viewer=actor),
    }


@router.post("/attachments/{attachment_id}/replaced")
def attachment_replaced(
    attachment_id: int,
    payload: AttachmentReplaceIn,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    """After client uploads a new document version, refresh attachment metadata."""
    _require_enabled()
    attachment = db.get(CorrespondenceAttachment, attachment_id)
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    letter = _attachment_letter(db, attachment)
    actor = current_user_name(db)
    assert_letter_access(db, letter, actor)
    sync_attachment_after_replace(
        db,
        attachment=attachment,
        actor_name=actor,
        original_filename=payload.originalFilename or attachment.original_filename,
        client_ip=client_ip_from_request(request),
    )
    db.commit()
    db.refresh(attachment)
    return {
        "attachment": serialize_attachment(db, attachment, editable=True),
        "letter": serialize_letter(letter, db=db, viewer=actor),
    }


@router.delete("/attachments/{attachment_id}")
def remove_attachment(
    attachment_id: int,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    _require_enabled()
    attachment = db.get(CorrespondenceAttachment, attachment_id)
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    letter = _attachment_letter(db, attachment)
    actor = current_user_name(db)
    assert_letter_access(db, letter, actor)
    delete_attachment(
        db,
        attachment=attachment,
        actor_name=actor,
        client_ip=client_ip_from_request(request),
    )
    db.commit()
    return {"ok": True, "letter": serialize_letter(letter, db=db, viewer=actor)}


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
        client_ip=client_ip_from_request(request),
    )
    db.commit()
    db.refresh(marking)
    notes = list_notes(db, letter_id=letter.id, actor_name=actor)
    created = next((n for n in notes if n["id"] == note.id), {})
    return {
        "note": created,
        "marking": serialize_marking(marking),
        "letter": serialize_letter(letter, db=db, viewer=actor),
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
    return {"letter": serialize_letter(letter, db=db, viewer=actor)}
