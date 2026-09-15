"""Logical archival for correspondence records."""

from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Letter
from app.services import add_audit, current_user_name


def archive_letters(db: Session, letter_ids: list[int], *, actor: str | None = None) -> list[int]:
    actor = actor or current_user_name(db)
    archived: list[int] = []
    for letter_id in letter_ids:
        letter = db.get(Letter, letter_id)
        if not letter:
            continue
        if letter.is_archived:
            continue
        letter.is_archived = True
        letter.archived_at = datetime.now()
        if letter.status not in {"Archived", "Closed"}:
            letter.status = "Archived"
        add_audit(
            db,
            user=actor,
            module="Archive",
            action="Letter Archived",
            record=letter.number,
            description="Letter logically archived",
        )
        archived.append(letter.id)
    db.flush()
    return archived


def restore_letters(db: Session, letter_ids: list[int], *, actor: str | None = None) -> list[int]:
    actor = actor or current_user_name(db)
    restored: list[int] = []
    for letter_id in letter_ids:
        letter = db.get(Letter, letter_id)
        if not letter or not letter.is_archived:
            continue
        letter.is_archived = False
        letter.archived_at = None
        if letter.status == "Archived":
            letter.status = "Closed"
        add_audit(
            db,
            user=actor,
            module="Archive",
            action="Letter Restored",
            record=letter.number,
            description="Letter restored from archive",
        )
        restored.append(letter.id)
    db.flush()
    return restored


def assert_active_letter(letter: Letter) -> None:
    if letter.is_archived:
        raise HTTPException(status_code=400, detail="Archived correspondence cannot be modified")
