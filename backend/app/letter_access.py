"""Per-user letter visibility: assignee, creator, RouteStep, ActionItem, dept managers."""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import ActionItem, Letter, RouteStep, User


def is_administrator(role: str | None) -> bool:
    normalized = (role or "").strip().lower()
    return normalized in {"administrator", "admin"}


def resolve_user_role(db: Session, user_name: str) -> str:
    from app.services import normalize_role

    row = db.query(User).filter(User.name == user_name).one_or_none()
    if row:
        return normalize_role(row.role)
    return "Actionist"


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


def user_on_route_or_action(db: Session, letter_id: int, user_name: str) -> bool:
    if (
        db.query(ActionItem.id)
        .filter(ActionItem.letter_id == letter_id, ActionItem.assignee == user_name)
        .first()
    ):
        return True
    if (
        db.query(RouteStep.id)
        .filter(RouteStep.letter_id == letter_id, RouteStep.to_user == user_name)
        .first()
    ):
        return True
    return False


def user_can_access_letter(db: Session, letter: Letter, user_name: str, role: str | None = None) -> bool:
    from app.services import normalize_role

    resolved_role = normalize_role(role if role is not None else resolve_user_role(db, user_name))
    if is_administrator(resolved_role):
        return True
    if resolved_role == "Management":
        return True
    if resolved_role in {"Coordinator", "Manager"}:
        if letter_meant_for_user(letter, user_name):
            return True
        user = db.query(User).filter(User.name == user_name).one_or_none()
        if user and user.department and letter.department == user.department:
            return True
    if letter_meant_for_user(letter, user_name):
        return True
    if user_on_route_or_action(db, letter.id, user_name):
        return True
    return False


def assert_letter_access(db: Session, letter: Letter, user_name: str, role: str | None = None) -> None:
    if user_can_access_letter(db, letter, user_name, role):
        return
    raise HTTPException(status_code=403, detail="You do not have access to this letter")


def owned_letter_filter(user_name: str):
    """SQLAlchemy filter for Track / bootstrap scoping (includes RouteStep / ActionItem)."""
    name = (user_name or "").strip()
    return or_(
        Letter.assigned_to == name,
        Letter.created_by == name,
        Letter.assigned_by == name,
        Letter.id.in_(select(ActionItem.letter_id).where(ActionItem.assignee == name)),
        Letter.id.in_(select(RouteStep.letter_id).where(RouteStep.to_user == name)),
    )
