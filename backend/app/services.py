from datetime import date, datetime
import hashlib

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import (
    AppSetting,
    AuditRecord,
    Department,
    DepartmentLink,
    Letter,
    MonthlyTrend,
    Notification,
    Organization,
    User,
)
from app.schemas import (
    AuditOut,
    DepartmentLinkOut,
    DepartmentOut,
    LetterOut,
    NotificationOut,
    OrganizationOut,
    UserOut,
)

CLOSED_STATUSES = {
    "Completed",
    "Closed",
    "Archived",
    "Rejected",
    "Information Delivered",
    "Dispatched",
}
PENDING_STATUSES = {
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
    "Returned for Revision",
    "Escalated",
    "Reopened",
    "Overdue",
}


def avatar_public_url(user: User) -> str:
    """Stable API path for a user's photo; includes cache-bust token when file changes."""
    key = getattr(user, "avatar_key", "") or ""
    if not key:
        return ""
    version = hashlib.sha1(key.encode("utf-8")).hexdigest()[:10]
    return f"/api/users/{user.id}/avatar?v={version}"


def iso(value: date | None) -> str:
    return value.isoformat() if value else ""


def relative_time(value: datetime) -> str:
    delta = datetime.now() - value
    minutes = max(int(delta.total_seconds() // 60), 0)
    if minutes < 1:
        return "Just now"
    if minutes < 60:
        return f"{minutes} minute{'s' if minutes != 1 else ''} ago"
    hours = minutes // 60
    if hours < 24:
        return f"{hours} hour{'s' if hours != 1 else ''} ago"
    days = hours // 24
    if days == 1:
        return "Yesterday"
    if days < 7:
        return f"{days} days ago"
    return value.strftime("%b %d, %Y")


def activity_label(value: datetime | None) -> str:
    if not value:
        return "—"
    if value.date() == date.today():
        return f"Today, {value.strftime('%H:%M')}"
    if (date.today() - value.date()).days == 1:
        return "Yesterday"
    return value.strftime("%b %d, %Y")


def days_pending(letter: Letter) -> int:
    if letter.status in CLOSED_STATUSES:
        return 0
    return max((date.today() - letter.received_date).days, 0)


def effective_status(letter: Letter) -> str:
    if (
        letter.due_date
        and letter.due_date < date.today()
        and letter.status not in CLOSED_STATUSES
        and letter.status != "Overdue"
    ):
        return "Overdue"
    return letter.status


def serialize_letter(
    letter: Letter,
    *,
    include_body: bool = True,
    accessible: bool = True,
    db: Session | None = None,
    viewer: str | None = None,
    can_edit_details: bool | None = None,
    has_active_markings: bool | None = None,
) -> LetterOut:
    status = effective_status(letter)
    completion = iso(letter.completion_date) if letter.status in CLOSED_STATUSES else "—"
    edit_details = can_edit_details
    active_marks = has_active_markings
    assigned_to = letter.assigned_to or ""
    mark_to_users = ""
    mark_info_users = ""
    last_action_at = ""
    if db is not None:
        from app.marking_workflow_service import (
            can_edit_letter_details,
            current_actionable_holder_names,
            current_info_holder_names,
            derive_last_action_at,
            format_assigned_to_holders,
            has_active_markings as _has_active,
        )

        if edit_details is None and viewer:
            edit_details = can_edit_letter_details(db, letter, viewer)
        if active_marks is None:
            active_marks = _has_active(db, letter.id)
        # Authoritative live split: Assigned To = To holders; Info = for_info holders.
        to_holders = current_actionable_holder_names(db, letter.id)
        info_holders = current_info_holder_names(db, letter.id)
        if to_holders or info_holders or active_marks:
            mark_to_users = format_assigned_to_holders(to_holders)
            mark_info_users = format_assigned_to_holders(info_holders)
            if to_holders:
                assigned_to = mark_to_users
            elif not active_marks:
                assigned_to = letter.assigned_to or ""
            else:
                # Only Info holds remain — Assigned To stays empty for the To card.
                assigned_to = ""
        ts = derive_last_action_at(db, letter)
        if ts is not None:
            last_action_at = ts.isoformat()
    elif getattr(letter, "updated_at", None):
        last_action_at = letter.updated_at.isoformat()
    elif getattr(letter, "created_at", None):
        last_action_at = letter.created_at.isoformat()
    return LetterOut(
        id=str(letter.id),
        number=letter.number,
        letterDate=iso(letter.letter_date),
        receivedDate=iso(letter.received_date),
        type=letter.type,
        subject=letter.subject,
        from_=letter.sender,
        to=letter.recipient,
        department=letter.department,
        priority=letter.priority,
        status=status,
        dueDate=iso(letter.due_date),
        assignedTo=assigned_to,
        createdBy=getattr(letter, "created_by", "") or "",
        assignedBy=getattr(letter, "assigned_by", "") or "",
        lastAction=letter.last_action,
        lastActionAt=last_action_at,
        daysPending=days_pending(letter),
        confidentiality=letter.confidentiality,
        actionRequired=letter.action_required,
        remarks=letter.remarks,
        bodyText=(getattr(letter, "body_text", "") or "") if include_body else "",
        completionDate=completion,
        isArchived=bool(getattr(letter, "is_archived", False)),
        baseStatus=letter.status,
        accessible=accessible,
        correspondenceCategory=getattr(letter, "correspondence_category", "") or "",
        closeReason=getattr(letter, "close_reason", "") or "",
        departmentId=getattr(letter, "department_id", None),
        validatedAt=letter.validated_at.isoformat() if getattr(letter, "validated_at", None) else "",
        classifiedAt=letter.classified_at.isoformat() if getattr(letter, "classified_at", None) else "",
        canEditDetails=bool(edit_details),
        hasActiveMarkings=bool(active_marks),
        sentMarkingId=None,
        sentToUser="",
        sentPathId="",
        sentDueAt="",
        sentAction="",
        markedBy="",
        markToUsers=mark_to_users,
        markInfoUsers=mark_info_users,
        viewerHolds=False,
        canAssign=False,
        canRespond=False,
        canAccept=False,
        canDecline=False,
        acceptanceStatus="",
    )


def attach_inbox_marked_by(letter_out: LetterOut, marked_by: str) -> LetterOut:
    """Clone a letter DTO with the Inbox marker (who marked it to the viewer)."""
    return letter_out.model_copy(update={"markedBy": (marked_by or "").strip()})


def attach_inbox_hold_context(
    letter_out: LetterOut,
    *,
    inbox_role: str,
    mark_to_users: str,
    mark_info_users: str,
) -> LetterOut:
    """Clone a letter DTO with To/Info segregation fields for the Inbox view."""
    to_users = (mark_to_users or "").strip()
    return letter_out.model_copy(
        update={
            "inboxRole": (inbox_role or "").strip(),
            "markToUsers": to_users,
            "markInfoUsers": (mark_info_users or "").strip(),
            # Assigned To column shows actionable (To) recipients on this mark.
            "assignedTo": to_users or letter_out.assignedTo,
        }
    )


def attach_inbox_holder_actions(
    letter_out: LetterOut,
    *,
    can_assign: bool,
    can_respond: bool,
    can_accept: bool = False,
    can_decline: bool = False,
    acceptance_status: str = "",
) -> LetterOut:
    """Clone a letter DTO with Inbox Accept / Reject / Assign / Respond affordances."""
    return letter_out.model_copy(
        update={
            "viewerHolds": True,
            "canAssign": bool(can_assign),
            "canRespond": bool(can_respond),
            "canAccept": bool(can_accept),
            "canDecline": bool(can_decline),
            "acceptanceStatus": (acceptance_status or "").strip(),
        }
    )


def attach_sent_marking(
    letter_out: LetterOut,
    marking,
    *,
    mark_to_users: str = "",
    mark_info_users: str = "",
) -> LetterOut:
    """Clone a letter DTO as a Sent row bound to one Forward / Response Required marking."""
    to_user = (marking.to_user or "").strip()
    updates: dict = {
        "sentMarkingId": marking.id,
        "sentToUser": to_user,
        "sentPathId": marking.path_id or "",
        "sentDueAt": marking.due_at.isoformat() if marking.due_at else "",
        "sentAction": marking.action or "",
        # Assigned To = actionable (To) recipient for this Sent row.
        "assignedTo": to_user or letter_out.assignedTo,
        "assignedBy": marking.from_user or letter_out.assignedBy,
        "markToUsers": (mark_to_users or to_user).strip(),
        "markInfoUsers": (mark_info_users or "").strip(),
        "lastAction": (
            "Awaiting Response"
            if marking.action == "response_required"
            else f"Forwarded to {marking.to_user}"
        ),
        "status": (
            "Awaiting Response" if marking.action == "response_required" else letter_out.status
        ),
    }
    if marking.due_at:
        updates["dueDate"] = marking.due_at.isoformat()
    return letter_out.model_copy(update=updates)


def serialize_department(db: Session, department: Department) -> DepartmentOut:
    users = db.query(func.count(User.id)).filter(User.department == department.name).scalar() or 0
    pending = (
        db.query(func.count(Letter.id))
        .filter(Letter.department == department.name, Letter.status.notin_(CLOSED_STATUSES))
        .scalar()
        or 0
    )
    return DepartmentOut(
        id=department.id,
        code=department.code,
        name=department.name,
        head=department.head,
        users=users,
        pending=pending,
        status=department.status,
        parentId=department.parent_id,
        posX=float(department.pos_x or 0),
        posY=float(department.pos_y or 0),
        tier=getattr(department, "tier", None) or "Division",
    )


def serialize_department_link(link: DepartmentLink) -> DepartmentLinkOut:
    return DepartmentLinkOut(
        id=link.id,
        sourceId=link.source_id,
        targetId=link.target_id,
        kind=link.kind,
    )


def serialize_organization(organization: Organization) -> OrganizationOut:
    return OrganizationOut(
        id=organization.id,
        name=organization.name,
        short=organization.short_name,
        type=organization.type,
        contact=organization.contact,
        email=organization.email,
        phone=organization.phone,
        status=organization.status,
        color=getattr(organization, "color", "") or "",
    )


def serialize_user(user: User) -> UserOut:
    created = user.created_at.strftime("%d/%m/%Y") if getattr(user, "created_at", None) else "—"
    return UserOut(
        id=user.id,
        name=user.name,
        username=user.username,
        department=user.department,
        role=user.role,
        email=user.email,
        status=user.status,
        activity=activity_label(user.last_activity),
        created=created,
        avatarUrl=avatar_public_url(user),
    )


def serialize_notification(item: Notification) -> NotificationOut:
    from app.notification_service import serialize_notification_row

    return NotificationOut(**serialize_notification_row(item, relative_time_fn=relative_time))


def serialize_audit(item: AuditRecord) -> AuditOut:
    return AuditOut(
        date=item.created_at.strftime("%b %d, %Y %H:%M"),
        user=item.user,
        module=item.module,
        action=item.action,
        record=item.record,
        description=item.description,
        source=item.source,
    )


def add_audit(
    db: Session,
    *,
    user: str,
    module: str,
    action: str,
    record: str,
    description: str,
    source: str = "Web · 127.0.0.1",
) -> None:
    db.add(
        AuditRecord(
            user=user,
            module=module,
            action=action,
            record=record,
            description=description,
            source=source,
        )
    )


def add_notification(
    db: Session,
    *,
    title: str,
    description: str,
    priority: str = "Medium",
    letter_id: int | None = None,
    notification_type: str | None = None,
    recipient_name: str | None = None,
    recipient_user_id: int | None = None,
    related_entity_type: str | None = None,
    related_entity_id: str | None = None,
) -> None:
    from app.notification_service import create_notification

    create_notification(
        db,
        title=title,
        description=description,
        priority=priority,
        letter_id=letter_id,
        notification_type=notification_type,
        recipient_name=recipient_name,
        recipient_user_id=recipient_user_id,
        related_entity_type=related_entity_type,
        related_entity_id=related_entity_id,
    )


def bump_trend(db: Session, letter_type: str, letter_date: date, delta: int = 1) -> None:
    month = letter_date.strftime("%b")
    year = letter_date.year
    row = db.query(MonthlyTrend).filter(MonthlyTrend.year == year, MonthlyTrend.month == month).one_or_none()
    if not row:
        row = MonthlyTrend(year=year, month=month, incoming=0, outgoing=0)
        db.add(row)
        db.flush()
    if letter_type == "Outgoing":
        row.outgoing = max(row.outgoing + delta, 0)
    else:
        row.incoming = max(row.incoming + delta, 0)


def setting_map(db: Session) -> dict[str, str]:
    defaults = {
        "organizationName": "Office of the Secretary",
        "systemName": "Correspondence Management System",
        "defaultDueDays": "7",
        "currentUser": "A. Rahman",
    }
    stored = {row.key: row.value for row in db.query(AppSetting).all()}
    defaults.update(stored)
    return defaults


def current_user_name(db: Session) -> str:
    from app.auth_deps import get_request_user_name

    request_user = get_request_user_name()
    if request_user:
        return request_user
    return setting_map(db)["currentUser"]


def resolve_user_role(db: Session, user_name: str) -> str:
    row = db.query(User).filter(User.name == user_name).one_or_none()
    if row:
        return normalize_role(row.role)
    return "Actionist"


ROLE_ALIASES = {
    "Administrator": "Admin",
    "admin": "Admin",
    "Correspondence Officer": "Coordinator",
    "Department/User": "Actionist",
    "Clerk": "Coordinator",
}


def normalize_role(role: str) -> str:
    return ROLE_ALIASES.get(role, role)
