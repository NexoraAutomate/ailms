from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.approval_service import (
    assert_can_review,
    complete_approval_review,
    latest_approval,
    serialize_approval,
    submit_for_approval,
)
from app.database import get_db
from app.models import Approval, Letter
from app.schemas import ApprovalOut, ApprovalReviewIn, ApprovalSubmitIn
from app.services import current_user_name

router = APIRouter(prefix="/approvals", tags=["approvals"])


def _get_letter(db: Session, letter_id: int) -> Letter:
    letter = db.get(Letter, letter_id)
    if not letter:
        raise HTTPException(status_code=404, detail="Letter not found")
    return letter


@router.get("", response_model=list[ApprovalOut])
def list_approvals(
    letter_id: int | None = Query(default=None, alias="letterId"),
    status: str | None = None,
    db: Session = Depends(get_db),
) -> list[ApprovalOut]:
    query = db.query(Approval).order_by(Approval.id.desc())
    if letter_id is not None:
        query = query.filter(Approval.letter_id == letter_id)
    if status:
        query = query.filter(Approval.approval_status == status)
    return [ApprovalOut(**serialize_approval(row)) for row in query.all()]


@router.get("/letters/{letter_id}/current", response_model=ApprovalOut | None)
def current_approval(letter_id: int, db: Session = Depends(get_db)) -> ApprovalOut | None:
    _get_letter(db, letter_id)
    row = latest_approval(db, letter_id)
    return ApprovalOut(**serialize_approval(row)) if row else None


@router.post("/letters/{letter_id}/submit", response_model=ApprovalOut, status_code=201)
def submit_approval(
    letter_id: int,
    payload: ApprovalSubmitIn,
    db: Session = Depends(get_db),
) -> ApprovalOut:
    letter = _get_letter(db, letter_id)
    actor = current_user_name(db)
    row = submit_for_approval(
        db,
        letter=letter,
        prepared_by=actor,
        reviewer=payload.reviewer,
        document_id=payload.documentId,
    )
    db.commit()
    db.refresh(row)
    return ApprovalOut(**serialize_approval(row))


@router.post("/{approval_id}/review", response_model=ApprovalOut)
def review_approval(
    approval_id: int,
    payload: ApprovalReviewIn,
    db: Session = Depends(get_db),
) -> ApprovalOut:
    row = db.get(Approval, approval_id)
    if not row:
        raise HTTPException(status_code=404, detail="Approval not found")
    letter = _get_letter(db, row.letter_id)
    actor = current_user_name(db)
    assert_can_review(db, actor)
    updated = complete_approval_review(
        db,
        letter=letter,
        actor_name=actor,
        decision=payload.decision,
        remarks=payload.remarks,
    )
    db.commit()
    db.refresh(updated)
    return ApprovalOut(**serialize_approval(updated))
