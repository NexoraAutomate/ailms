from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Letter, WorkflowTransition
from app.schemas import WorkflowActionOut, WorkflowExecuteIn, WorkflowTransitionOut
from app.services import current_user_name, serialize_letter
from app.workflow_service import available_actions, execute_transition, serialize_transition

router = APIRouter(prefix="/workflow", tags=["workflow"])


def _get_letter(db: Session, letter_id: int) -> Letter:
    letter = db.get(Letter, letter_id)
    if not letter:
        raise HTTPException(status_code=404, detail="Letter not found")
    return letter


@router.get("/letters/{letter_id}/actions", response_model=WorkflowActionOut)
def list_available_actions(letter_id: int, db: Session = Depends(get_db)) -> WorkflowActionOut:
    letter = _get_letter(db, letter_id)
    actor = current_user_name(db)
    return WorkflowActionOut(
        letterId=str(letter.id),
        currentStatus=letter.status,
        actions=available_actions(db, letter, actor),
    )


@router.get("/letters/{letter_id}/history", response_model=list[WorkflowTransitionOut])
def workflow_history(letter_id: int, db: Session = Depends(get_db)) -> list[WorkflowTransitionOut]:
    _get_letter(db, letter_id)
    rows = (
        db.query(WorkflowTransition)
        .filter(WorkflowTransition.letter_id == letter_id)
        .order_by(WorkflowTransition.id.desc())
        .all()
    )
    return [WorkflowTransitionOut(**serialize_transition(row)) for row in rows]


@router.post("/letters/{letter_id}/execute", response_model=WorkflowTransitionOut)
def run_workflow_action(
    letter_id: int,
    payload: WorkflowExecuteIn,
    db: Session = Depends(get_db),
) -> WorkflowTransitionOut:
    letter = _get_letter(db, letter_id)
    actor = current_user_name(db)
    transition = execute_transition(
        db,
        letter=letter,
        action=payload.action,
        actor_name=actor,
        remarks=payload.remarks,
        assigned_to=payload.assignedTo,
        department=payload.department,
        action_label=payload.actionLabel,
        reviewer_name=payload.reviewerName,
        escalated_to=payload.escalatedTo,
        escalation_level=payload.escalationLevel,
    )
    db.commit()
    db.refresh(transition)
    db.refresh(letter)
    return WorkflowTransitionOut(**serialize_transition(transition))


@router.post("/letters/{letter_id}/execute-with-letter")
def run_workflow_and_return_letter(
    letter_id: int,
    payload: WorkflowExecuteIn,
    db: Session = Depends(get_db),
) -> dict:
    letter = _get_letter(db, letter_id)
    actor = current_user_name(db)
    transition = execute_transition(
        db,
        letter=letter,
        action=payload.action,
        actor_name=actor,
        remarks=payload.remarks,
        assigned_to=payload.assignedTo,
        department=payload.department,
        action_label=payload.actionLabel,
        reviewer_name=payload.reviewerName,
        escalated_to=payload.escalatedTo,
        escalation_level=payload.escalationLevel,
    )
    db.commit()
    db.refresh(transition)
    db.refresh(letter)
    return {
        "letter": serialize_letter(letter),
        "transition": WorkflowTransitionOut(**serialize_transition(transition)),
    }
