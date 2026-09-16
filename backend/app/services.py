from datetime import date, datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import (
    AppSetting,
    AuditRecord,
    Department,
    Letter,
    MonthlyTrend,
    Notification,
    Organization,
    User,
)
from app.schemas import (
    AuditOut,
    DepartmentOut,
    LetterOut,
    NotificationOut,
    OrganizationOut,
    UserOut,
)

CLOSED_STATUSES = {"Completed", "Closed", "Archived", "Rejected"}
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


def serialize_letter(letter: Letter) -> LetterOut:
    status = effective_status(letter)
    completion = iso(letter.completion_date) if letter.status in CLOSED_STATUSES else "—"
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
        assignedTo=letter.assigned_to,
        lastAction=letter.last_action,
        daysPending=days_pending(letter),
        confidentiality=letter.confidentiality,
        actionRequired=letter.action_required,
        remarks=letter.remarks,
        completionDate=completion,
        isArchived=bool(getattr(letter, "is_archived", False)),
    )


def serialize_department(db: Session, department: Department) -> DepartmentOut:
    users = db.query(func.count(User.id)).filter(User.department == department.name).scalar() or 0
    pending = (
        db.query(func.count(Letter.id))
        .filter(Letter.department == department.name, Letter.status.notin_(CLOSED_STATUSES))
        .scalar()
        or 0
    )
    return DepartmentOut(
        code=department.code,
        name=department.name,
        head=department.head,
        users=users,
        pending=pending,
        status=department.status,
    )


def serialize_organization(organization: Organization) -> OrganizationOut:
    return OrganizationOut(
        name=organization.name,
        short=organization.short_name,
        type=organization.type,
        contact=organization.contact,
        email=organization.email,
        phone=organization.phone,
        status=organization.status,
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
    return setting_map(db)["currentUser"]


def resolve_user_role(db: Session, user_name: str) -> str:
    row = db.query(User).filter(User.name == user_name).one_or_none()
    if row:
        return row.role
    return "Department/User"
