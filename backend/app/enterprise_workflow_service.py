"""Enterprise correspondence workflow: RouteSteps, ActionItems, multi-tier approval."""

from __future__ import annotations

from datetime import date, datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import (
    ActionItem,
    ApprovalStep,
    Department,
    DispatchRecord,
    Letter,
    LetterAction,
    ResponseVersion,
    RouteStep,
    User,
    WorkflowTransition,
)
from app.services import add_audit, add_notification, normalize_role, resolve_user_role

# Canonical letter statuses (drawio page 2) + legacy aliases mapped on read.
ENTERPRISE_STATUSES = {
    "Draft",
    "Registered",
    "OCR Processed",
    "LLM Analyzed",
    "Validated",
    "Classified",
    "Pending Routing Approval",
    "Routed",
    "Action Assigned",
    "In Progress",
    "Response Drafted",
    "Under Approval",
    "Returned for Revision",
    "Approved for Dispatch",
    "Dispatched",
    "Information Delivered",
    "Closed",
    "Completed",
    "Rejected",
    "Escalated",
    "Reopened",
    "Archived",
    # Legacy retained for transition compatibility
    "Under Review",
    "Assigned",
    "Action in Progress",
    "Awaiting Response",
    "Response Prepared",
    "Approval Pending",
    "Response Approved",
    "Response Sent",
}

LEGACY_STATUS_MAP = {
    "Assigned": "Action Assigned",
    "Action in Progress": "In Progress",
    "Approval Pending": "Under Approval",
    "Response Prepared": "Response Drafted",
    "Response Approved": "Approved for Dispatch",
    "Response Sent": "Dispatched",
    "Under Review": "Validated",
}

ACTION_ITEM_STATUSES = {
    "Open",
    "Accepted",
    "In Progress",
    "Blocked",
    "Submitted",
    "Completed",
    "Cancelled",
}

RESPONSE_STATUSES = {"Draft", "Submitted", "In Review", "Approved", "Superseded", "Dispatched"}

# LLM analysis beyond OCR is Management+ only (plan note).
LLM_ANALYSIS_ROLES = {"Management", "Admin"}

ROLE_PERMISSIONS: dict[str, set[str]] = {
    "Admin": {
        "validate",
        "classify",
        "approve_routing",
        "route_info",
        "acknowledge_info",
        "close_information",
        "delegate",
        "handle_here",
        "accept_action",
        "start_action",
        "block_action",
        "complete_action",
        "draft_response",
        "submit_for_approval",
        "approve_step",
        "return_for_revision",
        "dispatch",
        "assign",
        "forward",
        "reassign",
        "add_action",
        "request_response",
        "request_clarification",
        "mark_complete",
        "approve",
        "reject",
        "escalate",
        "reopen",
        "close",
        "archive",
    },
    "Management": {
        "validate",
        "classify",
        "approve_routing",
        "route_info",
        "acknowledge_info",
        "close_information",
        "delegate",
        "handle_here",
        "accept_action",
        "start_action",
        "block_action",
        "complete_action",
        "draft_response",
        "submit_for_approval",
        "approve_step",
        "return_for_revision",
        "dispatch",
        "assign",
        "forward",
        "reassign",
        "add_action",
        "request_response",
        "request_clarification",
        "mark_complete",
        "approve",
        "reject",
        "escalate",
        "reopen",
        "close",
        "archive",
    },
    "Manager": {
        "classify",
        "route_info",
        "acknowledge_info",
        "close_information",
        "delegate",
        "handle_here",
        "accept_action",
        "start_action",
        "block_action",
        "complete_action",
        "draft_response",
        "submit_for_approval",
        "approve_step",
        "return_for_revision",
        "assign",
        "forward",
        "reassign",
        "add_action",
        "request_response",
        "request_clarification",
        "mark_complete",
        "escalate",
        "reopen",
        "close",
    },
    "Coordinator": {
        "validate",
        "classify",
        "route_info",
        "acknowledge_info",
        "close_information",
        "delegate",
        "handle_here",
        "assign",
        "forward",
        "reassign",
        "add_action",
        "request_response",
        "request_clarification",
        "mark_complete",
        "return_for_revision",
        "escalate",
        "reopen",
        "close",
        "archive",
    },
    "Actionist": {
        "acknowledge_info",
        "accept_action",
        "start_action",
        "block_action",
        "complete_action",
        "draft_response",
        "submit_for_approval",
        "add_action",
        "request_clarification",
        "mark_complete",
    },
    "Viewer": set(),
}

ENTERPRISE_ACTIONS = {
    "validate",
    "classify",
    "approve_routing",
    "route_info",
    "acknowledge_info",
    "close_information",
    "delegate",
    "handle_here",
    "accept_action",
    "start_action",
    "block_action",
    "complete_action",
    "draft_response",
    "submit_for_approval",
    "approve_step",
    "return_for_revision",
    "dispatch",
}


def canonical_status(status: str) -> str:
    return LEGACY_STATUS_MAP.get(status, status)


def can_use_llm_analysis(role: str) -> bool:
    return normalize_role(role) in LLM_ANALYSIS_ROLES


def _dept_by_name(db: Session, name: str | None) -> Department | None:
    if not name:
        return None
    return db.query(Department).filter(Department.name == name).one_or_none()


