"""Advanced correspondence relationships and thread views."""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models import Letter, LetterAction, LetterRelation
from app.services import add_audit, current_user_name, effective_status

RELATIONSHIP_TYPES = {
    "Original",
    "Reply",
    "Reminder",
    "Follow-up",
    "Forwarded",
    "Reference",
    "Amendment",
    "Clarification",
    "Related",
    "Supersedes",
}


def serialize_relation(row: LetterRelation) -> dict:
    return {
        "id": row.id,
        "fromLetterId": str(row.from_letter_id),
        "toLetterId": str(row.to_letter_id),
        "relationshipType": row.relationship_type,
        "createdBy": row.created_by,
        "remarks": row.remarks,
        "createdAt": row.created_at.isoformat(),
    }


def thread_node(db: Session, letter: Letter) -> dict:
    status = effective_status(letter)
    latest_action = (
        db.query(LetterAction)
        .filter(LetterAction.letter_id == letter.id)
        .order_by(LetterAction.id.desc())
        .first()
    )
    return {
        "id": str(letter.id),
        "number": letter.number,
        "letterDate": letter.letter_date.isoformat(),
        "type": letter.type,
        "from": letter.sender,
        "to": letter.recipient,
        "subject": letter.subject,
        "status": status,
        "assignedTo": letter.assigned_to,
        "actionStatus": latest_action.action if latest_action else letter.last_action,
    }


def create_relation(
    db: Session,
    *,
    from_letter_id: int,
    to_letter_id: int,
    relationship_type: str,
    remarks: str = "",
    actor: str | None = None,
) -> LetterRelation:
    actor = actor or current_user_name(db)
    if from_letter_id == to_letter_id:
        raise HTTPException(status_code=422, detail="Validation failed: cannot relate a letter to itself")
    if relationship_type not in RELATIONSHIP_TYPES:
        raise HTTPException(status_code=422, detail="Validation failed: invalid relationship type")
    if not db.get(Letter, from_letter_id) or not db.get(Letter, to_letter_id):
        raise HTTPException(status_code=404, detail="Letter not found")

    existing = (
        db.query(LetterRelation)
        .filter(
            LetterRelation.from_letter_id == from_letter_id,
            LetterRelation.to_letter_id == to_letter_id,
            LetterRelation.relationship_type == relationship_type,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Duplicate record")

    row = LetterRelation(
        from_letter_id=from_letter_id,
        to_letter_id=to_letter_id,
        relationship_type=relationship_type,
        created_by=actor,
        remarks=remarks,
    )
    db.add(row)
    from_letter = db.get(Letter, from_letter_id)
    to_letter = db.get(Letter, to_letter_id)
    add_audit(
        db,
        user=actor,
        module="Correspondence",
        action="Relationship Created",
        record=from_letter.number if from_letter else str(from_letter_id),
        description=f"{relationship_type} → {to_letter.number if to_letter else to_letter_id}",
    )
    db.flush()
    return row


def build_thread(db: Session, letter_id: int) -> dict:
    if not db.get(Letter, letter_id):
        raise HTTPException(status_code=404, detail="Letter not found")

    visited: set[int] = set()
    queue = [letter_id]
    edges: list[dict] = []

    while queue:
        current = queue.pop(0)
        if current in visited:
            continue
        visited.add(current)
        rows = (
            db.query(LetterRelation)
            .filter(
                or_(LetterRelation.from_letter_id == current, LetterRelation.to_letter_id == current),
            )
            .all()
        )
        for rel in rows:
            other = rel.to_letter_id if rel.from_letter_id == current else rel.from_letter_id
            direction = "outgoing" if rel.from_letter_id == current else "incoming"
            edges.append(
                {
                    "id": rel.id,
                    "fromLetterId": str(rel.from_letter_id),
                    "toLetterId": str(rel.to_letter_id),
                    "relationshipType": rel.relationship_type,
                    "direction": direction,
                    "remarks": rel.remarks,
                }
            )
            if other not in visited:
                queue.append(other)

    letters = db.query(Letter).filter(Letter.id.in_(visited)).order_by(Letter.letter_date, Letter.id).all()
    nodes = [thread_node(db, letter) for letter in letters]
    relations = (
        db.query(LetterRelation)
        .filter(
            or_(LetterRelation.from_letter_id.in_(visited), LetterRelation.to_letter_id.in_(visited)),
        )
        .order_by(LetterRelation.id)
        .all()
    )
    return {
        "rootLetterId": str(letter_id),
        "nodes": nodes,
        "edges": edges,
        "relations": [serialize_relation(r) for r in relations],
    }
