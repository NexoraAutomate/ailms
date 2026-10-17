"""Simple correspondence marking workflow (specs 02–04)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import (
    CorrespondenceAttachment,
    CorrespondenceNote,
    Letter,
    Marking,
    MarkingBatch,
    MarkingSubscription,
    User,
)
from app.services import add_audit, add_notification, normalize_role, resolve_user_role

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


def marking_has_children(db: Session, marking_id: int) -> bool:
    return (
        db.query(Marking.id).filter(Marking.parent_marking_id == marking_id).first() is not None
    )


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

        dup = (
            db.query(Marking.id)
            .filter(
                Marking.letter_id == letter.id,
                Marking.from_user == actor_name,
                Marking.to_user == to_user,
                Marking.status == "active",
            )
            .first()
        )
        if dup:
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
    child = (
        db.query(Marking.id)
        .filter(Marking.parent_marking_id == marking.id)
        .first()
    )
    if child:
        raise HTTPException(
            status_code=409,
            detail="Cannot revoke: recipient has already marked this correspondence onward",
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


def add_note(
    db: Session,
    *,
    letter: Letter,
    actor_name: str,
    body_text: str,
    marking_id: int | None = None,
    is_response: bool = False,
    attachments: list[dict[str, Any]] | None = None,
    client_ip: str = "",
) -> CorrespondenceNote:
    assert_can_mutate(db, letter, actor_name)
    body = (body_text or "").strip()
    if not body:
        raise HTTPException(status_code=400, detail="bodyText is required")

    marking: Marking | None = None
    if marking_id is not None:
        marking = db.get(Marking, marking_id)
        if not marking or marking.letter_id != letter.id:
            raise HTTPException(status_code=400, detail="Invalid markingId")

    if is_response:
        if not marking:
            raise HTTPException(status_code=400, detail="markingId required when submitting a response")
        if marking.action != "response_required" or marking.status != "active":
            raise HTTPException(status_code=400, detail="Marking is not an open Response Required")
        if marking.to_user != actor_name and not _is_admin(db, actor_name):
            raise HTTPException(status_code=403, detail="Only the assignee can submit this response")

    note = CorrespondenceNote(
        letter_id=letter.id,
        marking_id=marking.id if marking else None,
        author_user=actor_name,
        body_text=body,
        is_response=bool(is_response),
        client_ip=client_ip or "",
    )
    db.add(note)
    db.flush()

    for att in attachments or []:
        kind = str(att.get("attachmentKind") or att.get("attachment_kind") or "Other")
        if kind not in ATTACHMENT_KINDS:
            raise HTTPException(status_code=400, detail=f"Invalid attachmentKind '{kind}'")
        db.add(
            CorrespondenceAttachment(
                note_id=note.id,
                document_id=att.get("documentId") or att.get("document_id"),
                attachment_kind=kind,
                storage_key=str(att.get("storageKey") or att.get("storage_key") or ""),
                original_filename=str(att.get("originalFilename") or att.get("original_filename") or ""),
                client_ip=client_ip or "",
            )
        )

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


def list_notes(db: Session, letter_id: int) -> list[dict]:
    notes = (
        db.query(CorrespondenceNote)
        .filter(CorrespondenceNote.letter_id == letter_id)
        .order_by(CorrespondenceNote.id.asc())
        .all()
    )
    out: list[dict] = []
    for note in notes:
        atts = (
            db.query(CorrespondenceAttachment)
            .filter(CorrespondenceAttachment.note_id == note.id)
            .all()
        )
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
                "attachments": [
                    {
                        "id": a.id,
                        "documentId": a.document_id,
                        "attachmentKind": a.attachment_kind,
                        "storageKey": a.storage_key,
                        "originalFilename": a.original_filename,
                        "clientIp": a.client_ip,
                        "createdAt": a.created_at.isoformat() if a.created_at else "",
                    }
                    for a in atts
                ],
            }
        )
    return out


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
        # Revoke only while recipient has not remade onward.
        outbound = (
            db.query(Marking)
            .filter(
                Marking.letter_id == letter.id,
                Marking.from_user == actor_name,
                Marking.status == "active",
            )
            .all()
        )
        if any(not marking_has_children(db, m.id) for m in outbound):
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