def _dept_by_id(db: Session, dept_id: int | None) -> Department | None:
    if not dept_id:
        return None
    return db.get(Department, dept_id)


def _user_department(db: Session, user_name: str) -> Department | None:
    user = db.query(User).filter(User.name == user_name).one_or_none()
    if not user or not user.department:
        return None
    return _dept_by_name(db, user.department)


def _is_child_department(db: Session, parent_id: int | None, child_id: int | None) -> bool:
    if parent_id is None or child_id is None:
        return False
    if parent_id == child_id:
        return True
    current = _dept_by_id(db, child_id)
    seen: set[int] = set()
    while current and current.parent_id is not None:
        if current.parent_id == parent_id:
            return True
        if current.parent_id in seen:
            break
        seen.add(current.parent_id)
        current = _dept_by_id(db, current.parent_id)
    return False


def _ancestor_chain(db: Session, dept_id: int | None) -> list[Department]:
    """Climb from dept to root (inclusive), leaf-first."""
    chain: list[Department] = []
    current = _dept_by_id(db, dept_id)
    seen: set[int] = set()
    while current and current.id not in seen:
        chain.append(current)
        seen.add(current.id)
        current = _dept_by_id(db, current.parent_id) if current.parent_id else None
    return chain


def _record_transition(
    db: Session,
    *,
    letter: Letter,
    action: str,
    from_status: str,
    to_status: str,
    actor: str,
    remarks: str = "",
    assigned_to: str = "",
    department: str = "",
) -> WorkflowTransition:
    row = WorkflowTransition(
        letter_id=letter.id,
        action=action,
        from_status=from_status,
        to_status=to_status,
        performed_by=actor,
        remarks=remarks,
        assigned_to=assigned_to or letter.assigned_to,
        department=department or letter.department,
    )
    db.add(row)
    db.add(
        LetterAction(
            letter_id=letter.id,
            action=action.replace("_", " ").title(),
            remarks=remarks,
            created_by=actor,
        )
    )
    letter.last_action = action.replace("_", " ").title()
    letter.updated_at = datetime.now()
    return row


def _set_status(letter: Letter, status: str) -> None:
    letter.status = status
    if status in {"Closed", "Completed", "Archived", "Rejected", "Information Delivered", "Dispatched"}:
        letter.completion_date = letter.completion_date or date.today()
    elif status not in {"Completed"}:
        if status in {"Reopened", "Action Assigned", "In Progress", "Under Approval", "Routed"}:
            letter.completion_date = None


def _dual_write_assignee(letter: Letter, assignee: str, assigner: str) -> None:
    if assignee:
        letter.assigned_to = assignee
        letter.assigned_by = assigner


def serialize_route_step(row: RouteStep) -> dict:
    return {
        "id": row.id,
        "letterId": str(row.letter_id),
        "stepType": row.step_type,
        "fromDepartmentId": row.from_department_id,
        "toDepartmentId": row.to_department_id,
        "fromUser": row.from_user,
        "toUser": row.to_user,
        "instructions": row.instructions,
        "dueDate": row.due_date.isoformat() if row.due_date else "",
        "priority": row.priority,
        "active": bool(row.active),
        "acknowledgedAt": row.acknowledged_at.isoformat() if row.acknowledged_at else "",
        "createdBy": row.created_by,
        "createdAt": row.created_at.isoformat() if row.created_at else "",
    }


def serialize_action_item(row: ActionItem) -> dict:
    return {
        "id": row.id,
        "letterId": str(row.letter_id),
        "parentActionId": row.parent_action_id,
        "departmentId": row.department_id,
        "assignee": row.assignee,
        "status": row.status,
        "instructions": row.instructions,
        "dueDate": row.due_date.isoformat() if row.due_date else "",
        "blockedReason": row.blocked_reason,
        "createdBy": row.created_by,
        "createdAt": row.created_at.isoformat() if row.created_at else "",
        "updatedAt": row.updated_at.isoformat() if row.updated_at else "",
        "completedAt": row.completed_at.isoformat() if row.completed_at else "",
    }


def serialize_response_version(row: ResponseVersion) -> dict:
    return {
        "id": row.id,
        "letterId": str(row.letter_id),
        "version": row.version,
        "bodyText": row.body_text,
        "status": row.status,
        "preparedBy": row.prepared_by,
        "documentId": row.document_id,
        "createdAt": row.created_at.isoformat() if row.created_at else "",
        "updatedAt": row.updated_at.isoformat() if row.updated_at else "",
    }


def serialize_approval_step(row: ApprovalStep) -> dict:
    return {
        "id": row.id,
        "responseVersionId": row.response_version_id,
        "tierOrder": row.tier_order,
        "departmentId": row.department_id,
        "reviewer": row.reviewer,
        "status": row.status,
        "remarks": row.remarks,
        "reviewedAt": row.reviewed_at.isoformat() if row.reviewed_at else "",
        "createdAt": row.created_at.isoformat() if row.created_at else "",
    }


