"""Create / read / retry AI registration jobs (master plan step 4)."""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.ai.job_states import JobStatus, assert_transition, current_stage, is_retryable
from app.config import get_settings
from app.models import AiRegistrationJob, AiStagedDocument
from app.services import add_audit, current_user_name

logger = logging.getLogger(__name__)


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    text = dt.isoformat()
    if text and not text.endswith("Z") and "+" not in text:
        return f"{text}Z" if "T" in text else text
    return text


def _proposal_payload(raw: str) -> dict | list | None:
    if not raw or not raw.strip():
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def serialize_job(row: AiRegistrationJob) -> dict:
    settings = get_settings()
    return {
        "jobId": str(row.id),
        "status": row.status,
        "stagedDocumentId": str(row.staged_document_id),
        "letterId": str(row.letter_id) if row.letter_id is not None else None,
        "currentStage": current_stage(row.status),
        "errorCode": row.error_code or None,
        "errorMessage": row.error_message or None,
        "proposal": _proposal_payload(row.proposal_json or ""),
        "workerEnabled": bool(settings.ai_registration_worker_enabled),
        "createdAt": _iso(row.created_at) or "",
        "updatedAt": _iso(row.updated_at),
        "startedAt": _iso(row.started_at),
        "ocrCompletedAt": _iso(row.ocr_completed_at),
        "extractionCompletedAt": _iso(row.extraction_completed_at),
        "reviewReadyAt": _iso(row.review_ready_at),
        "completedAt": _iso(row.completed_at),
    }


def serialize_job_create(row: AiRegistrationJob) -> dict:
    return {
        "jobId": str(row.id),
        "status": row.status,
        "stagedDocumentId": str(row.staged_document_id),
    }


def create_registration_job(
    db: Session,
    *,
    staged_document_id: int,
    actor: str | None = None,
) -> AiRegistrationJob:
    """Enqueue a new job in QUEUED. Does not run OCR/LLM in this request."""
    staged = (
        db.query(AiStagedDocument)
        .filter(AiStagedDocument.id == staged_document_id)
        .one_or_none()
    )
    if staged is None:
        raise HTTPException(status_code=404, detail="Staged document not found")

    actor = actor or current_user_name(db)
    row = AiRegistrationJob(
        staged_document_id=staged.id,
        status=JobStatus.QUEUED.value,
        created_by=actor,
        error_code="",
        error_message="",
        proposal_json="",
    )
    db.add(row)
    db.flush()

    add_audit(
        db,
        user=actor,
        module="AI Registration",
        action="Job Created",
        record=str(row.id),
        description=f"Job QUEUED for staged document {staged.id}",
    )
    db.flush()

    logger.info(
        "AI registration job created id=%s staged_document_id=%s status=%s",
        row.id,
        staged.id,
        row.status,
    )
    return row


def get_registration_job(db: Session, job_id: int) -> AiRegistrationJob:
    row = db.query(AiRegistrationJob).filter(AiRegistrationJob.id == job_id).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return row


def transition_job(
    db: Session,
    row: AiRegistrationJob,
    *,
    new_status: JobStatus | str,
    error_code: str = "",
    error_message: str = "",
) -> AiRegistrationJob:
    """Apply a validated status transition and touch lifecycle timestamps."""
    target = JobStatus(new_status) if isinstance(new_status, str) else new_status
    assert_transition(row.status, target)

    now = datetime.now(UTC).replace(tzinfo=None)
    row.status = target.value
    row.updated_at = now

    if target == JobStatus.PROCESSING and row.started_at is None:
        row.started_at = now
    elif target == JobStatus.OCR_COMPLETE:
        row.ocr_completed_at = now
    elif target == JobStatus.EXTRACTION_COMPLETE:
        row.extraction_completed_at = now
    elif target == JobStatus.NEEDS_REVIEW:
        row.review_ready_at = now
    elif target == JobStatus.APPROVED:
        row.approved_at = now
    elif target in {JobStatus.REGISTERED, JobStatus.FAILED, JobStatus.REJECTED}:
        row.completed_at = now

    if target == JobStatus.FAILED:
        row.error_code = error_code or row.error_code or "PROCESSING_FAILED"
        row.error_message = error_message or row.error_message or "Job failed"
    elif target == JobStatus.QUEUED:
        row.error_code = ""
        row.error_message = ""
        row.started_at = None
        row.ocr_completed_at = None
        row.extraction_completed_at = None
        row.review_ready_at = None
        row.approved_at = None
        row.completed_at = None

    db.flush()
    return row


def retry_registration_job(
    db: Session,
    *,
    job_id: int,
    actor: str | None = None,
) -> AiRegistrationJob:
    """Re-queue a FAILED or REJECTED job (spec 10)."""
    row = get_registration_job(db, job_id)
    if not is_retryable(row.status):
        raise HTTPException(
            status_code=409,
            detail=f"Only FAILED or REJECTED jobs can be retried (current={row.status})",
        )

    actor = actor or current_user_name(db)
    transition_job(db, row, new_status=JobStatus.QUEUED)

    add_audit(
        db,
        user=actor,
        module="AI Registration",
        action="Job Retried",
        record=str(row.id),
        description=f"Job re-queued from prior failure/rejection",
    )
    db.flush()
    logger.info("AI registration job retried id=%s → QUEUED", row.id)
    return row
