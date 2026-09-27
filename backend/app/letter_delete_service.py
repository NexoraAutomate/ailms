"""Administrator-only letter deletion with a confirmation code and cascade cleanup."""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models import (
    AiRegistrationJob,
    Approval,
    Document,
    DocumentVersion,
    Escalation,
    Letter,
    LetterAction,
    LetterMeetingLink,
    LetterRelation,
    Notification,
    ReminderLog,
    WorkflowTransition,
)
from app.services import add_audit, current_user_name, resolve_user_role
from app.storage_service import resolve_storage_path

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 6
CHALLENGE_TTL_SECONDS = 300
MAX_ATTEMPTS = 5


@dataclass
class DeleteChallenge:
    code: str
    letter_ids: tuple[int, ...]
    expires_at: float
    attempts: int = 0


_challenges: dict[str, DeleteChallenge] = {}


def is_administrator(role: str) -> bool:
    return role.strip().lower() in {"administrator", "admin"}


def _require_admin(db: Session) -> str:
    actor = current_user_name(db)
    role = resolve_user_role(db, actor)
    if not is_administrator(role):
        raise HTTPException(status_code=403, detail="Only an administrator can delete letters")
    return actor


def _normalize_ids(letter_ids: list[int]) -> tuple[int, ...]:
    unique: list[int] = []
    seen: set[int] = set()
    for letter_id in letter_ids:
        if letter_id in seen:
            continue
        seen.add(letter_id)
        unique.append(letter_id)
    if not unique:
        raise HTTPException(status_code=422, detail="Select at least one letter to delete")
    return tuple(unique)


def _purge_expired() -> None:
    now = time.time()
    expired = [actor for actor, challenge in _challenges.items() if challenge.expires_at <= now]
    for actor in expired:
        _challenges.pop(actor, None)


def issue_delete_challenge(db: Session, letter_ids: list[int]) -> tuple[str, tuple[int, ...], int]:
    actor = _require_admin(db)
    ids = _normalize_ids(letter_ids)
    _load_letters(db, ids)
    _purge_expired()
    code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
    _challenges[actor] = DeleteChallenge(
        code=code,
        letter_ids=ids,
        expires_at=time.time() + CHALLENGE_TTL_SECONDS,
    )
    return code, ids, CHALLENGE_TTL_SECONDS


def _consume_challenge(actor: str, letter_ids: tuple[int, ...], confirmation_code: str) -> None:
    _purge_expired()
    challenge = _challenges.get(actor)
    supplied = confirmation_code.strip().upper().replace(" ", "")
    if not challenge or challenge.letter_ids != letter_ids:
        raise HTTPException(status_code=400, detail="Request a new confirmation code for these letters")
    if supplied != challenge.code:
        challenge.attempts += 1
        if challenge.attempts >= MAX_ATTEMPTS:
            _challenges.pop(actor, None)
            raise HTTPException(status_code=400, detail="Confirmation code locked. Request a new code.")
        raise HTTPException(status_code=400, detail="Confirmation code does not match")
    _challenges.pop(actor, None)


def _load_letters(db: Session, letter_ids: tuple[int, ...]) -> list[Letter]:
    letters = db.query(Letter).filter(Letter.id.in_(letter_ids)).all()
    found = {letter.id for letter in letters}
    missing = [letter_id for letter_id in letter_ids if letter_id not in found]
    if missing:
        raise HTTPException(status_code=404, detail=f"Letter not found: {missing[0]}")
    return letters


def _storage_keys(db: Session, letter_ids: tuple[int, ...]) -> list[str]:
    doc_ids = [row[0] for row in db.query(Document.id).filter(Document.letter_id.in_(letter_ids)).all()]
    if not doc_ids:
        return []
    versions = db.query(DocumentVersion.storage_key).filter(DocumentVersion.document_id.in_(doc_ids)).all()
    return [row[0] for row in versions if row[0]]


def _cascade_delete(db: Session, letter_ids: tuple[int, ...]) -> None:
    doc_ids = [row[0] for row in db.query(Document.id).filter(Document.letter_id.in_(letter_ids)).all()]
    if doc_ids:
        db.query(Approval).filter(Approval.document_id.in_(doc_ids)).update(
            {Approval.document_id: None},
            synchronize_session=False,
        )
        db.query(DocumentVersion).filter(DocumentVersion.document_id.in_(doc_ids)).update(
            {DocumentVersion.parent_version_id: None},
            synchronize_session=False,
        )
        db.query(DocumentVersion).filter(DocumentVersion.document_id.in_(doc_ids)).delete(synchronize_session=False)
        db.query(Document).filter(Document.id.in_(doc_ids)).delete(synchronize_session=False)

    db.query(Escalation).filter(Escalation.letter_id.in_(letter_ids)).delete(synchronize_session=False)
    db.query(Approval).filter(Approval.letter_id.in_(letter_ids)).delete(synchronize_session=False)
    db.query(ReminderLog).filter(ReminderLog.letter_id.in_(letter_ids)).delete(synchronize_session=False)
    db.query(LetterMeetingLink).filter(LetterMeetingLink.letter_id.in_(letter_ids)).delete(synchronize_session=False)
    db.query(LetterRelation).filter(
        or_(LetterRelation.from_letter_id.in_(letter_ids), LetterRelation.to_letter_id.in_(letter_ids))
    ).delete(synchronize_session=False)
    db.query(WorkflowTransition).filter(WorkflowTransition.letter_id.in_(letter_ids)).delete(synchronize_session=False)
    db.query(LetterAction).filter(LetterAction.letter_id.in_(letter_ids)).delete(synchronize_session=False)
    db.query(Notification).filter(Notification.letter_id.in_(letter_ids)).update(
        {Notification.letter_id: None},
        synchronize_session=False,
    )
    db.query(AiRegistrationJob).filter(AiRegistrationJob.letter_id.in_(letter_ids)).update(
        {AiRegistrationJob.letter_id: None},
        synchronize_session=False,
    )
    db.query(Letter).filter(Letter.id.in_(letter_ids)).delete(synchronize_session=False)


def delete_letters(db: Session, letter_ids: list[int], confirmation_code: str) -> tuple[list[int], list[str]]:
    actor = _require_admin(db)
    ids = _normalize_ids(letter_ids)
    if not confirmation_code.strip():
        raise HTTPException(status_code=422, detail="Confirmation code is required")
    _consume_challenge(actor, ids, confirmation_code)
    letters = _load_letters(db, ids)
    storage_keys = _storage_keys(db, ids)
    for letter in letters:
        add_audit(
            db,
            user=actor,
            module="Letters",
            action="Letter Deleted",
            record=letter.number,
            description="Letter and related records deleted",
        )
    _cascade_delete(db, ids)
    db.flush()
    return [letter.id for letter in letters], storage_keys


def remove_letter_files(storage_keys: list[str]) -> None:
    for key in storage_keys:
        if not key or key == "pending":
            continue
        try:
            path = resolve_storage_path(key)
        except HTTPException:
            continue
        if path.is_file():
            path.unlink(missing_ok=True)