def serialize_dispatch(row: DispatchRecord) -> dict:
    return {
        "id": row.id,
        "letterId": str(row.letter_id),
        "responseVersionId": row.response_version_id,
        "channel": row.channel,
        "dispatchedBy": row.dispatched_by,
        "recipients": row.recipients,
        "notes": row.notes,
        "dispatchedAt": row.dispatched_at.isoformat() if row.dispatched_at else "",
    }


def list_route_steps(db: Session, letter_id: int) -> list[dict]:
    rows = (
        db.query(RouteStep)
        .filter(RouteStep.letter_id == letter_id)
        .order_by(RouteStep.id.asc())
        .all()
    )
    return [serialize_route_step(r) for r in rows]


def list_action_items(db: Session, letter_id: int) -> list[dict]:
    rows = (
        db.query(ActionItem)
        .filter(ActionItem.letter_id == letter_id)
        .order_by(ActionItem.id.asc())
        .all()
    )
    return [serialize_action_item(r) for r in rows]


def list_response_versions(db: Session, letter_id: int) -> list[dict]:
    rows = (
        db.query(ResponseVersion)
        .filter(ResponseVersion.letter_id == letter_id)
        .order_by(ResponseVersion.version.asc())
        .all()
    )
    return [serialize_response_version(r) for r in rows]


def list_approval_steps_for_letter(db: Session, letter_id: int) -> list[dict]:
    versions = db.query(ResponseVersion).filter(ResponseVersion.letter_id == letter_id).all()
    if not versions:
        return []
    ids = [v.id for v in versions]
    rows = (
        db.query(ApprovalStep)
        .filter(ApprovalStep.response_version_id.in_(ids))
        .order_by(ApprovalStep.response_version_id.asc(), ApprovalStep.tier_order.asc())
        .all()
    )
    return [serialize_approval_step(r) for r in rows]


def list_dispatches(db: Session, letter_id: int) -> list[dict]:
    rows = (
        db.query(DispatchRecord)
        .filter(DispatchRecord.letter_id == letter_id)
        .order_by(DispatchRecord.id.asc())
        .all()
    )
    return [serialize_dispatch(r) for r in rows]


def letter_ids_for_user_inbox(db: Session, user_name: str) -> set[int]:
    """Open ActionItems or active INFO routes addressed to the user."""
    open_statuses = {"Open", "Accepted", "In Progress", "Blocked", "Submitted"}
    action_ids = {
        r[0]
        for r in db.query(ActionItem.letter_id)
        .filter(ActionItem.assignee == user_name, ActionItem.status.in_(open_statuses))
        .all()
    }
    info_ids = {
        r[0]
        for r in db.query(RouteStep.letter_id)
        .filter(
            RouteStep.to_user == user_name,
            RouteStep.active.is_(True),
            RouteStep.step_type == "INFO",
        )
        .all()
    }
    return action_ids | info_ids


def available_enterprise_actions(db: Session, letter: Letter, actor_name: str) -> list[str]:
    role = resolve_user_role(db, actor_name)
    permitted = ROLE_PERMISSIONS.get(role, set())
    status = canonical_status(letter.status)
    category = letter.correspondence_category or ""
    out: list[str] = []

    def allow(action: str, *statuses: str) -> None:
        if action in permitted and (not statuses or status in statuses):
            out.append(action)

    allow("validate", "Registered", "OCR Processed", "LLM Analyzed")
    allow("classify", "Validated", "LLM Analyzed", "OCR Processed", "Registered")
    if category == "Actionable":
        allow("approve_routing", "Classified", "Pending Routing Approval")
        allow("delegate", "Routed", "Action Assigned", "In Progress", "Pending Routing Approval")
        allow("handle_here", "Routed", "Action Assigned", "Pending Routing Approval")
        allow(
            "accept_action",
            "Action Assigned",
            "In Progress",
            "Routed",
            "Returned for Revision",
        )
        allow("start_action", "Action Assigned", "In Progress", "Routed")
        allow("block_action", "In Progress", "Action Assigned")
        allow("complete_action", "In Progress", "Action Assigned")
        allow(
            "draft_response",
            "In Progress",
            "Action Assigned",
            "Returned for Revision",
            "Response Drafted",
        )
        allow(
            "submit_for_approval",
            "Response Drafted",
            "In Progress",
            "Returned for Revision",
        )
        allow("approve_step", "Under Approval")
        allow("return_for_revision", "Under Approval", "Response Drafted")
        allow("dispatch", "Approved for Dispatch")
    if category == "Information":
        allow("route_info", "Classified", "Routed")
        allow("acknowledge_info", "Routed", "Classified")
        allow("close_information", "Routed", "Classified", "Information Delivered")
    # Always offer route_info after classify for either path when coordinator
    if status == "Classified" and "route_info" in permitted and "route_info" not in out:
        out.append("route_info")

    return out


