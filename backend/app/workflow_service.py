"""Centralized correspondence workflow rules and execution."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.approval_service import latest_approval, sync_workflow_approval
from app.escalation_service import sync_workflow_escalation
from app.models import Letter, LetterAction, User, WorkflowTransition
from app.services import CLOSED_STATUSES, add_audit, add_notification, current_user_name, resolve_user_role

# Stored statuses (Overdue is derived in serializers, not written by workflow).
WORKFLOW_STATUSES = {
    "Draft",
    "Registered",
    "Under Review",
    "Assigned",
    "Action in Progress",
    "Awaiting Response",
    "Response Prepared",
    "Approval Pending",
    "Response Approved",
    "Response Sent",
    "Completed",
    "Closed",
    "Rejected",
    "Returned for Revision",
    "Escalated",
    "Reopened",
    "Archived",
}

ROLE_PERMISSIONS: dict[str, set[str]] = {
    "Administrator": {
        "assign",
        "forward",
        "reassign",
        "add_action",
        "request_response",
        "request_clarification",
        "mark_complete",
        "submit_for_approval",
        "approve",
        "reject",
        "return_for_revision",
        "escalate",
        "reopen",
        "close",
        "archive",
    },
    "Management": {
        "assign",
        "forward",
        "reassign",
        "add_action",
        "request_response",
        "request_clarification",
        "mark_complete",
        "submit_for_approval",
        "approve",
        "reject",
        "return_for_revision",
        "escalate",
        "reopen",
        "close",
        "archive",
    },
    "Correspondence Officer": {
        "assign",
        "forward",
        "reassign",
        "add_action",
        "request_response",
        "request_clarification",
        "mark_complete",
        "submit_for_approval",
        "return_for_revision",
        "escalate",
        "reopen",
        "close",
        "archive",
    },
    "Department/User": {
        "add_action",
        "request_clarification",
        "mark_complete",
        "submit_for_approval",
    },
}


@dataclass(frozen=True)
class WorkflowRule:
    action: str
    to_status: str | None
    from_statuses: frozenset[str] | None = None  # None = any non-archived


TRANSITION_RULES: dict[str, WorkflowRule] = {
    "assign": WorkflowRule("assign", "Assigned", frozenset({"Draft", "Registered", "Under Review", "Reopened"})),
    "forward": WorkflowRule("forward", "Under Review", frozenset({"Registered", "Assigned", "Action in Progress"})),
    "reassign": WorkflowRule("reassign", "Assigned", frozenset({"Assigned", "Action in Progress", "Awaiting Response"})),
    "add_action": WorkflowRule(
        "add_action",
        "Action in Progress",
        frozenset({"Registered", "Assigned", "Under Review", "Awaiting Response", "Returned for Revision", "Reopened"}),
    ),
    "request_response": WorkflowRule(
        "request_response",
        "Awaiting Response",
        frozenset({"Action in Progress", "Assigned", "Response Prepared"}),
    ),
    "request_clarification": WorkflowRule(
        "request_clarification",
        "Under Review",
        frozenset({"Action in Progress", "Awaiting Response", "Assigned"}),
    ),
    "mark_complete": WorkflowRule(
        "mark_complete",
        "Completed",
        frozenset({"Action in Progress", "Awaiting Response", "Response Sent", "Response Approved"}),
    ),
    "submit_for_approval": WorkflowRule(
        "submit_for_approval",
        "Approval Pending",
        frozenset({"Response Prepared", "Action in Progress", "Awaiting Response"}),
    ),
    "approve": WorkflowRule("approve", "Response Approved", frozenset({"Approval Pending"})),
    "reject": WorkflowRule("reject", "Rejected", frozenset({"Approval Pending"})),
    "return_for_revision": WorkflowRule(
        "return_for_revision",
        "Returned for Revision",
        frozenset({"Approval Pending", "Response Prepared"}),
    ),
    "escalate": WorkflowRule(
        "escalate",
        "Escalated",
        frozenset({"Action in Progress", "Awaiting Response", "Assigned", "Approval Pending"}),
    ),
    "reopen": WorkflowRule("reopen", "Reopened", frozenset({"Closed", "Completed", "Archived"})),
    "close": WorkflowRule("close", "Closed", frozenset({"Completed", "Response Sent", "Rejected"})),
    "archive": WorkflowRule("archive", "Archived", frozenset({"Closed", "Completed", "Rejected"})),
}


def stored_status(letter: Letter) -> str:
    if letter.status == "Overdue":
        return "Action in Progress"
    return letter.status


def validate_transition(
    db: Session,
    *,
    letter: Letter,
    action: str,
    actor_name: str,
    reviewer_name: str | None = None,
) -> WorkflowRule:
    if action not in TRANSITION_RULES:
        raise HTTPException(status_code=400, detail=f"Unknown workflow action: {action}")

    role = resolve_user_role(db, actor_name)
    allowed = ROLE_PERMISSIONS.get(role, ROLE_PERMISSIONS["Department/User"])
    if action not in allowed:
        raise HTTPException(status_code=403, detail="Access denied for this workflow action")

    rule = TRANSITION_RULES[action]
    current = stored_status(letter)
    if getattr(letter, "is_archived", False) or letter.status in {"Archived"} or current == "Archived":
        raise HTTPException(status_code=400, detail="Archived correspondence cannot be modified")

    if rule.from_statuses is not None and current not in rule.from_statuses:
        raise HTTPException(
            status_code=400,
            detail=f"Workflow transition not allowed: '{action}' from status '{current}'",
        )

    if action in {"approve", "reject", "return_for_revision"}:
        pending = latest_approval(db, letter.id)
        if pending and pending.prepared_by == actor_name:
            raise HTTPException(status_code=400, detail="Approval not permitted: self-approval is prohibited")

    return rule


def _apply_status(letter: Letter, status: str) -> None:
    letter.status = status
    if status in CLOSED_STATUSES | {"Closed", "Archived", "Rejected"}:
        letter.completion_date = letter.completion_date or date.today()
    elif status in {"Reopened", "Assigned", "Action in Progress", "Approval Pending"}:
        if status != "Completed":
            letter.completion_date = None


def _notification_for(action: str, letter: Letter, actor: str) -> tuple[str, str, str, str] | None:
    mapping: dict[str, tuple[str, str, str, str]] = {
        "assign": ("New Assignment", f"{letter.subject} assigned to {letter.assigned_to}.", "High", "New Assignment"),
        "reassign": ("Reassignment", f"{letter.subject} reassigned to {letter.assigned_to}.", "High", "Reassignment"),
        "forward": ("Forwarded Letter", f"{letter.subject} forwarded by {actor}.", "Medium", "Forwarded Letter"),
        "submit_for_approval": ("Approval Required", f"Approval required for {letter.number}.", "High", "Approval Required"),
        "approve": ("Workflow Status Changed", f"{letter.number} response approved.", "Medium", "Workflow Status Changed"),
        "reject": ("Workflow Status Changed", f"{letter.number} response rejected.", "High", "Workflow Status Changed"),
        "return_for_revision": ("Workflow Status Changed", f"{letter.number} returned for revision.", "High", "Workflow Status Changed"),
        "request_response": ("Workflow Status Changed", f"Response requested for {letter.number}.", "Medium", "Workflow Status Changed"),
    }
    return mapping.get(action)


def execute_transition(
    db: Session,
    *,
    letter: Letter,
    action: str,
    actor_name: str,
    remarks: str = "",
    assigned_to: str | None = None,
    department: str | None = None,
    action_label: str | None = None,
    reviewer_name: str | None = None,
    escalated_to: str | None = None,
    escalation_level: str | None = None,
) -> WorkflowTransition:
    rule = validate_transition(db, letter=letter, action=action, actor_name=actor_name, reviewer_name=reviewer_name)

    from_status = stored_status(letter)
    if assigned_to is not None:
        letter.assigned_to = assigned_to
    if department is not None:
        letter.department = department

    if action in {"approve", "reject", "return_for_revision"} and not remarks.strip():
        raise HTTPException(status_code=422, detail="Validation failed: remarks are required for this action")

    if action in {"assign", "reassign"} and not letter.assigned_to:
        raise HTTPException(status_code=422, detail="Validation failed: assigned user is required")

    if action == "escalate" and not (escalated_to or letter.assigned_to):
        raise HTTPException(status_code=422, detail="Validation failed: escalation target is required")

    to_status = rule.to_status or from_status
    _apply_status(letter, to_status)
    if action == "archive":
        letter.is_archived = True
        letter.archived_at = datetime.now()

    label = action_label or action.replace("_", " ").title()
    letter.last_action = label

    tracking = LetterAction(
        letter_id=letter.id,
        action=label,
        remarks=remarks,
        created_by=actor_name,
    )
    db.add(tracking)

    transition = WorkflowTransition(
        letter_id=letter.id,
        action=action,
        from_status=from_status,
        to_status=to_status,
        performed_by=actor_name,
        remarks=remarks,
        assigned_to=letter.assigned_to or "",
        department=letter.department or "",
    )
    db.add(transition)

    add_audit(
        db,
        user=actor_name,
        module="Workflow",
        action=label,
        record=letter.number,
        description=remarks or f"Status changed from {from_status} to {to_status}",
    )

    reviewer = reviewer_name or (assigned_to if action == "submit_for_approval" else None)
    notice = _notification_for(action, letter, actor_name)
    if notice:
        title, description, priority, ntype = notice
        recipient = letter.assigned_to if action in {"assign", "reassign"} else reviewer
        add_notification(
            db,
            title=title,
            description=description,
            priority=priority,
            letter_id=letter.id,
            notification_type=ntype,
            recipient_name=recipient,
            related_entity_type="letter",
            related_entity_id=str(letter.id),
        )

    sync_workflow_approval(
        db,
        letter=letter,
        action=action,
        actor_name=actor_name,
        remarks=remarks,
        reviewer_name=reviewer,
    )
    if action == "escalate":
        sync_workflow_escalation(
            db,
            letter=letter,
            actor_name=actor_name,
            remarks=remarks,
            escalated_to=escalated_to or letter.assigned_to,
            escalation_level=escalation_level,
        )

    db.flush()
    return transition


def available_actions(db: Session, letter: Letter, actor_name: str) -> list[str]:
    role = resolve_user_role(db, actor_name)
    permitted = ROLE_PERMISSIONS.get(role, ROLE_PERMISSIONS["Department/User"])
    current = stored_status(letter)
    if letter.status in {"Archived"} or current == "Archived":
        return []

    actions: list[str] = []
    for action, rule in TRANSITION_RULES.items():
        if action not in permitted:
            continue
        if rule.from_statuses is not None and current not in rule.from_statuses:
            continue
        actions.append(action)
    return actions


def serialize_transition(row: WorkflowTransition) -> dict:
    return {
        "id": row.id,
        "letterId": str(row.letter_id),
        "action": row.action,
        "fromStatus": row.from_status,
        "toStatus": row.to_status,
        "performedBy": row.performed_by,
        "remarks": row.remarks,
        "assignedTo": row.assigned_to,
        "department": row.department,
        "createdAt": row.created_at.isoformat(),
    }
