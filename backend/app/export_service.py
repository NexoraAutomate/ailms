"""Server-side CSV export with RBAC-aware letter filtering."""

from __future__ import annotations

import csv
import io
from datetime import date

from sqlalchemy.orm import Session

from app.models import AuditRecord, Department, Letter, Meeting, Notification, Organization
from app.services import effective_status, iso


def _letters_query(db: Session, *, include_archived: bool = False):
    q = db.query(Letter)
    if not include_archived:
        q = q.filter(Letter.is_archived.is_(False))
    return q.order_by(Letter.id.desc())


def export_letters_csv(db: Session, letter_ids: list[int] | None = None, *, include_archived: bool = False) -> str:
    q = _letters_query(db, include_archived=include_archived)
    if letter_ids:
        q = q.filter(Letter.id.in_(letter_ids))
    rows = q.all()
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "number",
            "letterDate",
            "receivedDate",
            "type",
            "subject",
            "from",
            "to",
            "department",
            "priority",
            "status",
            "dueDate",
            "assignedTo",
            "actionRequired",
            "remarks",
            "isArchived",
        ]
    )
    for letter in rows:
        writer.writerow(
            [
                letter.number,
                iso(letter.letter_date),
                iso(letter.received_date),
                letter.type,
                letter.subject,
                letter.sender,
                letter.recipient,
                letter.department,
                letter.priority,
                effective_status(letter),
                iso(letter.due_date),
                letter.assigned_to,
                letter.action_required,
                letter.remarks,
                "yes" if letter.is_archived else "no",
            ]
        )
    return buf.getvalue()


def export_departments_csv(db: Session) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["code", "name", "head", "status"])
    for row in db.query(Department).order_by(Department.name).all():
        writer.writerow([row.code, row.name, row.head, row.status])
    return buf.getvalue()


def export_organizations_csv(db: Session) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["name", "shortName", "type", "contact", "email", "phone", "status"])
    for row in db.query(Organization).order_by(Organization.name).all():
        writer.writerow([row.name, row.short_name, row.type, row.contact, row.email, row.phone, row.status])
    return buf.getvalue()


def export_audit_csv(db: Session, limit: int = 5000) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["timestamp", "user", "module", "action", "record", "description"])
    for row in db.query(AuditRecord).order_by(AuditRecord.id.desc()).limit(limit).all():
        writer.writerow(
            [
                row.created_at.isoformat() if row.created_at else "",
                row.user,
                row.module,
                row.action,
                row.record,
                row.description,
            ]
        )
    return buf.getvalue()


def export_meetings_csv(db: Session) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["title", "date", "startTime", "endTime", "location", "chairperson", "status"])
    for row in db.query(Meeting).order_by(Meeting.meeting_date.desc()).all():
        writer.writerow(
            [
                row.title,
                iso(row.meeting_date),
                row.start_time or "",
                row.end_time or "",
                row.location,
                row.chairperson,
                row.status,
            ]
        )
    return buf.getvalue()


def export_notifications_csv(db: Session, recipient: str | None = None) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["createdAt", "recipient", "type", "title", "description", "readAt"])
    q = db.query(Notification).order_by(Notification.id.desc())
    if recipient:
        q = q.filter(Notification.recipient_name == recipient)
    for row in q.limit(5000).all():
        writer.writerow(
            [
                row.created_at.isoformat() if row.created_at else "",
                row.recipient_name,
                row.notification_type,
                row.title,
                row.description,
                row.read_at.isoformat() if row.read_at else "",
            ]
        )
    return buf.getvalue()
