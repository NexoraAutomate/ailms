"""Simple correspondence marking workflow (specs 02–04)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import (
    CorrespondenceAttachment,
    CorrespondenceNote,
    DocumentVersion,
    Letter,
    Marking,
    MarkingBatch,
    MarkingSubscription,
    User,
)
from app.services import add_audit, add_notification, normalize_role, resolve_user_role
from app.storage_service import can_preview

MARKING_ACTIONS = frozenset({"forward", "for_info", "response_required"})
RESPONSE_TYPES = frozenset(
    {"draft_letter", "presentation", "nominations", "comments", "other"}
)
ATTACHMENT_KINDS = frozenset(
    {"Presentation", "Draft Response", "Supporting Doc", "Nomination List", "Other"}
)
OPEN_LETTER = "Open"
CLOSED_LETTER = "Closed"
ARCHIVED_LETTER = "Archived"


def _user_by_name(db: Session, name: str) -> User | None:
    return db.query(User).filter(User.name == name).one_or_none()


def _is_viewer(db: Session, actor_name: str) -> bool:
    return normalize_role(resolve_user_role(db, actor_name)) == "Viewer"


def _is_admin(db: Session, actor_name: str) -> bool:
    role = normalize_role(resolve_user_role(db, actor_name))
    return role in {"Admin", "Administrator"}


def initiator_name(letter: Letter) -> str:
    return (letter.created_by or "").strip()


def is_initiator(letter: Letter, actor_name: str) -> bool:
    return initiator_name(letter) == (actor_name or "").strip()


def has_active_markings(db: Session, letter_id: int) -> bool:
    return (
        db.query(Marking.id)
        .filter(Marking.letter_id == letter_id, Marking.status == "active")
        .first()
        is not None
    )


def letter_ids_with_active_markings(db: Session, letter_ids: list[int]) -> set[int]:
    if not letter_ids:
        return set()
    rows = (
        db.query(Marking.letter_id)
        .filter(Marking.letter_id.in_(letter_ids), Marking.status == "active")
        .distinct()
        .all()
    )
    return {int(row[0]) for row in rows}


def can_edit_letter_details(
    db: Session,
    letter: Letter,
    actor_name: str,
    *,
    has_active: bool | None = None,
) -> bool:
    """
    Initiator may edit registration details only until the letter is marked onward.
    Revoking every active marking restores editability for the initiator.
    """
    if letter.is_archived or letter.status in {CLOSED_LETTER, ARCHIVED_LETTER}:
        return False
    if not is_initiator(letter, actor_name):
        return False
    active = has_active_markings(db, letter.id) if has_active is None else has_active
    return not active


def assert_can_edit_letter_details(db: Session, letter: Letter, actor_name: str) -> None:
    if can_edit_letter_details(db, letter, actor_name):
        return
    if not is_initiator(letter, actor_name):
        raise HTTPException(
            status_code=403,
            detail="Only the user who registered this correspondence can edit its details",
        )
    if letter.is_archived or letter.status in {CLOSED_LETTER, ARCHIVED_LETTER}:
        raise HTTPException(status_code=400, detail="Closed or archived correspondence cannot be edited")
    raise HTTPException(
        status_code=403,
        detail="Correspondence details cannot be edited after the letter has been marked to another user",
    )


def marking_has_children(db: Session, marking_id: int) -> bool:
    """True if this marking was remade onward (has an active child).

    Revoked remakes do not count — after revoke, the parent leaf hold is restored.
    """
    return (
        db.query(Marking.id)
        .filter(
            Marking.parent_marking_id == marking_id,
            Marking.status == "active",
        )
        .first()
        is not None
    )


def marking_recipient_has_activity(db: Session, marking: Marking) -> bool:
    """True if the marked-to user has added comments or attachments on this marking."""
    recipient = (marking.to_user or "").strip()
    if not recipient:
        return False
    has_note = (
        db.query(CorrespondenceNote.id)
        .filter(
            CorrespondenceNote.marking_id == marking.id,
            CorrespondenceNote.author_user == recipient,
        )
        .first()
        is not None
    )
    if has_note:
        return True
    return (
        db.query(CorrespondenceAttachment.id)
        .filter(
            CorrespondenceAttachment.marking_id == marking.id,
            CorrespondenceAttachment.created_by == recipient,
        )
        .first()
        is not None
    )


def marking_is_revokable(db: Session, marking: Marking) -> bool:
    """Last marker may revoke only while recipient has not remade or contributed."""
    if marking.status != "active":
        return False
    if marking_has_children(db, marking.id):
        return False
    if marking_recipient_has_activity(db, marking):
        return False
    return True


def leaf_inbound_markings(db: Session, letter_id: int, user_name: str) -> list[Marking]:
    """Active markings to the user that have not been remade onward."""
    name = (user_name or "").strip()
    if not name:
        return []
    inbound = (
        db.query(Marking)
        .filter(
            Marking.letter_id == letter_id,
            Marking.to_user == name,
            Marking.status == "active",
        )
        .order_by(Marking.id.asc())
        .all()
    )
    return [m for m in inbound if not marking_has_children(db, m.id)]


def user_holds_letter(db: Session, letter: Letter, actor_name: str) -> bool:
    """
    Holder may mark / note / close.
    After marking onward, the marker is no longer a holder (revoke-only until remade).
    """
    name = (actor_name or "").strip()
    if not name:
        return False
    if is_initiator(letter, name) and not has_active_markings(db, letter.id):
        return True
    return len(leaf_inbound_markings(db, letter.id, name)) > 0


def assert_can_mutate(db: Session, letter: Letter, actor_name: str) -> None:
    if letter.is_archived or letter.status == ARCHIVED_LETTER:
        raise HTTPException(status_code=400, detail="Letter is archived")
    if letter.status == CLOSED_LETTER:
        raise HTTPException(status_code=400, detail="Letter is closed")
    if letter.status not in {OPEN_LETTER, "Registered", "LLM Analyzed"} and letter.status != OPEN_LETTER:
        # Allow pre-migration statuses until migrate runs; treat non-closed as open-ish
        if letter.status in {CLOSED_LETTER, ARCHIVED_LETTER}:
            raise HTTPException(status_code=400, detail=f"Cannot mutate letter in status '{letter.status}'")
    if _is_viewer(db, actor_name):
        raise HTTPException(status_code=403, detail="Viewers cannot modify workflow")
    if not user_holds_letter(db, letter, actor_name) and not _is_admin(db, actor_name):
        raise HTTPException(status_code=403, detail="You do not currently hold this correspondence")


def serialize_marking(row: Marking, children: list[dict] | None = None) -> dict:
    return {
        "id": row.id,
        "batchId": row.batch_id,
        "letterId": str(row.letter_id),
        "parentMarkingId": row.parent_marking_id,
        "fromUser": row.from_user,
        "toUser": row.to_user,
        "action": row.action,
        "responseType": row.response_type,
        "responseTypeOther": row.response_type_other,
        "instructions": row.instructions,
        "dueAt": row.due_at.isoformat() if row.due_at else "",
        "priority": row.priority,
        "track": row.track,
        "remindersEnabled": row.reminders_enabled,
        "status": row.status,
        "clientIp": row.client_ip,
        "createdAt": row.created_at.isoformat() if row.created_at else "",
        "revokedAt": row.revoked_at.isoformat() if row.revoked_at else "",
        "revokedBy": row.revoked_by,
        "respondedAt": row.responded_at.isoformat() if row.responded_at else "",
        "responseNoteId": row.response_note_id,
        "children": children or [],
    }


def serialize_batch(row: MarkingBatch) -> dict:
    return {
        "id": row.id,
        "letterId": str(row.letter_id),
        "fromUser": row.from_user,
        "remarks": row.remarks,
        "pathwayNotify": row.pathway_notify,
        "clientIp": row.client_ip,
        "createdAt": row.created_at.isoformat() if row.created_at else "",
    }


def marking_tree(db: Session, letter_id: int) -> list[dict]:
    rows = (
        db.query(Marking)
        .filter(Marking.letter_id == letter_id)
        .order_by(Marking.id.asc())
        .all()
    )
    by_parent: dict[int | None, list[Marking]] = {}
    for row in rows:
        by_parent.setdefault(row.parent_marking_id, []).append(row)

    def build(parent_id: int | None) -> list[dict]:
        return [serialize_marking(m, build(m.id)) for m in by_parent.get(parent_id, [])]

    return build(None)


def create_mark_batch(
    db: Session,
    *,
    letter: Letter,
    actor_name: str,
    recipients: list[dict[str, Any]],
    remarks: str = "",
    pathway_notify: bool = False,
    parent_marking_id: int | None = None,
    client_ip: str = "",
) -> MarkingBatch:
    assert_can_mutate(db, letter, actor_name)
    if letter.status not in {CLOSED_LETTER, ARCHIVED_LETTER} and letter.status != OPEN_LETTER:
        # Normalize in-place for new activity
        if letter.status not in {OPEN_LETTER}:
            letter.status = OPEN_LETTER

    if not recipients:
        raise HTTPException(status_code=400, detail="At least one recipient is required")

    parent: Marking | None = None
    if parent_marking_id is not None:
        parent = db.get(Marking, parent_marking_id)
        if not parent or parent.letter_id != letter.id:
            raise HTTPException(status_code=400, detail="Invalid parentMarkingId")
        if parent.status != "active":
            raise HTTPException(status_code=400, detail="Parent marking is not active")
        if parent.to_user != actor_name and not _is_admin(db, actor_name):
            raise HTTPException(status_code=403, detail="Parent marking is not addressed to you")
        if marking_has_children(db, parent.id):
            raise HTTPException(status_code=400, detail="Parent marking was already remade onward")
    else:
        # Auto-link to the sole leaf inbound so remake blocks prior marker's revoke.
        leaves = leaf_inbound_markings(db, letter.id, actor_name)
        if len(leaves) == 1:
            parent = leaves[0]
        elif len(leaves) > 1:
            raise HTTPException(
                status_code=400,
                detail="parentMarkingId is required when you hold multiple active markings",
            )

    seen: set[str] = set()
    normalized: list[dict[str, Any]] = []
    for raw in recipients:
        to_user = str(raw.get("toUser") or raw.get("to_user") or "").strip()
        action = str(raw.get("action") or "forward").strip()
        if not to_user:
            raise HTTPException(status_code=400, detail="toUser is required")
        if to_user == actor_name:
            raise HTTPException(status_code=400, detail="Cannot mark correspondence to yourself")
        if to_user in seen:
            raise HTTPException(status_code=400, detail=f"Duplicate recipient '{to_user}' in batch")
        seen.add(to_user)
        if not _user_by_name(db, to_user):
            raise HTTPException(status_code=400, detail=f"Unknown user '{to_user}'")
        if action not in MARKING_ACTIONS:
            raise HTTPException(status_code=400, detail=f"Invalid action '{action}'")

        response_type = str(raw.get("responseType") or raw.get("response_type") or "").strip()
        response_type_other = str(
            raw.get("responseTypeOther") or raw.get("response_type_other") or ""
        ).strip()
        if action == "response_required":
            if response_type not in RESPONSE_TYPES:
                raise HTTPException(status_code=400, detail="responseType required for Response Required")
            if response_type == "other" and not response_type_other:
                raise HTTPException(status_code=400, detail="responseTypeOther required when type is other")

        due_raw = raw.get("dueAt") or raw.get("due_at")
        due_at: date | None = None
        if due_raw:
            due_at = date.fromisoformat(str(due_raw)[:10])
        elif action == "response_required":
            due_at = None

        track = bool(raw.get("track", True))
        reminders_enabled = bool(
            raw.get("remindersEnabled", raw.get("reminders_enabled", action == "response_required" and track))
        )
        if action != "response_required":
            reminders_enabled = False
            response_type = ""
            response_type_other = ""

        # Only block while an outstanding leaf mark to this user still exists.
        # Prior marks that were remade onward (have children) must not prevent
        # marking the same person again after the correspondence returns.
        outstanding = (
            db.query(Marking)
            .filter(
                Marking.letter_id == letter.id,
                Marking.from_user == actor_name,
                Marking.to_user == to_user,
                Marking.status == "active",
            )
            .all()
        )
        if any(not marking_has_children(db, m.id) for m in outstanding):
            raise HTTPException(
                status_code=400,
                detail=f"Active marking already exists from you to '{to_user}'",
            )

        normalized.append(
            {
                "to_user": to_user,
                "action": action,
                "response_type": response_type,
                "response_type_other": response_type_other,
                "instructions": str(raw.get("instructions") or "").strip(),
                "due_at": due_at,
                "priority": str(raw.get("priority") or letter.priority or "Routine"),
                "track": track,
                "reminders_enabled": reminders_enabled,
            }
        )

    actor = _user_by_name(db, actor_name)
    batch = MarkingBatch(
        letter_id=letter.id,
        from_user=actor_name,
        from_user_id=actor.id if actor else None,
        remarks=(remarks or "").strip(),
        pathway_notify=bool(pathway_notify),
        client_ip=client_ip or "",
    )
    db.add(batch)
    db.flush()

    if pathway_notify:
        db.add(
            MarkingSubscription(
                letter_id=letter.id,
                batch_id=batch.id,
                user_name=actor_name,
                active=True,
            )
        )

    created: list[Marking] = []
    for item in normalized:
        marking = Marking(
            batch_id=batch.id,
            letter_id=letter.id,
            parent_marking_id=parent.id if parent else None,
            from_user=actor_name,
            to_user=item["to_user"],
            action=item["action"],
            response_type=item["response_type"],
            response_type_other=item["response_type_other"],
            instructions=item["instructions"],
            due_at=item["due_at"],
            priority=item["priority"],
            track=item["track"],
            reminders_enabled=item["reminders_enabled"],
            status="active",
            client_ip=client_ip or "",
        )
        db.add(marking)
        created.append(marking)
    db.flush()

    # Compatibility fields for legacy list views
    primary = next((m for m in created if m.action == "response_required"), created[0])
    letter.assigned_to = primary.to_user
    letter.assigned_by = actor_name
    letter.last_action = f"Marked ({primary.action})"
    letter.status = OPEN_LETTER

    for marking in created:
        add_notification(
            db,
            title="Correspondence Marked",
            description=f"{letter.number}: marked to you ({marking.action.replace('_', ' ')}) by {actor_name}.",
            priority=marking.priority or "Medium",
            letter_id=letter.id,
            notification_type="Correspondence Marked",
            recipient_name=marking.to_user,
            related_entity_type="marking",
            related_entity_id=str(marking.id),
        )

    _notify_pathway(
        db,
        letter=letter,
        actor_name=actor_name,
        title="Pathway Update",
        description=f"{letter.number}: {actor_name} marked {len(created)} recipient(s).",
        skip_user=actor_name,
    )

    add_audit(
        db,
        user=actor_name,
        module="Marking",
        action="Mark",
        record=letter.number,
        description=f"Marked to {len(created)} recipient(s).",
        source=f"Web · {client_ip or 'unknown'}",
    )
    db.flush()
    return batch


def revoke_marking(
    db: Session,
    *,
    marking: Marking,
    actor_name: str,
    remarks: str = "",
    client_ip: str = "",
) -> Marking:
    letter = db.get(Letter, marking.letter_id)
    if not letter:
        raise HTTPException(status_code=404, detail="Letter not found")
    if letter.status == CLOSED_LETTER:
        raise HTTPException(status_code=400, detail="Letter is closed")
    if marking.from_user != actor_name and not _is_admin(db, actor_name):
        raise HTTPException(status_code=403, detail="Only the marker can revoke")
    if marking.status != "active":
        raise HTTPException(status_code=400, detail="Marking is not active")
    if marking_has_children(db, marking.id):
        raise HTTPException(
            status_code=409,
            detail="Cannot revoke: recipient has already marked this correspondence onward",
        )
    if marking_recipient_has_activity(db, marking):
        raise HTTPException(
            status_code=409,
            detail="Cannot revoke: recipient has already added comments or attachments",
        )

    marking.status = "revoked"
    marking.revoked_at = datetime.utcnow()
    marking.revoked_by = actor_name
    marking.revoke_ip = client_ip or ""

    add_notification(
        db,
        title="Marking Revoked",
        description=f"{letter.number}: a marking to you was revoked by {actor_name}."
        + (f" {remarks}" if remarks else ""),
        priority="Medium",
        letter_id=letter.id,
        notification_type="Marking Revoked",
        recipient_name=marking.to_user,
        related_entity_type="marking",
        related_entity_id=str(marking.id),
    )
    add_audit(
        db,
        user=actor_name,
        module="Marking",
        action="Revoke",
        record=letter.number,
        description=remarks or f"Revoked marking #{marking.id} to {marking.to_user}",
        source=f"Web · {client_ip or 'unknown'}",
    )
    db.flush()
    return marking


def resolve_hold_marking_id(
    db: Session,
    letter: Letter,
    actor_name: str,
    marking_id: int | None = None,
) -> int | None:
    """Marking incident for the actor's current hold (None = initiator root)."""
    if marking_id is not None:
        marking = db.get(Marking, marking_id)
        if not marking or marking.letter_id != letter.id:
            raise HTTPException(status_code=400, detail="Invalid markingId")
        if marking.to_user != actor_name and not _is_admin(db, actor_name):
            raise HTTPException(status_code=403, detail="Marking is not addressed to you")
        if marking.status != "active" and not _is_admin(db, actor_name):
            raise HTTPException(status_code=400, detail="Marking is not active")
        if marking_has_children(db, marking.id) and not _is_admin(db, actor_name):
            raise HTTPException(status_code=400, detail="Marking was already remade onward")
        return marking.id
    leaves = leaf_inbound_markings(db, letter.id, actor_name)
    if len(leaves) == 1:
        return leaves[0].id
    if len(leaves) > 1:
        raise HTTPException(
            status_code=400,
            detail="markingId is required when you hold multiple active markings",
        )
    if is_initiator(letter, actor_name) and not has_active_markings(db, letter.id):
        return None
    if _is_admin(db, actor_name):
        return None
    raise HTTPException(status_code=403, detail="You do not currently hold this correspondence")


