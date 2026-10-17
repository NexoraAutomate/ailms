"""Notification dispatcher: in-app always; email provisioned via SMTP settings (spec 05)."""

from __future__ import annotations

import logging
import smtplib
from datetime import datetime
from email.message import EmailMessage

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import OutboundEmail, User
from app.services import add_notification

logger = logging.getLogger("ailms.notifications")


class InAppChannel:
    def send(
        self,
        db: Session,
        *,
        recipient_name: str,
        title: str,
        description: str,
        priority: str,
        letter_id: int | None,
        notification_type: str,
    ) -> None:
        add_notification(
            db,
            title=title,
            description=description,
            priority=priority,
            letter_id=letter_id,
            notification_type=notification_type,
            recipient_name=recipient_name,
        )


class EmailChannel:
    """Queues and optionally sends email when MAIL_ENABLED + SMTP_HOST are set."""

    def send(
        self,
        db: Session,
        *,
        recipient_name: str,
        title: str,
        description: str,
        priority: str,
        letter_id: int | None,
        notification_type: str,
    ) -> None:
        settings = get_settings()
        user = db.query(User).filter(User.name == recipient_name).one_or_none()
        to_address = (user.email or "").strip() if user else ""
        row = OutboundEmail(
            to_address=to_address or f"{recipient_name}@unresolved.local",
            subject=title,
            body_text=description,
            status="pending",
            letter_id=letter_id,
            notification_type=notification_type,
        )
        db.add(row)
        db.flush()

        if not settings.mail_enabled or not (settings.smtp_host or "").strip():
            row.status = "skipped"
            row.error_message = "MAIL_ENABLED false or SMTP_HOST empty"
            return

        if not to_address:
            row.status = "skipped"
            row.error_message = "No email address on user"
            return

        try:
            msg = EmailMessage()
            msg["Subject"] = title
            msg["From"] = settings.smtp_from or settings.smtp_user or "noreply@ailms.local"
            msg["To"] = to_address
            msg.set_content(description)
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30) as smtp:
                if settings.smtp_tls:
                    smtp.starttls()
                if settings.smtp_user:
                    smtp.login(settings.smtp_user, settings.smtp_password)
                smtp.send_message(msg)
            row.status = "sent"
            row.sent_at = datetime.utcnow()
        except Exception as exc:  # noqa: BLE001
            logger.exception("Email send failed")
            row.status = "failed"
            row.error_message = str(exc)[:500]


class NotificationDispatcher:
    def __init__(self) -> None:
        self.in_app = InAppChannel()
        self.email = EmailChannel()

    def notify(
        self,
        db: Session,
        *,
        recipient_name: str,
        title: str,
        description: str,
        priority: str = "Medium",
        letter_id: int | None = None,
        notification_type: str = "System Notification",
        email: bool = False,
    ) -> None:
        self.in_app.send(
            db,
            recipient_name=recipient_name,
            title=title,
            description=description,
            priority=priority,
            letter_id=letter_id,
            notification_type=notification_type,
        )
        if email:
            self.email.send(
                db,
                recipient_name=recipient_name,
                title=title,
                description=description,
                priority=priority,
                letter_id=letter_id,
                notification_type=notification_type,
            )


def get_dispatcher() -> NotificationDispatcher:
    return NotificationDispatcher()
