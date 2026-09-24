"""AI registration background worker scaffold (full pipeline in step 9).

Step 4 starts the poll loop when AI_REGISTRATION_WORKER_ENABLED=true but does
not claim QUEUED jobs yet — OCR/LLM/validation wiring lands in later steps.
"""

from __future__ import annotations

import logging
import threading
from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.ai.job_states import JobStatus
from app.config import get_settings
from app.database import SessionLocal
from app.models import AiRegistrationJob

logger = logging.getLogger("ailms.ai_registration")

_stop = threading.Event()
_thread: threading.Thread | None = None

# Flip to True in step 9 when OCR → normalize → extract → validate are wired.
_PIPELINE_READY = False


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

    now = datetime.now(UTC).replace(tzinfo=None)
    job.status = JobStatus.PROCESSING.value
    job.started_at = now
    job.updated_at = now
    db.flush()
    return job


def process_one_job(db: Session, job: AiRegistrationJob) -> None:
    """
    Run the AI registration pipeline for a claimed job.

    Placeholder until steps 5–8 + 9 wire OCR → normalize → extract → validate.
    """
    raise NotImplementedError(
        "AI registration pipeline not implemented yet (expected in step 9)"
    )


def run_ai_registration_cycle() -> dict:
    """Process at most one QUEUED job. Returns stats for logging."""
    settings = get_settings()
    if not settings.ai_registration_enabled or not settings.ai_registration_worker_enabled:
        return {"claimed": 0, "skipped": "worker_disabled"}

    if not _PIPELINE_READY:
        # Keep jobs in QUEUED until the pipeline is wired (step 9).
        return {"claimed": 0, "skipped": "pipeline_not_ready"}

    db = SessionLocal()
    try:
        job = claim_next_queued_job(db)
        if job is None:
            db.commit()
            return {"claimed": 0}
        process_one_job(db, job)
        db.commit()
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