def add_note(
    db: Session,
    *,
    letter: Letter,
    actor_name: str,
    body_text: str,
    marking_id: int | None = None,
    is_response: bool = False,
    client_ip: str = "",
) -> CorrespondenceNote:
    assert_can_mutate(db, letter, actor_name)
    body = (body_text or "").strip()
    if not body:
        raise HTTPException(status_code=400, detail="bodyText is required")

    resolved_marking_id = resolve_hold_marking_id(db, letter, actor_name, marking_id)
    marking = db.get(Marking, resolved_marking_id) if resolved_marking_id else None

    if is_response:
        if not marking:
            raise HTTPException(status_code=400, detail="markingId required when submitting a response")
        if marking.action != "response_required" or marking.status != "active":
            raise HTTPException(status_code=400, detail="Marking is not an open Response Required")
        if marking.to_user != actor_name and not _is_admin(db, actor_name):
            raise HTTPException(status_code=403, detail="Only the assignee can submit this response")

    note = CorrespondenceNote(
        letter_id=letter.id,
        marking_id=resolved_marking_id,
        author_user=actor_name,
        body_text=body,
        is_response=bool(is_response),
        client_ip=client_ip or "",
    )
    db.add(note)
    db.flush()

    if is_response and marking:
        marking.status = "responded"
        marking.responded_at = datetime.utcnow()
        marking.response_note_id = note.id
        add_notification(
            db,
            title="Response Received",
            description=f"{letter.number}: {actor_name} submitted a response.",
            priority="High",
            letter_id=letter.id,
            notification_type="Response Received",
            recipient_name=marking.from_user,
            related_entity_type="marking",
            related_entity_id=str(marking.id),
        )

    _notify_pathway(
        db,
        letter=letter,
        actor_name=actor_name,
        title="Pathway Update",
        description=f"{letter.number}: note added by {actor_name}.",
        skip_user=actor_name,
    )
    add_audit(
        db,
        user=actor_name,
        module="Marking",
        action="Note" if not is_response else "Respond",
        record=letter.number,
        description=body[:200],
        source=f"Web · {client_ip or 'unknown'}",
    )
    db.flush()
    return note


