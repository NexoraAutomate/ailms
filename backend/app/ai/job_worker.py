"""AI registration background worker (master plan step 9 / spec 10).

Daemon thread polls for QUEUED jobs, claims one with SKIP LOCKED (PostgreSQL),
and runs OCR → normalize → extract → validate → NEEDS_REVIEW without blocking
the HTTP upload/create-job path.
"""

from __future__ import annotations

import logging
import threading
from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.ai.extraction_service import run_extraction_stage
from app.ai.job_service import transition_job
from app.ai.job_states import JobStatus
from app.ai.ocr_normalize import run_normalize_stage
from app.ai.ocr_service import run_ocr_stage
from app.ai.validation_service import run_validation_stage
from app.config import get_settings
from app.database import SessionLocal
from app.models import AiRegistrationJob

logger = logging.getLogger("ailms.ai_registration")

_stop = threading.Event()
_thread: threading.Thread | None = None

_TERMINAL_OR_REVIEW = frozenset(
    {
        JobStatus.NEEDS_REVIEW.value,
        JobStatus.FAILED.value,
        JobStatus.REJECTED.value,
        JobStatus.APPROVED.value,
        JobStatus.REGISTERED.value,
    }
)


def claim_next_queued_job(db: Session) -> AiRegistrationJob | None:
    """
    Claim one QUEUED job using SKIP LOCKED when available (PostgreSQL).
    Falls back to a simple SELECT + update for engines without that syntax.
    """
    dialect = db.get_bind().dialect.name
    if dialect == "postgresql":
        result = db.execute(
            text(
                """
                SELECT id FROM cms_ai_registration_jobs
                WHERE status = 'QUEUED'
                ORDER BY id
                LIMIT 1
                FOR UPDATE SKIP LOCKED
                """
            )
        )
        row_id = result.scalar()
        if row_id is None:
            return None
        job = db.query(AiRegistrationJob).filter(AiRegistrationJob.id == row_id).one()
    else:
        job = (
            db.query(AiRegistrationJob)
            .filter(AiRegistrationJob.status == JobStatus.QUEUED.value)
            .order_by(AiRegistrationJob.id.asc())
            .with_for_update()
            .first()
        )
        if job is None:
            return None

    transition_job(db, job, new_status=JobStatus.PROCESSING)
    return job


def process_one_job(db: Session, job: AiRegistrationJob) -> None:
    """
    Run pipeline stages for a claimed job.

    OCR → normalize → extract → validate → NEEDS_REVIEW (or FAILED).
    """
    run_ocr_stage(db, job)
    if job.status in _TERMINAL_OR_REVIEW:
        if job.status == JobStatus.NEEDS_REVIEW.value:
            logger.info("AI job %s → NEEDS_REVIEW", job.id)
        return

    if job.status == JobStatus.OCR_COMPLETE.value:
        run_normalize_stage(db, job)
    if job.status in _TERMINAL_OR_REVIEW:
        return

    if job.status == JobStatus.OCR_COMPLETE.value and job.normalized_artifact_key:
        run_extraction_stage(db, job)
    if job.status in _TERMINAL_OR_REVIEW:
        return

    if job.status == JobStatus.EXTRACTION_COMPLETE.value:
        run_validation_stage(db, job)

    if job.status == JobStatus.NEEDS_REVIEW.value:
        logger.info("AI job %s → NEEDS_REVIEW", job.id)


def _fail_job_after_crash(db: Session, job_id: int, exc: BaseException) -> AiRegistrationJob | None:
    """Mark a claimed job FAILED after an unexpected worker exception."""
    job = db.query(AiRegistrationJob).filter(AiRegistrationJob.id == job_id).one_or_none()
    if job is None:
        return None
    if job.status in _TERMINAL_OR_REVIEW:
        return job
    try:
        transition_job(
            db,
            job,
            new_status=JobStatus.FAILED,
            error_code="WORKER_CRASH",
            error_message=str(exc)[:2000] or type(exc).__name__,
        )
    except ValueError:
        now = datetime.now(UTC).replace(tzinfo=None)
        job.status = JobStatus.FAILED.value
        job.error_code = "WORKER_CRASH"
        job.error_message = str(exc)[:2000] or type(exc).__name__
        job.completed_at = now
        job.updated_at = now
        db.flush()
    return job


