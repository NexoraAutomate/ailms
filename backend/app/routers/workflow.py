from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.enterprise_workflow_service import (
    list_action_items,
    list_approval_steps_for_letter,
    list_dispatches,
    list_response_versions,
    list_route_steps,
)
from app.letter_access import assert_letter_access
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


def _run(db: Session, letter: Letter, actor: str, payload: WorkflowExecuteIn) -> WorkflowTransition:
    return execute_transition(
        db,
        letter=letter,
        action=payload.action,
        actor_name=actor,
        remarks=payload.remarks,
        assigned_to=payload.assignedTo,
        department=payload.department,
        department_id=payload.departmentId,
        action_label=payload.actionLabel,
        reviewer_name=payload.reviewerName,
        escalated_to=payload.escalatedTo,
        escalation_level=payload.escalationLevel,
        category=payload.category,
        action_item_id=payload.actionItemId,
        response_body=payload.responseBody,
        response_version_id=payload.responseVersionId,
        approval_step_id=payload.approvalStepId,
        info_recipients=payload.infoRecipients,
        dispatch_channel=payload.dispatchChannel,
        dispatch_recipients=payload.dispatchRecipients,
        priority=payload.priority,
        due_date=payload.dueDate,
        instructions=payload.instructions,
        blocked_reason=payload.blockedReason,
        document_id=payload.documentId,
    )


@router.get("/letters/{letter_id}/actions", response_model=WorkflowActionOut)
def list_available_actions(letter_id: int, db: Session = Depends(get_db)) -> WorkflowActionOut:
    letter = _get_letter(db, letter_id)
    actor = current_user_name(db)
    assert_letter_access(db, letter, actor)
    return WorkflowActionOut(
        letterId=str(letter.id),
        currentStatus=letter.status,
        actions=available_actions(db, letter, actor),
    )


@router.get("/letters/{letter_id}/history", response_model=list[WorkflowTransitionOut])
def workflow_history(letter_id: int, db: Session = Depends(get_db)) -> list[WorkflowTransitionOut]:
    letter = _get_letter(db, letter_id)
    assert_letter_access(db, letter, current_user_name(db))
    rows = (
        db.query(WorkflowTransition)
        .filter(WorkflowTransition.letter_id == letter_id)
        .order_by(WorkflowTransition.id.desc())
        .all()
    )
    return [WorkflowTransitionOut(**serialize_transition(row)) for row in rows]


@router.get("/letters/{letter_id}/route-steps")
def get_route_steps(letter_id: int, db: Session = Depends(get_db)) -> list[dict]:
    letter = _get_letter(db, letter_id)
    assert_letter_access(db, letter, current_user_name(db))
    return list_route_steps(db, letter_id)


@router.get("/letters/{letter_id}/action-items")
def get_action_items(letter_id: int, db: Session = Depends(get_db)) -> list[dict]:
    letter = _get_letter(db, letter_id)
    assert_letter_access(db, letter, current_user_name(db))
    return list_action_items(db, letter_id)


@router.get("/letters/{letter_id}/response-versions")
def get_response_versions(letter_id: int, db: Session = Depends(get_db)) -> list[dict]:
    letter = _get_letter(db, letter_id)
    assert_letter_access(db, letter, current_user_name(db))
    return list_response_versions(db, letter_id)


@router.get("/letters/{letter_id}/approval-steps")
def get_approval_steps(letter_id: int, db: Session = Depends(get_db)) -> list[dict]:
    letter = _get_letter(db, letter_id)
    assert_letter_access(db, letter, current_user_name(db))
    return list_approval_steps_for_letter(db, letter_id)


@router.get("/letters/{letter_id}/dispatches")
def get_dispatches(letter_id: int, db: Session = Depends(get_db)) -> list[dict]:
    letter = _get_letter(db, letter_id)
    assert_letter_access(db, letter, current_user_name(db))
    return list_dispatches(db, letter_id)


@router.post("/letters/{letter_id}/execute", response_model=WorkflowTransitionOut)
def run_workflow_action(
    letter_id: int,
    payload: WorkflowExecuteIn,
    db: Session = Depends(get_db),
) -> WorkflowTransitionOut:
    letter = _get_letter(db, letter_id)
    actor = current_user_name(db)
    assert_letter_access(db, letter, actor)
    transition = _run(db, letter, actor, payload)
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
    assert_letter_access(db, letter, actor)
    transition = _run(db, letter, actor, payload)
    db.commit()
    db.refresh(transition)
    db.refresh(letter)
    return {
        "letter": serialize_letter(letter),
        "transition": WorkflowTransitionOut(**serialize_transition(transition)),
    }
