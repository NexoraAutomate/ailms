"""Notification creation, typing, and recipient scoping."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models import Letter, Notification, User

NOTIFICATION_TYPES = [
    "New Assignment",
    "Reassignment",
    "Forwarded Letter",
    "Deadline Approaching",
    "Due Today",
    "Overdue",
    "Approval Required",
    "Response Received",
    "Escalation",
    "Document Uploaded",
    "New Document Version",
    "Meeting Assigned",
    "Meeting Action Due",
    "Workflow Status Changed",
    "System Notification",
]

TITLE_TYPE_MAP: dict[str, str] = {
    "new assignment": "New Assignment",
    "reassignment": "Reassignment",
    "forwarded letter": "Forwarded Letter",
    "deadline approaching": "Deadline Approaching",
    "due today": "Due Today",
    "overdue": "Overdue",
    "overdue correspondence": "Overdue",
    "approval required": "Approval Required",
    "response received": "Response Received",
    "escalation": "Escalation",
    "document uploaded": "Document Uploaded",
    "new document version": "New Document Version",
    "meeting assigned": "Meeting Assigned",
    "meeting action due": "Meeting Action Due",
    "workflow status changed": "Workflow Status Changed",
}


def infer_notification_type(title: str) -> str:
    return TITLE_TYPE_MAP.get(title.strip().lower(), "System Notification")


def resolve_recipient_user_id(db: Session, recipient_name: str | None) -> int | None:
    if not recipient_name:
        return None
    row = db.query(User.id).filter(User.name == recipient_name).scalar()
    return row


def create_notification(
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
) -> Notification:
    ntype = notification_type or infer_notification_type(title)
    if ntype not in NOTIFICATION_TYPES:
        ntype = "System Notification"

    if letter_id and not related_entity_type:
        related_entity_type = "letter"
        related_entity_id = str(letter_id)

    if recipient_name and not recipient_user_id:
        recipient_user_id = resolve_recipient_user_id(db, recipient_name)

    row = Notification(
        title=title,
        description=description,
        priority=priority,
        read=False,
        letter_id=letter_id,
        notification_type=ntype,
        recipient_name=recipient_name or "",
        recipient_user_id=recipient_user_id,
        related_entity_type=related_entity_type or "",
        related_entity_id=related_entity_id or "",
    )
    db.add(row)
    return row


def notifications_for_user_query(db: Session, current_user_name: str):
    user = db.query(User).filter(User.name == current_user_name).one_or_none()
    clauses = [
        Notification.recipient_name == "",
        Notification.recipient_name.is_(None),
        Notification.recipient_name == current_user_name,
    ]
    if user:
        clauses.append(Notification.recipient_user_id == user.id)
    return db.query(Notification).filter(or_(*clauses))


def navigation_hint(item: Notification) -> tuple[str, str]:
    entity_type = item.related_entity_type or ("letter" if item.letter_id else "")
    entity_id = item.related_entity_id or (str(item.letter_id) if item.letter_id else "")
    if entity_type == "letter" and entity_id:
        return entity_id, "Open letter"
    if entity_type == "meeting" and entity_id:
        return f"meeting:{entity_id}", "Open meeting"
    if entity_type == "meeting_action" and entity_id:
        return "", "View meeting action"
    if entity_type == "document" and entity_id:
        return entity_id if item.letter_id else "", "Open letter"
    if item.letter_id:
        return str(item.letter_id), "Open letter"
    return "", ""


def serialize_notification_row(item: Notification, *, relative_time_fn) -> dict:
    navigate_to, navigate_label = navigation_hint(item)
    return {
        "id": item.id,
        "title": item.title,
        "description": item.description,
        "time": relative_time_fn(item.created_at),
        "priority": item.priority,
        "read": item.read,
        "letter": str(item.letter_id or ""),
        "notificationType": item.notification_type or infer_notification_type(item.title),
        "recipientName": item.recipient_name or "",
        "relatedEntityType": item.related_entity_type or "",
        "relatedEntityId": item.related_entity_id or "",
        "readAt": item.read_at.isoformat() if item.read_at else "",
        "navigateTo": navigate_to,
        "navigateLabel": navigate_label,
        "createdAt": item.created_at.isoformat(),
    }


def backfill_notification_metadata(db: Session) -> None:
    rows = db.query(Notification).all()
    for row in rows:
        if not row.notification_type:
            row.notification_type = infer_notification_type(row.title)
        if row.letter_id and not row.related_entity_type:
            row.related_entity_type = "letter"
            row.related_entity_id = str(row.letter_id)
        if row.title.lower() in {"new assignment", "reassignment"} and row.letter_id and not row.recipient_name:
            letter = db.get(Letter, row.letter_id)
            if letter and letter.assigned_to:
                row.recipient_name = letter.assigned_to
                row.recipient_user_id = resolve_recipient_user_id(db, letter.assigned_to)


def mark_read(row: Notification) -> None:
    row.read = True
    row.read_at = datetime.now()