def execute_enterprise_action(
    db: Session,
    *,
    letter: Letter,
    action: str,
    actor_name: str,
    remarks: str = "",
    assigned_to: str | None = None,
    department: str | None = None,
    department_id: int | None = None,
    category: str | None = None,
    action_item_id: int | None = None,
    response_body: str | None = None,
    response_version_id: int | None = None,
    approval_step_id: int | None = None,
    info_recipients: list[dict] | None = None,
    dispatch_channel: str | None = None,
    dispatch_recipients: str | None = None,
    priority: str | None = None,
    due_date: date | None = None,
    instructions: str | None = None,
    blocked_reason: str | None = None,
    document_id: int | None = None,
) -> WorkflowTransition:
    if action not in ENTERPRISE_ACTIONS:
        raise HTTPException(status_code=400, detail=f"Unknown enterprise action: {action}")

    role = resolve_user_role(db, actor_name)
    if action not in ROLE_PERMISSIONS.get(role, set()):
        raise HTTPException(status_code=403, detail="Access denied for this workflow action")

    if getattr(letter, "is_archived", False) or letter.status == "Archived":
        raise HTTPException(status_code=400, detail="Archived correspondence cannot be modified")

    from_status = letter.status
    handlers = {
        "validate": _do_validate,
        "classify": _do_classify,
        "approve_routing": _do_approve_routing,
        "route_info": _do_route_info,
        "acknowledge_info": _do_acknowledge_info,
        "close_information": _do_close_information,
        "delegate": _do_delegate,
        "handle_here": _do_handle_here,
        "accept_action": _do_accept_action,
        "start_action": _do_start_action,
        "block_action": _do_block_action,
        "complete_action": _do_complete_action,
        "draft_response": _do_draft_response,
        "submit_for_approval": _do_submit_for_approval,
        "approve_step": _do_approve_step,
        "return_for_revision": _do_return_for_revision,
        "dispatch": _do_dispatch,
    }
    to_status = handlers[action](
        db,
        letter=letter,
        actor_name=actor_name,
        role=role,
        remarks=remarks,
        assigned_to=assigned_to,
        department=department,
        department_id=department_id,
        category=category,
        action_item_id=action_item_id,
        response_body=response_body,
        response_version_id=response_version_id,
        approval_step_id=approval_step_id,
        info_recipients=info_recipients,
        dispatch_channel=dispatch_channel,
        dispatch_recipients=dispatch_recipients,
        priority=priority,
        due_date=due_date,
        instructions=instructions,
        blocked_reason=blocked_reason,
        document_id=document_id,
    )
    transition = _record_transition(
        db,
        letter=letter,
        action=action,
        from_status=from_status,
        to_status=to_status,
        actor=actor_name,
        remarks=remarks,
        assigned_to=assigned_to or letter.assigned_to,
        department=department or letter.department,
    )
    add_audit(
        db,
        user=actor_name,
        module="Workflow",
        action=action.replace("_", " ").title(),
        record=letter.number,
        description=remarks or f"{from_status} → {to_status}",
    )
    db.flush()
    return transition


def _do_validate(db: Session, *, letter: Letter, actor_name: str, role: str, **kwargs) -> str:
    # Management may mark LLM Analyzed; others only OCR→Validated path.
    status = canonical_status(letter.status)
    if status not in {"Registered", "OCR Processed", "LLM Analyzed"}:
        raise HTTPException(status_code=400, detail=f"Cannot validate from status '{letter.status}'")
    if status == "LLM Analyzed" and not can_use_llm_analysis(role):
        raise HTTPException(
            status_code=403,
            detail="LLM analysis validation requires Management role",
        )
    letter.validated_at = datetime.now()
    _set_status(letter, "Validated")
    return "Validated"


def _do_classify(
    db: Session,
    *,
    letter: Letter,
    actor_name: str,
    category: str | None,
    **kwargs,
) -> str:
    status = canonical_status(letter.status)
    if status not in {"Validated", "LLM Analyzed", "OCR Processed", "Registered", "Classified"}:
        raise HTTPException(status_code=400, detail=f"Cannot classify from status '{letter.status}'")
    cat = (category or "").strip()
    if cat not in {"Information", "Actionable"}:
        raise HTTPException(status_code=400, detail="category must be Information or Actionable")
    letter.correspondence_category = cat
    letter.classified_at = datetime.now()
    _set_status(letter, "Classified")
    if cat == "Actionable":
        _set_status(letter, "Pending Routing Approval")
        return "Pending Routing Approval"
    return "Classified"


def _do_approve_routing(
    db: Session,
    *,
    letter: Letter,
    actor_name: str,
    assigned_to: str | None,
    department: str | None,
    department_id: int | None,
    priority: str | None,
    due_date: date | None,
    instructions: str | None,
    remarks: str,
    **kwargs,
) -> str:
    if letter.correspondence_category != "Actionable":
        raise HTTPException(status_code=400, detail="Routing approval only for Actionable letters")
    status = canonical_status(letter.status)
    if status not in {"Classified", "Pending Routing Approval"}:
        raise HTTPException(status_code=400, detail=f"Cannot approve routing from '{letter.status}'")

    dept = _dept_by_id(db, department_id) or _dept_by_name(db, department)
    if dept:
        letter.department_id = dept.id
        letter.department = dept.name
    if priority:
        letter.priority = priority
    if due_date:
        letter.due_date = due_date

    lead = assigned_to or (dept.head if dept else "") or letter.assigned_to
    actor_dept = _user_department(db, actor_name)
    db.add(
        RouteStep(
            letter_id=letter.id,
            step_type="ROUTE",
            from_department_id=actor_dept.id if actor_dept else None,
            to_department_id=dept.id if dept else letter.department_id,
            from_user=actor_name,
            to_user=lead,
            instructions=instructions or remarks or "",
            due_date=letter.due_date,
            priority=letter.priority,
            active=True,
            created_by=actor_name,
        )
    )
    if lead:
        _dual_write_assignee(letter, lead, actor_name)
        db.add(
            ActionItem(
                letter_id=letter.id,
                department_id=dept.id if dept else letter.department_id,
                assignee=lead,
                status="Open",
                instructions=instructions or remarks or "",
                due_date=letter.due_date,
                created_by=actor_name,
            )
        )
        add_notification(
            db,
            title="Letter Routed",
            description=f"{letter.number} routed to you for action.",
            priority=letter.priority or "Important",
            letter_id=letter.id,
            notification_type="Assignment",
            recipient_name=lead,
            related_entity_type="letter",
            related_entity_id=str(letter.id),
        )
    _set_status(letter, "Routed")
    return "Routed"