def serialize_attachment(db: Session, row: CorrespondenceAttachment, *, editable: bool = False) -> dict:
    version_id: int | None = None
    previewable = False
    mime_type = ""
    filename = row.original_filename or ""
    if row.document_id:
        current = (
            db.query(DocumentVersion)
            .filter(
                DocumentVersion.document_id == row.document_id,
                DocumentVersion.is_current.is_(True),
            )
            .order_by(DocumentVersion.id.desc())
            .first()
        )
        if not current:
            current = (
                db.query(DocumentVersion)
                .filter(DocumentVersion.document_id == row.document_id)
                .order_by(DocumentVersion.id.desc())
                .first()
            )
        if current:
            version_id = current.id
            previewable = can_preview(current.file_type or "")
            mime_type = current.mime_type or ""
            filename = filename or current.original_filename or ""
    return {
        "id": row.id,
        "letterId": str(row.letter_id) if row.letter_id else "",
        "markingId": row.marking_id,
        "createdBy": row.created_by,
        "documentId": row.document_id,
        "versionId": version_id,
        "previewable": previewable,
        "mimeType": mime_type,
        "attachmentKind": row.attachment_kind,
        "storageKey": row.storage_key,
        "originalFilename": filename,
        "clientIp": row.client_ip,
        "createdAt": row.created_at.isoformat() if row.created_at else "",
        "editable": editable,
    }


