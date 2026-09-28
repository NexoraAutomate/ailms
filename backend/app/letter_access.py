"""Per-user letter visibility: assigned to / assigned by / created by."""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Letter, User


def is_administrator(role: str | None) -> bool:
    normalized = (role or "").strip().lower()
    return normalized in {"administrator", "admin"}


def resolve_user_role(db: Session, user_name: str) -> str:
    row = db.query(User).filter(User.name == user_name).one_or_none()
    if row:
        return row.role
    return "Department/User"


def letter_meant_for_user(letter: Letter, user_name: str) -> bool:
    """True when the letter is marked to, marked by, or created by the user."""
    name = (user_name or "").strip()
    if not name:
        return False
    if (letter.assigned_to or "").strip() == name:
        return True
    if (getattr(letter, "created_by", "") or "").strip() == name:
        return True
    if (getattr(letter, "assigned_by", "") or "").strip() == name:
        return True
    return False


def user_can_access_letter(db: Session, letter: Letter, user_name: str, role: str | None = None) -> bool:
    resolved_role = role if role is not None else resolve_user_role(db, user_name)
    if is_administrator(resolved_role):
        return True
    return letter_meant_for_user(letter, user_name)


def assert_letter_access(db: Session, letter: Letter, user_name: str, role: str | None = None) -> None:
    if user_can_access_letter(db, letter, user_name, role):
        return
    raise HTTPException(status_code=403, detail="You do not have access to this letter")


def owned_letter_filter(user_name: str):
    """SQLAlchemy filter for Track / bootstrap scoping."""
    from sqlalchemy import or_

    name = (user_name or "").strip()
    return or_(
        Letter.assigned_to == name,
        Letter.created_by == name,
        Letter.assigned_by == name,
    )
