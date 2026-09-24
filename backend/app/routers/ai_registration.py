"""AI-assisted letter registration API (staged upload, jobs, review)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.ai.ingestion_service import serialize_staged_document, stage_document_upload
from app.config import get_settings
from app.database import get_db
from app.schemas import StagedDocumentOut

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