def _do_route_info(
    db: Session,
    *,
    letter: Letter,
    actor_name: str,
    info_recipients: list[dict] | None,
    instructions: str | None,
    remarks: str,
    **kwargs,
) -> str:
    recipients = info_recipients or []
    if not recipients:
        raise HTTPException(status_code=400, detail="infoRecipients required for route_info")
    actor_dept = _user_department(db, actor_name)
    for rec in recipients:
        to_user = (rec.get("user") or rec.get("toUser") or "").strip()
        to_dept_id = rec.get("departmentId") or rec.get("toDepartmentId")
        to_dept_name = rec.get("department") or ""
        dept = _dept_by_id(db, to_dept_id) if to_dept_id else _dept_by_name(db, to_dept_name)
        db.add(
            RouteStep(
                letter_id=letter.id,
                step_type="INFO",
                from_department_id=actor_dept.id if actor_dept else None,
                to_department_id=dept.id if dept else None,
                from_user=actor_name,
                to_user=to_user,
                instructions=instructions or remarks or "For information",
                priority=letter.priority,
                active=True,
                created_by=actor_name,
            )
        )
        if to_user:
            add_notification(
                db,
                title="FYI Letter",
                description=f"{letter.number} shared for information.",
                priority="Routine",
                letter_id=letter.id,
                notification_type="Information",
                recipient_name=to_user,
                related_entity_type="letter",
                related_entity_id=str(letter.id),
            )
    if letter.correspondence_category != "Information":
        letter.correspondence_category = letter.correspondence_category or "Information"
    _set_status(letter, "Routed")
    return "Routed"


def _do_acknowledge_info(
    db: Session,
    *,
    letter: Letter,
    actor_name: str,
    **kwargs,
) -> str:
    steps = (
        db.query(RouteStep)
        .filter(
            RouteStep.letter_id == letter.id,
            RouteStep.step_type == "INFO",
            RouteStep.to_user == actor_name,
            RouteStep.active.is_(True),
        )
        .all()
    )
    if not steps:
        raise HTTPException(status_code=400, detail="No active INFO route for this user")
    now = datetime.now()
    for step in steps:
        step.acknowledged_at = now
    return letter.status


def _do_close_information(db: Session, *, letter: Letter, actor_name: str, **kwargs) -> str:
    if letter.correspondence_category and letter.correspondence_category != "Information":
        raise HTTPException(status_code=400, detail="close_information only for Information letters")
    letter.close_reason = "INFORMATION_DELIVERED"
    # Deactivate info routes
    db.query(RouteStep).filter(
        RouteStep.letter_id == letter.id,
        RouteStep.step_type == "INFO",
        RouteStep.active.is_(True),
    ).update({RouteStep.active: False}, synchronize_session=False)
    _set_status(letter, "Information Delivered")
    return "Information Delivered"


def _do_delegate(
    db: Session,
    *,
    letter: Letter,
    actor_name: str,
    assigned_to: str | None,
    department: str | None,
    department_id: int | None,
    instructions: str | None,
    due_date: date | None,
    remarks: str,
    action_item_id: int | None,
    **kwargs,
) -> str:
    if not assigned_to:
        raise HTTPException(status_code=400, detail="assignedTo required for delegate")
    actor_dept = _user_department(db, actor_name)
    target_dept = _dept_by_id(db, department_id) or _dept_by_name(db, department)
    if actor_dept and target_dept and not _is_child_department(db, actor_dept.id, target_dept.id):
        # Allow same dept or child; Management can cross
        role = resolve_user_role(db, actor_name)
        if role not in {"Management", "Admin", "Coordinator"}:
            raise HTTPException(
                status_code=403,
                detail="Can only delegate within your department subtree",
            )

    parent_id = action_item_id
    db.add(
        RouteStep(
            letter_id=letter.id,
            step_type="ROUTE",
            from_department_id=actor_dept.id if actor_dept else None,
            to_department_id=target_dept.id if target_dept else None,
            from_user=actor_name,
            to_user=assigned_to,
            instructions=instructions or remarks or "",
            due_date=due_date or letter.due_date,
            priority=letter.priority,
            active=True,
            created_by=actor_name,
        )
    )
    db.add(
        ActionItem(
            letter_id=letter.id,
            parent_action_id=parent_id,
            department_id=target_dept.id if target_dept else None,
            assignee=assigned_to,
            status="Open",
            instructions=instructions or remarks or "",
            due_date=due_date or letter.due_date,
            created_by=actor_name,
        )
    )
    _dual_write_assignee(letter, assigned_to, actor_name)
    if target_dept:
        letter.department_id = target_dept.id
        letter.department = target_dept.name
    add_notification(
        db,
        title="Action Delegated",
        description=f"{letter.number}: action delegated to you.",
        priority=letter.priority or "Important",
        letter_id=letter.id,
        notification_type="Assignment",
        recipient_name=assigned_to,
        related_entity_type="letter",
        related_entity_id=str(letter.id),
    )
    _set_status(letter, "Action Assigned")
    return "Action Assigned"


