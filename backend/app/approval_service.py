"""Approval tracking linked to correspondence workflow."""

from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Approval, Letter
from app.services import add_audit, add_notification, resolve_user_role

APPROVAL_STATUSES = {
    "Not Required",
    "Pending",
    "Approved",
    "Rejected",
    "Returned for Revision",
}

APPROVER_ROLES = {"Administrator", "Management"}


def serialize_approval(row: Approval) -> dict:
    return {
        "id": row.id,
        "letterId": str(row.letter_id),
        "documentId": row.document_id,
        "preparedBy": row.prepared_by,
        "reviewer": row.reviewer,
        "submittedAt": row.submitted_at.isoformat() if row.submitted_at else "",
        "reviewedAt": row.reviewed_at.isoformat() if row.reviewed_at else "",
        "approvalStatus": row.approval_status,
        "reviewerRemarks": row.reviewer_remarks,
        "revisionNumber": row.revision_number,
        "createdAt": row.created_at.isoformat(),
        "updatedAt": row.updated_at.isoformat(),
    }


def latest_approval(db: Session, letter_id: int) -> Approval | None:
    return (
        db.query(Approval)
        .filter(Approval.letter_id == letter_id)
        .order_by(Approval.id.desc())
        .first()
    )


def assert_can_review(db: Session, actor_name: str) -> None:
    role = resolve_user_role(db, actor_name)
    if role not in APPROVER_ROLES:
        raise HTTPException(status_code=403, detail="Access denied: approval not permitted for this role")


def submit_for_approval(
    db: Session,
    *,
    letter: Letter,
    prepared_by: str,
    reviewer: str | None = None,
    document_id: int | None = None,
) -> Approval:
    pending = latest_approval(db, letter.id)
    if pending and pending.approval_status == "Pending":
        raise HTTPException(status_code=409, detail="An approval request is already pending for this letter")

    revision = 1
    if pending:
        revision = pending.revision_number + 1

    row = Approval(
        letter_id=letter.id,
        document_id=document_id,
        prepared_by=prepared_by,
        reviewer=reviewer or "",
        submitted_at=datetime.now(),
        approval_status="Pending",
        revision_number=revision,
    )
    db.add(row)
    add_audit(
        db,
        user=prepared_by,
        module="Approvals",
        action="Submitted for Approval",
        record=letter.number,
        description=f"Revision {revision} submitted for approval",
    )
    if reviewer:
        add_notification(
            db,
            title="Approval Required",
            description=f"Review required for {letter.number}.",
            priority="High",
            letter_id=letter.id,
            notification_type="Approval Required",
            recipient_name=reviewer,
            related_entity_type="letter",
            related_entity_id=str(letter.id),
        )
    db.flush()
    return row


def complete_approval_review(
    db: Session,
    *,
    letter: Letter,
    actor_name: str,
    decision: str,
    remarks: str,
) -> Approval:
    assert_can_review(db, actor_name)
    row = latest_approval(db, letter.id)
    if not row or row.approval_status != "Pending":
        raise HTTPException(status_code=400, detail="No pending approval exists for this letter")

    if row.prepared_by == actor_name:
        raise HTTPException(status_code=400, detail="Approval not permitted: self-approval is prohibited")

    status_map = {
        "approve": "Approved",
        "reject": "Rejected",
        "return_for_revision": "Returned for Revision",
    }
    if decision not in status_map:
        raise HTTPException(status_code=400, detail="Invalid approval decision")

    row.approval_status = status_map[decision]
    row.reviewer = row.reviewer or actor_name
    row.reviewed_at = datetime.now()
    row.reviewer_remarks = remarks

    add_audit(
        db,
        user=actor_name,
        module="Approvals",
        action=status_map[decision],
        record=letter.number,
        description=remarks,
    )
    add_notification(
        db,
        title="Workflow Status Changed",
        description=f"{letter.number}: approval {status_map[decision].lower()}.",
        priority="High" if decision != "approve" else "Medium",
        letter_id=letter.id,
        notification_type="Workflow Status Changed",
        recipient_name=row.prepared_by,
        related_entity_type="letter",
        related_entity_id=str(letter.id),
    )
    db.flush()
    return row


def sync_workflow_approval(
    db: Session,
    *,
    letter: Letter,
    action: str,
    actor_name: str,
    remarks: str = "",
    reviewer_name: str | None = None,
) -> Approval | None:
    if action == "submit_for_approval":
        return submit_for_approval(db, letter=letter, prepared_by=actor_name, reviewer=reviewer_name)
    if action in {"approve", "reject", "return_for_revision"}:
        return complete_approval_review(db, letter=letter, actor_name=actor_name, decision=action, remarks=remarks)
    return None
