"""Response Required reminder worker for simple marking workflow (spec 05)."""

from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.models import Letter, Marking, MarkingReminderLog
from app.notification_channels import get_dispatcher

# Presets: one day before, on due date, one day after (emphasis).
REMINDER_SPECS = (
    ("rr_one_day_before", -1, "Medium", "Response due tomorrow"),
    ("rr_on_due", 0, "High", "Response due today"),
    ("rr_overdue", 1, "Critical", "Response overdue"),
)


def _already_sent(db: Session, marking_id: int, key: str, anchor: date) -> bool:
    return (
        db.query(MarkingReminderLog.id)
        .filter(
            MarkingReminderLog.marking_id == marking_id,
            MarkingReminderLog.reminder_key == key,
            MarkingReminderLog.anchor_date == anchor,
        )
        .first()
        is not None
    )


def process_marking_reminders(db: Session, today: date | None = None) -> dict:
    today = today or date.today()
    dispatcher = get_dispatcher()
    sent = 0
    scanned = 0

    rows = (
        db.query(Marking)
        .filter(
            Marking.action == "response_required",
            Marking.status == "active",
            Marking.reminders_enabled.is_(True),
            Marking.due_at.isnot(None),
        )
        .all()
    )
    for marking in rows:
        scanned += 1
        letter = db.get(Letter, marking.letter_id)
        if not letter or letter.status in {"Closed", "Archived"} or letter.is_archived:
            continue
        due = marking.due_at
        if due is None:
            continue
        delta_days = (today - due).days  # negative = before due
        for key, offset, priority, title in REMINDER_SPECS:
            if delta_days != offset:
                continue
            if _already_sent(db, marking.id, key, due):
                continue
            dispatcher.notify(
                db,
                recipient_name=marking.to_user,
                title=title,
                description=(
                    f"{letter.number}: Response Required ({marking.response_type or 'response'}) "
                    f"was due {due.isoformat()}. Marked by {marking.from_user}."
                ),
                priority=priority,
                letter_id=letter.id,
                notification_type="Response Reminder",
                email=True,
            )
            db.add(
                MarkingReminderLog(
                    marking_id=marking.id,
                    letter_id=letter.id,
                    reminder_key=key,
                    anchor_date=due,
                )
            )
            sent += 1
    return {"scanned": scanned, "sent": sent, "date": today.isoformat()}