def _do_handle_here(
    db: Session,
    *,
    letter: Letter,
    actor_name: str,
    instructions: str | None,
    remarks: str,
    **kwargs,
) -> str:
    actor_dept = _user_department(db, actor_name)
    db.add(
        ActionItem(
            letter_id=letter.id,
            department_id=actor_dept.id if actor_dept else letter.department_id,
            assignee=actor_name,
            status="Accepted",
            instructions=instructions or remarks or "Handle at this tier",
            due_date=letter.due_date,
            created_by=actor_name,
        )
    )
    _dual_write_assignee(letter, actor_name, actor_name)
    _set_status(letter, "Action Assigned")
    return "Action Assigned"


def _get_action_item(db: Session, letter: Letter, action_item_id: int | None, actor: str) -> ActionItem:
    if action_item_id:
        item = db.get(ActionItem, action_item_id)
        if not item or item.letter_id != letter.id:
            raise HTTPException(status_code=404, detail="Action item not found")
        return item
    item = (
        db.query(ActionItem)
        .filter(
            ActionItem.letter_id == letter.id,
            ActionItem.assignee == actor,
            ActionItem.status.in_(["Open", "Accepted", "In Progress", "Blocked", "Submitted"]),
        )
        .order_by(ActionItem.id.desc())
        .first()
    )
    if not item:
        raise HTTPException(status_code=400, detail="No open action item for this user")
    return item


def _do_accept_action(db: Session, *, letter: Letter, actor_name: str, action_item_id: int | None, **kwargs) -> str:
    item = _get_action_item(db, letter, action_item_id, actor_name)
    if item.assignee and item.assignee != actor_name:
        role = resolve_user_role(db, actor_name)
        if role not in {"Manager", "Management", "Admin", "Coordinator"}:
            raise HTTPException(status_code=403, detail="Not the action assignee")
    item.status = "Accepted"
    item.updated_at = datetime.now()
    _set_status(letter, "Action Assigned")
    return "Action Assigned"


def _do_start_action(db: Session, *, letter: Letter, actor_name: str, action_item_id: int | None, **kwargs) -> str:
    item = _get_action_item(db, letter, action_item_id, actor_name)
    item.status = "In Progress"
    item.updated_at = datetime.now()
    _set_status(letter, "In Progress")
    return "In Progress"


def _do_block_action(
    db: Session,
    *,
    letter: Letter,
    actor_name: str,
    action_item_id: int | None,
    blocked_reason: str | None,
    remarks: str,
    **kwargs,
) -> str:
    item = _get_action_item(db, letter, action_item_id, actor_name)
    item.status = "Blocked"
    item.blocked_reason = blocked_reason or remarks or "Blocked"
    item.updated_at = datetime.now()
    return letter.status


def _do_complete_action(db: Session, *, letter: Letter, actor_name: str, action_item_id: int | None, **kwargs) -> str:
    item = _get_action_item(db, letter, action_item_id, actor_name)
    item.status = "Completed"
    item.completed_at = datetime.now()
    item.updated_at = datetime.now()
    return letter.status


def _do_draft_response(
    db: Session,
    *,
    letter: Letter,
    actor_name: str,
    response_body: str | None,
    document_id: int | None,
    remarks: str,
    **kwargs,
) -> str:
    body = (response_body or remarks or "").strip()
    if not body:
        raise HTTPException(status_code=400, detail="responseBody required for draft_response")
    latest = (
        db.query(ResponseVersion)
        .filter(ResponseVersion.letter_id == letter.id)
        .order_by(ResponseVersion.version.desc())
        .first()
    )
    if latest and latest.status == "Draft":
        latest.body_text = body
        if document_id:
            latest.document_id = document_id
        latest.updated_at = datetime.now()
    else:
        version = (latest.version + 1) if latest else 1
        if latest and latest.status in {"Submitted", "In Review"}:
            raise HTTPException(status_code=409, detail="A response is already under approval")
        if latest and latest.status == "Approved":
            latest.status = "Superseded"
        db.add(
            ResponseVersion(
                letter_id=letter.id,
                version=version,
                body_text=body,
                status="Draft",
                prepared_by=actor_name,
                document_id=document_id,
            )
        )
    _set_status(letter, "Response Drafted")
    return "Response Drafted"


def _head_for_department(db: Session, dept: Department) -> str:
    if dept.head:
        return dept.head
    user = (
        db.query(User)
        .filter(User.department == dept.name, User.status == "Active")
        .filter(User.role.in_(["Manager", "Management", "Coordinator", "Admin"]))
        .first()
    )
    return user.name if user else ""


