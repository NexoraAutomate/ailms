"""Staged file ingestion for AI-assisted letter registration (no letter_id yet)."""

from __future__ import annotations

import hashlib
import logging

from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.models import AiStagedDocument
from app.services import add_audit, current_user_name
from app.storage_service import (
    MIME_BY_EXT,
    build_staging_storage_key,
    resolve_storage_path,
    validate_staged_upload,
)

logger = logging.getLogger(__name__)

_VALID_SOURCES = frozenset({"register-letter", "scan"})


def serialize_staged_document(row: AiStagedDocument) -> dict:
    created = row.created_at.isoformat() if row.created_at else ""
    if created and not created.endswith("Z") and "+" not in created:
        created = f"{created}Z" if "T" in created else created
    checksum = row.checksum
    if checksum and not checksum.startswith("sha256:"):
        checksum = f"sha256:{checksum}"
    return {
        "stagedDocumentId": str(row.id),
        "originalFilename": row.original_filename,
        "mimeType": row.mime_type,
        "fileSize": row.file_size,
        "checksum": checksum,
        "createdAt": created,
    }


async def stage_document_upload(
    db: Session,
    *,
    upload: UploadFile,
    source: str | None = None,
    actor: str | None = None,
) -> AiStagedDocument:
    """
    Persist an uploaded PDF/image under storage/ai/staging/{id}/… and insert
    cms_ai_staged_documents. Does not create a letter or run OCR.
    """
    content = await upload.read()
    size = len(content)
    original, ext = validate_staged_upload(upload, size)
    mime = upload.content_type or MIME_BY_EXT.get(ext, "application/octet-stream")
    checksum = hashlib.sha256(content).hexdigest()
    actor = actor or current_user_name(db)

    source_label = (source or "register-letter").strip().lower()
    if source_label not in _VALID_SOURCES:
        source_label = "register-letter"

    row = AiStagedDocument(
        original_filename=original,
        mime_type=mime,
        file_size=size,
        checksum=checksum,
        storage_key="pending",
        uploaded_by=actor,
    )
    db.add(row)
    db.flush()

    storage_key = build_staging_storage_key(staged_id=row.id, original_filename=original)
    path = resolve_storage_path(storage_key)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    except OSError as exc:
        logger.exception("Failed to write staged file id=%s key=%s", row.id, storage_key)
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to store uploaded file") from exc

    row.storage_key = storage_key
    db.flush()

    add_audit(
        db,
        user=actor,
        module="AI Registration",
        action="Document Staged",
        record=str(row.id),
        description=f"Staged {original} ({size} bytes, source={source_label})",
    )
    db.flush()

    logger.info("Staged document id=%s filename=%s size=%s", row.id, original, size)
    return row
