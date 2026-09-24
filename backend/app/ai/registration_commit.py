"""Registration commit after human approve (master plan step 12 / spec 08).

Creates the official letter + document attach + optional relations only inside
the approve path — never during OCR/LLM/validation stages.
"""

from __future__ import annotations

import json
import logging
from datetime import date
from typing import Any

from fastapi import HTTPException
from pydantic import ValidationError as PydanticValidationError
from sqlalchemy.orm import Session

from app.ai.job_service import get_registration_job, transition_job
from app.ai.job_states import JobStatus
from app.ai.review_service import assert_job_access
from app.ai.validation_service import check_duplicate_number, strip_html
from app.correspondence_service import create_relation
from app.document_service import DOCUMENT_TYPES, create_document_from_staged_file
from app.letter_create_service import create_letter_record
from app.models import AiStagedDocument, Letter
from app.schemas import LetterCreate
from app.services import add_audit, add_notification

logger = logging.getLogger(__name__)

_APPROVE_STATUSES = frozenset({JobStatus.NEEDS_REVIEW.value, JobStatus.APPROVED.value})


def _parse_proposal(raw: str) -> dict[str, Any]:
    if not raw or not str(raw).strip():
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _as_str(value: Any) -> str:
    if value is None:
        return ""
    return strip_html(str(value)).strip()


def _as_date_str(value: Any) -> str | None:
    text = _as_str(value)
    return text or None


def _merge_remarks(proposal: dict[str, Any]) -> str:
    remarks = _as_str(proposal.get("remarks"))
    summary = _as_str(proposal.get("summary"))
    if summary and remarks:
        return f"{remarks}\n\nSummary: {summary}"[:4000]
    if summary:
        return f"Summary: {summary}"[:4000]
    return remarks[:4000]


def build_letter_create_from_proposal(proposal: dict[str, Any]) -> LetterCreate:
    """Map AI/human proposal (camelCase) onto LetterCreate."""
    number = _as_str(proposal.get("number"))
    subject = _as_str(proposal.get("subject"))
    letter_date = _as_date_str(proposal.get("letterDate"))
    if not number or not subject or not letter_date:
        raise HTTPException(
            status_code=422,
            detail="Letter number, letter date, and subject are required to approve",
        )

    payload = {
        "number": number[:80],
        "letterDate": letter_date,
        "receivedDate": _as_date_str(proposal.get("receivedDate")),
        "type": _as_str(proposal.get("type")) or "Incoming",
        "subject": subject[:400],
        "from": _as_str(proposal.get("from"))[:180],
        "to": _as_str(proposal.get("to"))[:180],
        "department": _as_str(proposal.get("department"))[:120],
        "priority": _as_str(proposal.get("priority")) or "Routine",
        "status": _as_str(proposal.get("status")) or "Registered",
        "dueDate": _as_date_str(proposal.get("dueDate")),
        "assignedTo": _as_str(proposal.get("assignedTo"))[:120],
        "lastAction": _as_str(proposal.get("lastAction")) or "Registered",
        "confidentiality": _as_str(proposal.get("confidentiality")) or "Normal",
        "actionRequired": _as_str(proposal.get("actionRequired"))[:200],
        "remarks": _merge_remarks(proposal),
    }
    try:
        return LetterCreate.model_validate(payload)
    except PydanticValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Proposal failed letter validation: {exc.errors()[0].get('msg', 'invalid')}",
        ) from exc


def assert_proposal_ready_for_registration(db: Session, proposal: dict[str, Any]) -> LetterCreate:
    """Re-validate proposal before commit (duplicate number → 409; other failures → 422)."""
    letter_payload = build_letter_create_from_proposal(proposal)

    if check_duplicate_number(db, letter_payload.number):
        raise HTTPException(
            status_code=409,
            detail=f"Letter number already exists: {letter_payload.number}",
        )

    # Soft checks mirrored from validation stage for type/priority/date sanity.
    if not letter_payload.letterDate or not isinstance(letter_payload.letterDate, date):
        raise HTTPException(status_code=422, detail="Letter date is invalid")

    return letter_payload


def _related_numbers(proposal: dict[str, Any]) -> list[str]:
    raw = proposal.get("relatedLetterNumbers")
    if isinstance(raw, list):
        out: list[str] = []
        for item in raw[:20]:
            text = _as_str(item)[:80]
            if text:
                out.append(text)
        return out
    text = _as_str(raw)[:80]
    return [text] if text else []