def note_is_editable(db: Session, note: CorrespondenceNote, actor_name: str) -> bool:
    """Author (or Admin) may edit only while they still hold the letter."""
    if _is_viewer(db, actor_name):
        return False
    letter = db.get(Letter, note.letter_id)
    if not letter or letter.status in {CLOSED_LETTER, ARCHIVED_LETTER} or letter.is_archived:
        return False
    if _is_admin(db, actor_name):
        return True
    if note.author_user != actor_name:
        return False
    return user_holds_letter(db, letter, actor_name)


def attachment_is_editable(
    db: Session, attachment: CorrespondenceAttachment, actor_name: str
) -> bool:
    if _is_viewer(db, actor_name):
        return False
    letter = db.get(Letter, attachment.letter_id)
    if not letter or letter.status in {CLOSED_LETTER, ARCHIVED_LETTER} or letter.is_archived:
        return False
    if _is_admin(db, actor_name):
        return True
    if (attachment.created_by or "").strip() != actor_name:
        return False
    return user_holds_letter(db, letter, actor_name)


def assert_note_editable(db: Session, note: CorrespondenceNote, actor_name: str) -> Letter:
    letter = db.get(Letter, note.letter_id)
    if not letter:
        raise HTTPException(status_code=404, detail="Letter not found")
    if not note_is_editable(db, note, actor_name):
        raise HTTPException(
            status_code=403,
            detail="Notes are locked after you mark the correspondence onward",
        )
    return letter


