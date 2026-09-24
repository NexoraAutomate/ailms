"""Shared letter creation used by manual register and AI registration commit."""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Letter
from app.schemas import LetterCreate
from app.services import add_audit, add_notification, bump_trend, current_user_name


def create_letter_record(
    db: Session,
    payload: LetterCreate,
    *,
    actor: str | None = None,
) -> Letter:
    """
    Persist a new letter from LetterCreate (flush only — caller commits).

    Raises HTTP 409 if the letter number already exists.
    """
    if db.query(Letter).filter(Letter.number == payload.number).first():
        raise HTTPException(status_code=409, detail="Letter number already exists")

    data = payload.model_dump(by_alias=False)
    actor = actor or current_user_name(db)
    letter = Letter(
        number=data["number"],
        letter_date=data["letterDate"],
        received_date=data["receivedDate"] or data["letterDate"],
        type=data["type"],
        subject=data["subject"],
        sender=data["from_"],
        recipient=data["to"],
        department=data["department"],
        priority=data["priority"],
        status=data["status"],
        due_date=data["dueDate"],
        assigned_to=data["assignedTo"],
        last_action=data["lastAction"] or "Registered",
        confidentiality=data["confidentiality"],
        action_required=data["actionRequired"],
        remarks=data["remarks"],
    )
    db.add(letter)
    db.flush()
    bump_trend(db, letter.type, letter.letter_date)
    add_audit(
        db,
        user=actor,
        module="Letters",
        action="Letter Registered",
        record=letter.number,
        description=f"{letter.type} letter registered",
    )
    if letter.assigned_to:
        add_notification(
            db,
            title="New Assignment",
            description=f"{letter.subject} assigned to {letter.assigned_to}.",
            priority="High" if letter.priority == "Urgent" else "Medium",
            letter_id=letter.id,
            notification_type="New Assignment",
            recipient_name=letter.assigned_to,
            related_entity_type="letter",
            related_entity_id=str(letter.id),
        )
    db.flush()
    return letter
