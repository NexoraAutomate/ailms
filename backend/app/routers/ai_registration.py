"""AI-assisted letter registration API (staged upload, jobs, review)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.ai.ingestion_service import serialize_staged_document, stage_document_upload
from app.ai.job_service import (
    create_registration_job,
    get_registration_job,
    retry_registration_job,
    serialize_job,
    serialize_job_create,
)
from app.ai.extraction_service import load_extraction_artifact
from app.ai.ocr_normalize import load_normalized_artifact
from app.ai.ocr_service import load_ocr_artifact
from app.ai.validation_service import load_validation_artifact
from app.config import get_settings
from app.database import get_db
from app.schemas import (
    AiRegistrationJobCreateIn,
    AiRegistrationJobCreateOut,
    AiRegistrationJobOut,
    StagedDocumentOut,
)

router = APIRouter(prefix="/ai-registration", tags=["ai-registration"])


def require_ai_registration_enabled() -> None:
    if not get_settings().ai_registration_enabled:
        raise HTTPException(status_code=404, detail="AI registration is disabled")


@router.post(
    "/staged-documents",
    response_model=StagedDocumentOut,
    status_code=201,
    dependencies=[Depends(require_ai_registration_enabled)],
)
async def create_staged_document(
    file: UploadFile = File(...),
    source: str | None = Form(default=None),
    db: Session = Depends(get_db),
) -> StagedDocumentOut:
    """Upload a PDF/image for AI registration without creating a letter."""
    row = await stage_document_upload(db, upload=file, source=source)
    db.commit()
    db.refresh(row)
    return StagedDocumentOut(**serialize_staged_document(row))


@router.post(
    "/jobs",
    response_model=AiRegistrationJobCreateOut,
    status_code=201,
    dependencies=[Depends(require_ai_registration_enabled)],
)
def create_job(
    body: AiRegistrationJobCreateIn,
    db: Session = Depends(get_db),
) -> AiRegistrationJobCreateOut:
    """Enqueue AI registration for a staged document (status=QUEUED)."""
    try:
        staged_id = int(str(body.staged_document_id).strip())
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="stagedDocumentId must be an integer") from exc

    row = create_registration_job(db, staged_document_id=staged_id)
    db.commit()
    db.refresh(row)
    return AiRegistrationJobCreateOut(**serialize_job_create(row))


@router.get(
    "/jobs/{job_id}",
    response_model=AiRegistrationJobOut,
    dependencies=[Depends(require_ai_registration_enabled)],
)
def get_job(job_id: int, db: Session = Depends(get_db)) -> AiRegistrationJobOut:
    """Return job status, progress hint, and proposal when ready."""
    row = get_registration_job(db, job_id)
    return AiRegistrationJobOut(**serialize_job(row))


@router.post(
    "/jobs/{job_id}/retry",
    response_model=AiRegistrationJobOut,
    dependencies=[Depends(require_ai_registration_enabled)],
)
def retry_job(job_id: int, db: Session = Depends(get_db)) -> AiRegistrationJobOut:
    """Re-queue a FAILED or REJECTED job."""
    row = retry_registration_job(db, job_id=job_id)
    db.commit()
    db.refresh(row)
    return AiRegistrationJobOut(**serialize_job(row))


@router.get(
    "/jobs/{job_id}/artifacts/ocr",
    dependencies=[Depends(require_ai_registration_enabled)],
)
def get_ocr_artifact(job_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Return raw OCR JSON when ready (404 if missing)."""
    row = get_registration_job(db, job_id)
    if not row.ocr_artifact_key:
        raise HTTPException(status_code=404, detail="OCR artifact not ready")
    artifact = load_ocr_artifact(row.ocr_artifact_key)
    if artifact is None:
        raise HTTPException(status_code=404, detail="OCR artifact file missing")
    return artifact


@router.get(
    "/jobs/{job_id}/artifacts/normalized",
    dependencies=[Depends(require_ai_registration_enabled)],
)
def get_normalized_artifact(job_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Return llm-input.json when ready (404 if missing)."""
    row = get_registration_job(db, job_id)
    if not row.normalized_artifact_key:
        raise HTTPException(status_code=404, detail="Normalized artifact not ready")
    artifact = load_normalized_artifact(row.normalized_artifact_key)
    if artifact is None:
        raise HTTPException(status_code=404, detail="Normalized artifact file missing")
    return artifact


@router.get(
    "/jobs/{job_id}/artifacts/extraction",
    dependencies=[Depends(require_ai_registration_enabled)],
)
def get_extraction_artifact(job_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Return extraction-result.json when ready (404 if missing)."""
    row = get_registration_job(db, job_id)
    if not row.extraction_artifact_key:
        raise HTTPException(status_code=404, detail="Extraction artifact not ready")
    artifact = load_extraction_artifact(row.extraction_artifact_key)
    if artifact is None:
        raise HTTPException(status_code=404, detail="Extraction artifact file missing")
    return artifact


@router.get(
    "/jobs/{job_id}/artifacts/validation",
    dependencies=[Depends(require_ai_registration_enabled)],
)
def get_validation_artifact(job_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Return validation-result.json when ready (404 if missing)."""
    row = get_registration_job(db, job_id)
    if not row.validation_artifact_key:
        raise HTTPException(status_code=404, detail="Validation artifact not ready")
    artifact = load_validation_artifact(row.validation_artifact_key)
    if artifact is None:
        raise HTTPException(status_code=404, detail="Validation artifact file missing")
    return artifact