def assert_attachment_editable(
    db: Session, attachment: CorrespondenceAttachment, actor_name: str
) -> Letter:
    letter = db.get(Letter, attachment.letter_id)
    if not letter:
        raise HTTPException(status_code=404, detail="Letter not found")
    if not attachment_is_editable(db, attachment, actor_name):
        raise HTTPException(
            status_code=403,
            detail="Attachments are locked after you mark the correspondence onward",
        )
    return letter


def list_notes(db: Session, letter_id: int, actor_name: str | None = None) -> list[dict]:
    notes = (
        db.query(CorrespondenceNote)
        .filter(CorrespondenceNote.letter_id == letter_id)
        .order_by(CorrespondenceNote.id.desc())
        .all()
    )
    out: list[dict] = []
    for note in notes:
        editable = note_is_editable(db, note, actor_name) if actor_name else False
        out.append(
            {
                "id": note.id,
                "letterId": str(note.letter_id),
                "markingId": note.marking_id,
                "authorUser": note.author_user,
                "bodyText": note.body_text,
                "isResponse": note.is_response,
                "clientIp": note.client_ip,
                "createdAt": note.created_at.isoformat() if note.created_at else "",
                "editable": editable,
            }
        )
    return out


def list_attachments(db: Session, letter_id: int, actor_name: str | None = None) -> list[dict]:
    rows = (
        db.query(CorrespondenceAttachment)
        .filter(CorrespondenceAttachment.letter_id == letter_id)
        .order_by(CorrespondenceAttachment.id.desc())
        .all()
    )
    return [
        serialize_attachment(
            db,
            row,
            editable=attachment_is_editable(db, row, actor_name) if actor_name else False,
        )
        for row in rows
    ]