def _do_submit_for_approval(
    db: Session,
    *,
    letter: Letter,
    actor_name: str,
    response_version_id: int | None,
    remarks: str,
    **kwargs,
) -> str:
    if response_version_id:
        version = db.get(ResponseVersion, response_version_id)
    else:
        version = (
            db.query(ResponseVersion)
            .filter(ResponseVersion.letter_id == letter.id, ResponseVersion.status == "Draft")
            .order_by(ResponseVersion.version.desc())
            .first()
        )
    if not version or version.letter_id != letter.id:
        raise HTTPException(status_code=400, detail="No draft response version to submit")
    if version.status != "Draft":
        raise HTTPException(status_code=400, detail="Response version is not a Draft")

    version.status = "Submitted"
    version.updated_at = datetime.now()

    # Build approval chain climbing dept hierarchy (leaf → root = first reviewer is immediate parent tier)
    start_dept_id = letter.department_id
    if not start_dept_id:
        actor_dept = _user_department(db, actor_name)
        start_dept_id = actor_dept.id if actor_dept else None
    chain = _ancestor_chain(db, start_dept_id)  # leaf-first

    # Clear prior pending steps for this version
    db.query(ApprovalStep).filter(ApprovalStep.response_version_id == version.id).delete(
        synchronize_session=False
    )

    tier = 1
    first_reviewer = ""
    # Approve upward: Section → Division → Wing → Secretariat (leaf first)
    for dept in chain:
        reviewer = _head_for_department(db, dept)
        if not reviewer:
            continue
        if reviewer == actor_name:
            # Never require self-approval at any tier
            continue
        db.add(
            ApprovalStep(
                response_version_id=version.id,
                tier_order=tier,
                department_id=dept.id,
                reviewer=reviewer,
                status="Pending",
            )
        )
        if tier == 1:
            first_reviewer = reviewer
        tier += 1

    if tier == 1:
        # No chain — create Management review step
        mgmt = (
            db.query(User)
            .filter(User.role.in_(["Management", "Admin"]), User.status == "Active")
            .filter(User.name != actor_name)
            .first()
        )
        reviewer = mgmt.name if mgmt else ""
        if not reviewer:
            raise HTTPException(
                status_code=400,
                detail="No eligible reviewer found for approval chain",
            )
        db.add(
            ApprovalStep(
                response_version_id=version.id,
                tier_order=1,
                reviewer=reviewer,
                status="Pending",
            )
        )
        first_reviewer = reviewer

    # Mark only first as active pending; others wait — all Pending is fine; approve advances in order
    version.status = "In Review"
    if first_reviewer:
        add_notification(
            db,
            title="Approval Required",
            description=f"Review response for {letter.number}.",
            priority="High",
            letter_id=letter.id,
            notification_type="Approval Required",
            recipient_name=first_reviewer,
            related_entity_type="letter",
            related_entity_id=str(letter.id),
        )

    # Sync action item to Submitted
    item = (
        db.query(ActionItem)
        .filter(ActionItem.letter_id == letter.id, ActionItem.assignee == actor_name)
        .order_by(ActionItem.id.desc())
        .first()
    )
    if item and item.status in {"Open", "Accepted", "In Progress"}:
        item.status = "Submitted"
        item.updated_at = datetime.now()

    _set_status(letter, "Under Approval")
    return "Under Approval"


def _current_pending_step(db: Session, version_id: int) -> ApprovalStep | None:
    return (
        db.query(ApprovalStep)
        .filter(ApprovalStep.response_version_id == version_id, ApprovalStep.status == "Pending")
        .order_by(ApprovalStep.tier_order.asc())
        .first()
    )


def _do_approve_step(
    db: Session,
    *,
    letter: Letter,
    actor_name: str,
    role: str,
    approval_step_id: int | None,
    response_version_id: int | None,
    remarks: str,
    **kwargs,
) -> str:
    version = None
    if response_version_id:
        version = db.get(ResponseVersion, response_version_id)
    else:
        version = (
            db.query(ResponseVersion)
            .filter(
                ResponseVersion.letter_id == letter.id,
                ResponseVersion.status.in_(["Submitted", "In Review"]),
            )
            .order_by(ResponseVersion.version.desc())
            .first()
        )
    if not version:
        raise HTTPException(status_code=400, detail="No response under approval")

    if approval_step_id:
        step = db.get(ApprovalStep, approval_step_id)
    else:
        step = _current_pending_step(db, version.id)
    if not step or step.response_version_id != version.id:
        raise HTTPException(status_code=400, detail="No pending approval step")
    if step.status != "Pending":
        raise HTTPException(status_code=400, detail="Step is not pending")

    # Must be current lowest pending tier
    current = _current_pending_step(db, version.id)
    if current and current.id != step.id:
        raise HTTPException(status_code=400, detail="Earlier approval tier is still pending")

    if step.reviewer and step.reviewer != actor_name and role not in {"Management", "Admin"}:
        raise HTTPException(status_code=403, detail="Not the designated reviewer for this tier")
    if version.prepared_by == actor_name:
        raise HTTPException(status_code=400, detail="Self-approval is prohibited")

    step.status = "Approved"
    step.remarks = remarks
    step.reviewed_at = datetime.now()
    if not step.reviewer:
        step.reviewer = actor_name
    db.flush()

    remaining = (
        db.query(ApprovalStep)
        .filter(ApprovalStep.response_version_id == version.id, ApprovalStep.status == "Pending")
        .count()
    )
    if remaining == 0:
        version.status = "Approved"
        version.updated_at = datetime.now()
        _set_status(letter, "Approved for Dispatch")
        add_notification(
            db,
            title="Response Approved",
            description=f"{letter.number} approved for dispatch.",
            priority="Important",
            letter_id=letter.id,
            notification_type="Approval",
            recipient_name=version.prepared_by,
            related_entity_type="letter",
            related_entity_id=str(letter.id),
        )
        return "Approved for Dispatch"

    next_step = _current_pending_step(db, version.id)
    if next_step and next_step.reviewer:
        add_notification(
            db,
            title="Approval Required",
            description=f"Next-tier review for {letter.number}.",
            priority="High",
            letter_id=letter.id,
            notification_type="Approval Required",
            recipient_name=next_step.reviewer,
            related_entity_type="letter",
            related_entity_id=str(letter.id),
        )
    return "Under Approval"


