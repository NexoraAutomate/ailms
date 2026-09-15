"""Deadline reminders with deduplicated notification generation."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.models import Letter, ReminderLog
from app.services import CLOSED_STATUSES, add_audit, add_notification, effective_status

DEFAULT_BEFORE_DAYS = (7, 3, 1)
DEFAULT_AFTER_DAYS = (1, 7, 30)


@dataclass(frozen=True)
class ReminderRule:
    key: str
    title: str
    priority: str


def _rules_for_delta(days_until: int) -> list[ReminderRule]:
    if days_until in DEFAULT_BEFORE_DAYS:
        return [
            ReminderRule(
                key=f"before_{days_until}d",
                title="Deadline Approaching",
                priority="Medium" if days_until > 1 else "High",
            )
        ]
    if days_until == 0:
        return [ReminderRule(key="due_today", title="Due Today", priority="High")]
    if days_until < 0:
        overdue = abs(days_until)
        rules: list[ReminderRule] = []
        if overdue in DEFAULT_AFTER_DAYS:
            rules.append(
                ReminderRule(
                    key=f"overdue_{overdue}d",
                    title="Overdue",
                    priority="Critical" if overdue >= 7 else "High",
                )
            )
        return rules
    return []


def _is_active(letter: Letter) -> bool:
    status = effective_status(letter)
    return status not in CLOSED_STATUSES and status != "Archived"


def _record_sent(db: Session, letter_id: int, key: str, anchor: date) -> bool:
    exists = (
        db.query(ReminderLog.id)
        .filter(
            ReminderLog.letter_id == letter_id,
            ReminderLog.reminder_key == key,
            ReminderLog.anchor_date == anchor,
        )
        .first()
    )
    if exists:
        return False
    db.add(ReminderLog(letter_id=letter_id, reminder_key=key, anchor_date=anchor))
    return True


def process_reminders(db: Session, *, today: date | None = None) -> dict[str, int]:
    """Scan letters and create notifications for configured reminder windows."""
    today = today or date.today()
    stats = {"lettersChecked": 0, "notificationsCreated": 0, "skippedDuplicates": 0}

    letters = db.query(Letter).all()
    for letter in letters:
        if not letter.due_date or not _is_active(letter):
            continue
        stats["lettersChecked"] += 1
        days_until = (letter.due_date - today).days
        for rule in _rules_for_delta(days_until):
            if _record_sent(db, letter.id, rule.key, letter.due_date):
                add_notification(
                    db,
                    title=rule.title,
                    description=f"{letter.number}: {letter.subject} (due {letter.due_date.isoformat()}).",
                    priority=rule.priority,
                    letter_id=letter.id,
                    notification_type=rule.title,
                    recipient_name=letter.assigned_to,
                    related_entity_type="letter",
                    related_entity_id=str(letter.id),
                )
                stats["notificationsCreated"] += 1
            else:
                stats["skippedDuplicates"] += 1

    if stats["notificationsCreated"]:
        add_audit(
            db,
            user="System",
            module="Reminders",
            action="Reminders Processed",
            record=str(stats["notificationsCreated"]),
            description=f"Generated {stats['notificationsCreated']} reminder notification(s)",
            source="Scheduler",
        )
    db.flush()
    return stats


def reminder_schedule() -> dict:
    return {
        "beforeDueDays": list(DEFAULT_BEFORE_DAYS),
        "dueToday": True,
        "afterDueDays": list(DEFAULT_AFTER_DAYS),
    }