def update_note(
    db: Session,
    *,
    note: CorrespondenceNote,
    actor_name: str,
    body_text: str,
    client_ip: str = "",
) -> CorrespondenceNote:
    letter = assert_note_editable(db, note, actor_name)
    body = (body_text or "").strip()
    if not body:
        raise HTTPException(status_code=400, detail="bodyText is required")
    note.body_text = body
    add_audit(
        db,
        user=actor_name,
        module="Marking",
        action="Edit note",
        record=letter.number,
        description=body[:200],
        source=f"Web · {client_ip or 'unknown'}",
    )
    db.flush()
    return note


def delete_note(
    db: Session,
    *,
    note: CorrespondenceNote,
    actor_name: str,
    client_ip: str = "",
) -> None:
    letter = assert_note_editable(db, note, actor_name)
    linked = (
        db.query(Marking)
        .filter(Marking.response_note_id == note.id)
        .all()
    )
    for marking in linked:
        marking.response_note_id = None
        if marking.status == "responded":
            marking.status = "active"
            marking.responded_at = None
    note_id = note.id
    db.delete(note)
    add_audit(
        db,
        user=actor_name,
        module="Marking",
        action="Delete note",
        record=letter.number,
        description=f"Deleted note #{note_id}",
        source=f"Web · {client_ip or 'unknown'}",
    )
    db.flush()


def delete_attachment(
    db: Session,
    *,
    attachment: CorrespondenceAttachment,
    actor_name: str,
    client_ip: str = "",
) -> None:
    letter = assert_attachment_editable(db, attachment, actor_name)
    db.delete(attachment)
    add_audit(
        db,
        user=actor_name,
        module="Marking",
        action="Delete attachment",
        record=letter.number,
        description=attachment.original_filename or f"attachment #{attachment.id}",
        source=f"Web · {client_ip or 'unknown'}",
    )
    db.flush()