def _do_return_for_revision(
    db: Session,
    *,
    letter: Letter,
    actor_name: str,
    role: str,
    approval_step_id: int | None,
    response_version_id: int | None,
    remarks: str,
    **kwargs,
) -> str:
    version = None
    if response_version_id:
        version = db.get(ResponseVersion, response_version_id)
    else:
        version = (
            db.query(ResponseVersion)
            .filter(
                ResponseVersion.letter_id == letter.id,
                ResponseVersion.status.in_(["Submitted", "In Review", "Draft"]),
            )
            .order_by(ResponseVersion.version.desc())
            .first()
        )
    if not version:
        raise HTTPException(status_code=400, detail="No response version to return")

    step = None
    if approval_step_id:
        step = db.get(ApprovalStep, approval_step_id)
    else:
        step = _current_pending_step(db, version.id)
    if step and step.response_version_id == version.id:
        if step.reviewer and step.reviewer != actor_name and role not in {"Management", "Admin", "Manager"}:
            raise HTTPException(status_code=403, detail="Not authorized to return this step")
        step.status = "Returned"
        step.remarks = remarks
        step.reviewed_at = datetime.now()

    version.status = "Draft"
    version.updated_at = datetime.now()
    db.add(
        RouteStep(
            letter_id=letter.id,
            step_type="RETURN",
            from_user=actor_name,
            to_user=version.prepared_by,
            instructions=remarks or "Returned for revision",
            active=True,
            created_by=actor_name,
        )
    )
    if version.prepared_by:
        add_notification(
            db,
            title="Revision Required",
            description=f"{letter.number}: response returned for revision.",
            priority="High",
            letter_id=letter.id,
            notification_type="Revision",
            recipient_name=version.prepared_by,
            related_entity_type="letter",
            related_entity_id=str(letter.id),
        )
    _set_status(letter, "Returned for Revision")
    return "Returned for Revision"


def _do_dispatch(
    db: Session,
    *,
    letter: Letter,
    actor_name: str,
    role: str,
    response_version_id: int | None,
    dispatch_channel: str | None,
    dispatch_recipients: str | None,
    remarks: str,
    **kwargs,
) -> str:
    channel = (dispatch_channel or "Internal").strip()
    if channel not in {"External", "Internal"}:
        raise HTTPException(status_code=400, detail="dispatchChannel must be External or Internal")
    if channel == "External" and role not in {"Management", "Admin"}:
        raise HTTPException(status_code=403, detail="External dispatch requires Management")

    status = canonical_status(letter.status)
    if status not in {"Approved for Dispatch", "Response Approved"}:
        raise HTTPException(status_code=400, detail=f"Cannot dispatch from status '{letter.status}'")

    if response_version_id:
        version = db.get(ResponseVersion, response_version_id)
    else:
        version = (
            db.query(ResponseVersion)
            .filter(ResponseVersion.letter_id == letter.id, ResponseVersion.status == "Approved")
            .order_by(ResponseVersion.version.desc())
            .first()
        )
    if not version:
        raise HTTPException(status_code=400, detail="No approved response to dispatch")

    version.status = "Dispatched"
    version.updated_at = datetime.now()
    db.add(
        DispatchRecord(
            letter_id=letter.id,
            response_version_id=version.id,
            channel=channel,
            dispatched_by=actor_name,
            recipients=dispatch_recipients or letter.sender or letter.recipient,
            notes=remarks,
        )
    )
    db.add(
        RouteStep(
            letter_id=letter.id,
            step_type="DISPATCH",
            from_user=actor_name,
            to_user=dispatch_recipients or letter.sender,
            instructions=remarks or f"Dispatched via {channel}",
            active=False,
            created_by=actor_name,
        )
    )
    letter.close_reason = "DISPATCHED"
    _set_status(letter, "Dispatched")
    # Auto-close after dispatch
    _set_status(letter, "Closed")
    letter.close_reason = "DISPATCHED"
    return "Closed"