def run_ocr_for_job_id(db: Session, job_id: int) -> AiRegistrationJob:
    """Explicit OCR stage for CLI / tests (does not require worker claim)."""
    job = db.query(AiRegistrationJob).filter(AiRegistrationJob.id == job_id).one_or_none()
    if job is None:
        raise ValueError(f"Job not found: {job_id}")
    return run_ocr_stage(db, job)


def run_normalize_for_job_id(db: Session, job_id: int) -> AiRegistrationJob:
    """Explicit normalize stage for CLI / tests."""
    job = db.query(AiRegistrationJob).filter(AiRegistrationJob.id == job_id).one_or_none()
    if job is None:
        raise ValueError(f"Job not found: {job_id}")
    return run_normalize_stage(db, job)


def run_extraction_for_job_id(db: Session, job_id: int) -> AiRegistrationJob:
    """Explicit extraction stage for CLI / tests."""
    job = db.query(AiRegistrationJob).filter(AiRegistrationJob.id == job_id).one_or_none()
    if job is None:
        raise ValueError(f"Job not found: {job_id}")
    return run_extraction_stage(db, job)


def run_validation_for_job_id(db: Session, job_id: int) -> AiRegistrationJob:
    """Explicit validation stage for CLI / tests."""
    job = db.query(AiRegistrationJob).filter(AiRegistrationJob.id == job_id).one_or_none()
    if job is None:
        raise ValueError(f"Job not found: {job_id}")
    return run_validation_stage(db, job)


def run_pipeline_for_job_id(db: Session, job_id: int) -> AiRegistrationJob:
    """Run the full async pipeline stages for one job (CLI / tests)."""
    job = db.query(AiRegistrationJob).filter(AiRegistrationJob.id == job_id).one_or_none()
    if job is None:
        raise ValueError(f"Job not found: {job_id}")
    if job.status == JobStatus.QUEUED.value:
        transition_job(db, job, new_status=JobStatus.PROCESSING)
    process_one_job(db, job)
    return job


def run_ai_registration_cycle() -> dict:
    """Process at most one QUEUED job. Returns stats for logging."""
    settings = get_settings()
    if not settings.ai_registration_enabled or not settings.ai_registration_worker_enabled:
        return {"claimed": 0, "skipped": "worker_disabled"}

    db = SessionLocal()
    job_id: int | None = None
    try:
        job = claim_next_queued_job(db)
        if job is None:
            db.commit()
            return {"claimed": 0}

        job_id = job.id
        # Persist PROCESSING before long OCR/LLM work so concurrent workers
        # skip this row and a soft crash can still mark FAILED below.
        db.commit()

        try:
            process_one_job(db, job)
            db.commit()
        except Exception as exc:
            logger.exception("AI registration pipeline crashed job_id=%s", job_id)
            db.rollback()
            failed = _fail_job_after_crash(db, job_id, exc)
            db.commit()
            status = failed.status if failed is not None else JobStatus.FAILED.value
            return {"claimed": 1, "jobId": job_id, "status": status, "error": "WORKER_CRASH"}

        logger.info("AI job %s → %s", job.id, job.status)
        return {"claimed": 1, "jobId": job.id, "status": job.status}
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _loop(interval_seconds: float) -> None:
    while not _stop.is_set():
        try:
            stats = run_ai_registration_cycle()
            if stats.get("claimed"):
                logger.info("AI registration cycle: %s", stats)
        except Exception:
            logger.exception("AI registration cycle failed")
        _stop.wait(interval_seconds)


def start_ai_registration_worker(interval_seconds: float | None = None) -> None:
    """Start daemon thread when feature + worker flags are enabled."""
    global _thread
    settings = get_settings()
    if not settings.ai_registration_enabled:
        logger.info("AI registration disabled — worker not started")
        return
    if not settings.ai_registration_worker_enabled:
        logger.info("AI registration worker disabled (jobs remain QUEUED)")
        return
    if _thread and _thread.is_alive():
        return

    poll = (
        interval_seconds
        if interval_seconds is not None
        else settings.ai_registration_worker_poll_seconds
    )
    _stop.clear()
    _thread = threading.Thread(
        target=_loop,
        args=(poll,),
        name="ai-registration-worker",
        daemon=True,
    )
    _thread.start()
    logger.info("AI registration worker started (poll=%ss)", poll)


def stop_ai_registration_worker() -> None:
    _stop.set()