def update_attachment_meta(
    db: Session,
    *,
    attachment: CorrespondenceAttachment,
    actor_name: str,
    attachment_kind: str | None = None,
    original_filename: str | None = None,
    client_ip: str = "",
) -> CorrespondenceAttachment:
    letter = assert_attachment_editable(db, attachment, actor_name)
    if attachment_kind is not None:
        kind = attachment_kind.strip()
        if kind not in ATTACHMENT_KINDS:
            raise HTTPException(status_code=400, detail=f"Invalid attachmentKind '{kind}'")
        attachment.attachment_kind = kind
    if original_filename is not None:
        attachment.original_filename = original_filename.strip()
    add_audit(
        db,
        user=actor_name,
        module="Marking",
        action="Update attachment",
        record=letter.number,
        description=f"attachment #{attachment.id}",
        source=f"Web · {client_ip or 'unknown'}",
    )
    db.flush()
    return attachment


def add_attachments_to_marking(
    db: Session,
    *,
    letter: Letter,
    actor_name: str,
    attachments: list[dict],
    marking_id: int | None = None,
    client_ip: str = "",
) -> list[CorrespondenceAttachment]:
    assert_can_mutate(db, letter, actor_name)
    resolved = resolve_hold_marking_id(db, letter, actor_name, marking_id)
    created: list[CorrespondenceAttachment] = []
    for att in attachments:
        kind = str(att.get("attachmentKind") or att.get("attachment_kind") or "Other")
        if kind not in ATTACHMENT_KINDS:
            raise HTTPException(status_code=400, detail=f"Invalid attachmentKind '{kind}'")
        row = CorrespondenceAttachment(
            letter_id=letter.id,
            marking_id=resolved,
            note_id=None,
            created_by=actor_name,
            document_id=att.get("documentId") or att.get("document_id"),
            attachment_kind=kind,
            storage_key=str(att.get("storageKey") or att.get("storage_key") or ""),
            original_filename=str(
                att.get("originalFilename") or att.get("original_filename") or ""
            ),
            client_ip=client_ip or "",
        )
        db.add(row)
        created.append(row)
    db.flush()
    add_audit(
        db,
        user=actor_name,
        module="Marking",
        action="Add attachments",
        record=letter.number,
        description=f"Added {len(created)} file(s) to marking incident",
        source=f"Web · {client_ip or 'unknown'}",
    )
    return created


def sync_attachment_after_replace(
    db: Session,
    *,
    attachment: CorrespondenceAttachment,
    actor_name: str,
    original_filename: str,
    client_ip: str = "",
) -> CorrespondenceAttachment:
    """Call after uploading a new document version for the same document_id."""
    letter = assert_attachment_editable(db, attachment, actor_name)
    attachment.original_filename = original_filename
    attachment.client_ip = client_ip or attachment.client_ip
    add_audit(
        db,
        user=actor_name,
        module="Marking",
        action="Replace attachment",
        record=letter.number,
        description=original_filename,
        source=f"Web · {client_ip or 'unknown'}",
    )
    db.flush()
    return attachment


def list_tracked(db: Session, actor_name: str) -> list[dict]:
    rows = (
        db.query(Marking)
        .filter(
            Marking.from_user == actor_name,
            Marking.track.is_(True),
            Marking.status == "active",
        )
        .order_by(Marking.id.desc())
        .all()
    )
    return [serialize_marking(r) for r in rows]


