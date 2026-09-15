from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.escalation_service import create_escalation, resolve_escalation, serialize_escalation
from app.models import Escalation, Letter
from app.schemas import EscalationCreateIn, EscalationOut, EscalationResolveIn
from app.services import current_user_name

router = APIRouter(prefix="/escalations", tags=["escalations"])


def _get_letter(db: Session, letter_id: int) -> Letter:
    letter = db.get(Letter, letter_id)
    if not letter:
        raise HTTPException(status_code=404, detail="Letter not found")
    return letter


@router.get("", response_model=list[EscalationOut])
def list_escalations(
    letter_id: int | None = Query(default=None, alias="letterId"),
    status: str | None = None,
    level: str | None = Query(default=None, alias="escalationLevel"),
    db: Session = Depends(get_db),
) -> list[EscalationOut]:
    query = db.query(Escalation).order_by(Escalation.id.desc())
    if letter_id is not None:
        query = query.filter(Escalation.letter_id == letter_id)
    if status:
        query = query.filter(Escalation.status == status)
    if level:
        query = query.filter(Escalation.escalation_level == level)
    return [EscalationOut(**serialize_escalation(row)) for row in query.all()]


@router.post("", response_model=EscalationOut, status_code=201)
def open_escalation(payload: EscalationCreateIn, db: Session = Depends(get_db)) -> EscalationOut:
    letter = _get_letter(db, payload.letterId)
    actor = current_user_name(db)
    row = create_escalation(
        db,
        letter=letter,
        escalated_by=actor,
        escalated_to=payload.escalatedTo,
        escalation_level=payload.escalationLevel,
        reason=payload.reason,
        remarks=payload.remarks,
        action_id=payload.actionId,
        target_resolution_date=payload.targetResolutionDate,
    )
    db.commit()
    db.refresh(row)
    return EscalationOut(**serialize_escalation(row))


@router.post("/{escalation_id}/resolve", response_model=EscalationOut)
def close_escalation(
    escalation_id: int,
    payload: EscalationResolveIn,
    db: Session = Depends(get_db),
) -> EscalationOut:
    actor = current_user_name(db)
    row = resolve_escalation(db, escalation_id, actor=actor, remarks=payload.remarks)
    db.commit()
    db.refresh(row)
    return EscalationOut(**serialize_escalation(row))