def _document_type_from_proposal(proposal: dict[str, Any]) -> str:
    cat = _as_str(proposal.get("documentCategory"))
    if cat in DOCUMENT_TYPES:
        return cat
    # Case-insensitive match
    lookup = {name.casefold(): name for name in DOCUMENT_TYPES}
    return lookup.get(cat.casefold(), "Original Letter")


def _link_related_letters(
    db: Session,
    *,
    letter: Letter,
    numbers: list[str],
    actor: str,
) -> list[str]:
    """Create Reference relations for resolved numbers; return skip warnings."""
    warnings: list[str] = []
    for number in numbers:
        other = db.query(Letter).filter(Letter.number == number).one_or_none()
        if other is None:
            warnings.append(f"Related letter not found: {number}")
            continue
        if other.id == letter.id:
            continue
        try:
            create_relation(
                db,
                from_letter_id=letter.id,
                to_letter_id=other.id,
                relationship_type="Reference",
                remarks="Linked during AI registration",
                actor=actor,
            )
        except HTTPException as exc:
            if exc.status_code == 409:
                continue
            warnings.append(f"Could not link {number}: {exc.detail}")
    return warnings


def approve_registration_job(
    db: Session,
    *,
    job_id: int,
    confirm: bool = True,
    actor: str | None = None,
) -> dict[str, Any]:
    """
    Atomically register letter from approved proposal (spec 08).

    Caller must commit the session. On any raised error the transaction should roll back
    so the job remains NEEDS_REVIEW / APPROVED without a letter.
    """
    if not confirm:
        raise HTTPException(status_code=422, detail="Approval requires confirm=true")

    job = get_registration_job(db, job_id)
    actor = assert_job_access(db, job, actor=actor)

    if job.status not in _APPROVE_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Job cannot be approved in status {job.status}",
        )

    if job.letter_id is not None:
        raise HTTPException(status_code=409, detail="Job already has a registered letter")

    proposal = _parse_proposal(job.proposal_json or "")
    if not proposal:
        raise HTTPException(status_code=422, detail="Job has no proposal to register")

    letter_payload = assert_proposal_ready_for_registration(db, proposal)

    staged = (
        db.query(AiStagedDocument)
        .filter(AiStagedDocument.id == job.staged_document_id)
        .one_or_none()
    )
    if staged is None:
        raise HTTPException(status_code=404, detail="Staged document not found")

    # Intermediate APPROVED (optional in diagram; required by state machine).
    if job.status == JobStatus.NEEDS_REVIEW.value:
        transition_job(db, job, new_status=JobStatus.APPROVED)
    job.approved_by = actor
    job.reviewed_by = job.reviewed_by or actor

    letter = create_letter_record(db, letter_payload, actor=actor)

    create_document_from_staged_file(
        db,
        letter_id=letter.id,
        document_type=_document_type_from_proposal(proposal),
        original_filename=staged.original_filename,
        mime_type=staged.mime_type,
        file_size=staged.file_size,
        checksum=staged.checksum,
        source_storage_key=staged.storage_key,
        change_description="Letter copy from AI registration staging",
        actor=actor,
    )

    warnings = _link_related_letters(
        db,
        letter=letter,
        numbers=_related_numbers(proposal),
        actor=actor,
    )
    for warning in warnings:
        add_notification(
            db,
            title="AI Registration Warning",
            description=warning,
            priority="Medium",
            letter_id=letter.id,
            notification_type="AI Registration Warning",
            related_entity_type="letter",
            related_entity_id=str(letter.id),
        )

    job.letter_id = letter.id
    transition_job(db, job, new_status=JobStatus.REGISTERED)

    add_audit(
        db,
        user=actor,
        module="AI Registration",
        action="Letter Registered via AI",
        record=letter.number,
        description=f"Job {job.id} → letter {letter.id}",
    )
    db.flush()

    logger.info(
        "AI registration approved job_id=%s letter_id=%s number=%s",
        job.id,
        letter.id,
        letter.number,
    )
    return {
        "letterId": str(letter.id),
        "number": letter.number,
        "jobId": str(job.id),
        "status": JobStatus.REGISTERED.value,
        "warnings": warnings,
    }