def batch_tracker(db: Session, batch_id: int, actor_name: str) -> dict:
    batch = db.get(MarkingBatch, batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    if batch.from_user != actor_name and not _is_admin(db, actor_name):
        raise HTTPException(status_code=403, detail="Only the marker can view this tracker")
    markings = db.query(Marking).filter(Marking.batch_id == batch_id).order_by(Marking.id.asc()).all()
    pending = [m for m in markings if m.action == "response_required" and m.status == "active"]
    responded = [m for m in markings if m.action == "response_required" and m.status == "responded"]
    return {
        "batch": serialize_batch(batch),
        "markings": [serialize_marking(m) for m in markings],
        "pendingCount": len(pending),
        "respondedCount": len(responded),
        "allResponsesReceived": len(pending) == 0 and len(responded) >= 0 and (
            any(m.action == "response_required" for m in markings) and len(pending) == 0
            or not any(m.action == "response_required" for m in markings)
        ),
    }


def close_letter(
    db: Session,
    *,
    letter: Letter,
    actor_name: str,
    remarks: str = "",
    force: bool = False,
    client_ip: str = "",
) -> Letter:
    if not is_initiator(letter, actor_name) and not _is_admin(db, actor_name):
        raise HTTPException(status_code=403, detail="Only the initiator can close this correspondence")
    if letter.status == CLOSED_LETTER:
        raise HTTPException(status_code=400, detail="Letter is already closed")
    if letter.is_archived or letter.status == ARCHIVED_LETTER:
        raise HTTPException(status_code=400, detail="Letter is archived")
    if not user_holds_letter(db, letter, actor_name) and not _is_admin(db, actor_name):
        raise HTTPException(status_code=403, detail="Initiator must currently hold the correspondence to close")

    open_rr = (
        db.query(Marking)
        .filter(
            Marking.letter_id == letter.id,
            Marking.action == "response_required",
            Marking.status == "active",
        )
        .all()
    )
    if open_rr and not force:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "OPEN_RESPONSES",
                "message": "Open Response Required markings remain; pass force=true to close anyway",
                "pending": [serialize_marking(m) for m in open_rr],
            },
        )

    letter.status = CLOSED_LETTER
    letter.closed_at = datetime.utcnow()
    letter.closed_by = actor_name
    letter.close_ip = client_ip or ""
    letter.last_action = "Closed"
    if remarks:
        letter.remarks = ((letter.remarks or "") + f"\n[Close] {remarks}").strip()

    actives = (
        db.query(Marking)
        .filter(Marking.letter_id == letter.id, Marking.status == "active")
        .all()
    )
    for m in actives:
        m.status = "superseded"

    participants = {m.from_user for m in db.query(Marking).filter(Marking.letter_id == letter.id).all()}
    participants |= {m.to_user for m in db.query(Marking).filter(Marking.letter_id == letter.id).all()}
    participants.add(initiator_name(letter))
    for name in participants:
        if not name or name == actor_name:
            continue
        add_notification(
            db,
            title="Correspondence Closed",
            description=f"{letter.number}: closed by {actor_name}.",
            priority="Medium",
            letter_id=letter.id,
            notification_type="Correspondence Closed",
            recipient_name=name,
        )

    add_audit(
        db,
        user=actor_name,
        module="Marking",
        action="Close",
        record=letter.number,
        description=remarks or "Correspondence closed",
        source=f"Web · {client_ip or 'unknown'}",
    )
    db.flush()
    return letter


def available_marking_actions(db: Session, letter: Letter, actor_name: str) -> list[str]:
    if letter.is_archived or letter.status in {ARCHIVED_LETTER, CLOSED_LETTER}:
        actions: list[str] = []
    elif _is_viewer(db, actor_name):
        actions = []
    else:
        actions = []
        holds = user_holds_letter(db, letter, actor_name)
        # After marking onward, marker is revoke-only (Admin may still mutate).
        if holds or _is_admin(db, actor_name):
            actions.extend(["mark", "add_note"])
            leaves = leaf_inbound_markings(db, letter.id, actor_name)
            if any(m.action == "response_required" for m in leaves):
                actions.append("respond")
        if is_initiator(letter, actor_name) and holds:
            actions.append("close")
        # Revoke only while recipient has not remade onward or contributed.
        outbound = (
            db.query(Marking)
            .filter(
                Marking.letter_id == letter.id,
                Marking.from_user == actor_name,
                Marking.status == "active",
            )
            .all()
        )
        if any(marking_is_revokable(db, m) for m in outbound):
            actions.append("revoke")
    return actions


def _notify_pathway(
    db: Session,
    *,
    letter: Letter,
    actor_name: str,
    title: str,
    description: str,
    skip_user: str,
) -> None:
    subs = (
        db.query(MarkingSubscription)
        .filter(
            MarkingSubscription.letter_id == letter.id,
            MarkingSubscription.active.is_(True),
        )
        .all()
    )
    seen: set[str] = set()
    for sub in subs:
        if sub.user_name in seen or sub.user_name == skip_user:
            continue
        seen.add(sub.user_name)
        add_notification(
            db,
            title=title,
            description=description,
            priority="Low",
            letter_id=letter.id,
            notification_type="Pathway Update",
            recipient_name=sub.user_name,
        )


def letter_ids_marked_to_user(db: Session, user_name: str) -> set[int]:
    rows = (
        db.query(Marking.letter_id)
        .filter(Marking.to_user == user_name, Marking.status == "active")
        .distinct()
        .all()
    )
    return {r[0] for r in rows}


def letter_ids_marked_by_user(db: Session, user_name: str) -> set[int]:
    rows = db.query(Marking.letter_id).filter(Marking.from_user == user_name).distinct().all()
    return {r[0] for r in rows}


def user_on_marking(db: Session, letter_id: int, user_name: str) -> bool:
    return (
        db.query(Marking.id)
        .filter(
            Marking.letter_id == letter_id,
            (Marking.from_user == user_name) | (Marking.to_user == user_name),
        )
        .first()
        is not None
    )
