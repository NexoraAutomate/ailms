"""AI-assisted letter registration API (staged upload, jobs, review)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.ai.ingestion_service import serialize_staged_document, stage_document_upload
from app.ai.job_service import (
    create_registration_job,
    get_registration_job,
    retry_registration_job,
    serialize_job_create,
)
from app.ai.extraction_service import load_extraction_artifact
from app.ai.ocr_normalize import load_normalized_artifact
from app.ai.ocr_service import load_ocr_artifact
from app.ai.review_service import (
    assert_job_access,
    enrich_job_payload,
    get_staged_document_for_preview,
    patch_proposal,
    reject_job,
    request_rerun,
)
from app.ai.registration_commit import approve_registration_job
from app.ai.validation_service import load_validation_artifact
from app.config import get_settings
from app.database import get_db
from app.schemas import (
    AiRegistrationApproveIn,
    AiRegistrationApproveOut,
    AiRegistrationJobCreateIn,
    AiRegistrationJobCreateOut,
    AiRegistrationJobOut,
    AiRegistrationRejectIn,
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


@router.get(
    "/staged-documents/{staged_id}/preview",
    dependencies=[Depends(require_ai_registration_enabled)],
)
def preview_staged_document(staged_id: int, db: Session = Depends(get_db)) -> FileResponse:
    """Inline preview of a staged PDF/image (same ownership rules as jobs)."""
    staged, path = get_staged_document_for_preview(db, staged_id)
    return FileResponse(
        path,
        media_type=staged.mime_type or "application/octet-stream",
        filename=staged.original_filename,
        content_disposition_type="inline",
    )


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
    """Return job status, proposal, validation, and review payload when ready."""
    row = get_registration_job(db, job_id)
    assert_job_access(db, row)
    return AiRegistrationJobOut(**enrich_job_payload(db, row))


@router.patch(
    "/jobs/{job_id}/proposal",
    response_model=AiRegistrationJobOut,
    dependencies=[Depends(require_ai_registration_enabled)],
)
def patch_job_proposal(
    job_id: int,
    body: dict[str, Any],
    db: Session = Depends(get_db),
) -> AiRegistrationJobOut:
    """Apply human field edits to the proposal (NEEDS_REVIEW only; no letter)."""
    row = patch_proposal(db, job_id=job_id, updates=body)
    db.commit()
    db.refresh(row)
    return AiRegistrationJobOut(**enrich_job_payload(db, row))


@router.post(
    "/jobs/{job_id}/reject",
    response_model=AiRegistrationJobOut,
    dependencies=[Depends(require_ai_registration_enabled)],
)
def reject_registration_job(
    job_id: int,
    body: AiRegistrationRejectIn = Body(default_factory=AiRegistrationRejectIn),
    db: Session = Depends(get_db),
) -> AiRegistrationJobOut:
    """Reject a NEEDS_REVIEW job; retain artifacts; no letter created."""
    row = reject_job(db, job_id=job_id, reason=body.reason or "")
    db.commit()
    db.refresh(row)
    return AiRegistrationJobOut(**enrich_job_payload(db, row))


@router.post(
    "/jobs/{job_id}/approve",
    response_model=AiRegistrationApproveOut,
    dependencies=[Depends(require_ai_registration_enabled)],
)
def approve_job(
    job_id: int,
    body: AiRegistrationApproveIn = Body(default_factory=AiRegistrationApproveIn),
    db: Session = Depends(get_db),
) -> AiRegistrationApproveOut:
    """Commit registration: create letter + attach staged document (spec 08)."""
    result = approve_registration_job(db, job_id=job_id, confirm=body.confirm)
    db.commit()
    return AiRegistrationApproveOut(**result)


@router.post(
    "/jobs/{job_id}/rerun",
    response_model=AiRegistrationJobOut,
    dependencies=[Depends(require_ai_registration_enabled)],
)
def rerun_registration_job(job_id: int, db: Session = Depends(get_db)) -> AiRegistrationJobOut:
    """Re-queue a NEEDS_REVIEW job for another analysis pass."""
    row = request_rerun(db, job_id=job_id)
    db.commit()
    db.refresh(row)
    return AiRegistrationJobOut(**enrich_job_payload(db, row))


@router.post(
    "/jobs/{job_id}/retry",
    response_model=AiRegistrationJobOut,
    dependencies=[Depends(require_ai_registration_enabled)],
)
def retry_job(job_id: int, db: Session = Depends(get_db)) -> AiRegistrationJobOut:
    """Re-queue a FAILED or REJECTED job."""
    row = get_registration_job(db, job_id)
    assert_job_access(db, row)
    row = retry_registration_job(db, job_id=job_id)
    db.commit()
    db.refresh(row)
    return AiRegistrationJobOut(**enrich_job_payload(db, row))


@router.get(
    "/jobs/{job_id}/artifacts/ocr",
    dependencies=[Depends(require_ai_registration_enabled)],
)
def get_ocr_artifact(job_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Return raw OCR JSON when ready (404 if missing)."""
    row = get_registration_job(db, job_id)
    assert_job_access(db, row)
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
    assert_job_access(db, row)
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
    assert_job_access(db, row)
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
    assert_job_access(db, row)
    if not row.validation_artifact_key:
        raise HTTPException(status_code=404, detail="Validation artifact not ready")
    artifact = load_validation_artifact(row.validation_artifact_key)
    if artifact is None:
        raise HTTPException(status_code=404, detail="Validation artifact file missing")
    return artifact
