"""Escalation tracking for overdue and critical correspondence."""

from __future__ import annotations

from datetime import date, timedelta

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Escalation, Letter, LetterAction
from app.services import add_audit, add_notification

ESCALATION_STATUSES = {"Open", "In Progress", "Resolved", "Cancelled"}
ESCALATION_LEVELS = ("Level 1", "Level 2", "Level 3")


def serialize_escalation(row: Escalation) -> dict:
    return {
        "id": row.id,
        "letterId": str(row.letter_id),
        "actionId": row.action_id,
        "escalationLevel": row.escalation_level,
        "escalatedBy": row.escalated_by,
        "escalatedTo": row.escalated_to,
        "reason": row.reason,
        "escalationDate": row.escalation_date.isoformat(),
        "targetResolutionDate": row.target_resolution_date.isoformat() if row.target_resolution_date else "",
        "resolutionDate": row.resolution_date.isoformat() if row.resolution_date else "",
        "remarks": row.remarks,
        "status": row.status,
        "createdAt": row.created_at.isoformat(),
        "updatedAt": row.updated_at.isoformat(),
    }


def create_escalation(
    db: Session,
    *,
    letter: Letter,
    escalated_by: str,
    escalated_to: str,
    escalation_level: str = "Level 1",
    reason: str = "",
    remarks: str = "",
    action_id: int | None = None,
    target_resolution_date: date | None = None,
) -> Escalation:
    if escalation_level not in ESCALATION_LEVELS:
        raise HTTPException(status_code=422, detail="Validation failed: invalid escalation level")
    if not escalated_to.strip():
        raise HTTPException(status_code=422, detail="Validation failed: escalation target is required")
    if not reason.strip() and not remarks.strip():
        raise HTTPException(status_code=422, detail="Validation failed: reason or remarks required")

    if action_id is not None:
        action = db.get(LetterAction, action_id)
        if not action or action.letter_id != letter.id:
            raise HTTPException(status_code=404, detail="Related action not found")

    target = target_resolution_date or (date.today() + timedelta(days=7 if escalation_level == "Level 1" else 5))
    row = Escalation(
        letter_id=letter.id,
        action_id=action_id,
        escalation_level=escalation_level,
        escalated_by=escalated_by,
        escalated_to=escalated_to,
        reason=reason or remarks,
        escalation_date=date.today(),
        target_resolution_date=target,
        remarks=remarks,
        status="Open",
    )
    db.add(row)
    add_audit(
        db,
        user=escalated_by,
        module="Escalations",
        action="Escalated",
        record=letter.number,
        description=f"{escalation_level}: {reason or remarks}",
    )
    add_notification(
        db,
        title="Escalation",
        description=f"{letter.number} escalated to {escalated_to} ({escalation_level}).",
        priority="Critical",
        letter_id=letter.id,
        notification_type="Escalation",
        recipient_name=escalated_to,
        related_entity_type="letter",
        related_entity_id=str(letter.id),
    )
    db.flush()
    return row


def resolve_escalation(db: Session, escalation_id: int, *, actor: str, remarks: str = "") -> Escalation:
    row = db.get(Escalation, escalation_id)
    if not row:
        raise HTTPException(status_code=404, detail="Escalation not found")
    if row.status in {"Resolved", "Cancelled"}:
        raise HTTPException(status_code=400, detail="Escalation is already closed")

    row.status = "Resolved"
    row.resolution_date = date.today()
    if remarks:
        row.remarks = remarks
    letter = db.get(Letter, row.letter_id)
    add_audit(
        db,
        user=actor,
        module="Escalations",
        action="Escalation Resolved",
        record=letter.number if letter else str(row.letter_id),
        description=remarks or "Escalation marked resolved",
    )
    db.flush()
    return row


def sync_workflow_escalation(
    db: Session,
    *,
    letter: Letter,
    actor_name: str,
    remarks: str,
    escalated_to: str | None,
    escalation_level: str | None,
) -> Escalation:
    latest_action = (
        db.query(LetterAction)
        .filter(LetterAction.letter_id == letter.id)
        .order_by(LetterAction.id.desc())
        .first()
    )
    return create_escalation(
        db,
        letter=letter,
        escalated_by=actor_name,
        escalated_to=escalated_to or letter.assigned_to,
        escalation_level=escalation_level or "Level 1",
        reason=remarks,
        remarks=remarks,
        action_id=latest_action.id if latest_action else None,
    )
