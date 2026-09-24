"""Document and version management."""

from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.models import Document, DocumentVersion, Letter
from app.services import CLOSED_STATUSES, add_audit, add_notification, current_user_name
from app.storage_service import (
    MIME_BY_EXT,
    build_storage_key,
    can_preview,
    copy_storage_file,
    save_upload_file,
)


DOCUMENT_TYPES = {
    "Original Letter",
    "Scanned Letter",
    "Draft Response",
    "Final Response",
    "Supporting Document",
    "Technical Document",
    "Financial Document",
    "Reference Document",
    "Other",
}


def _get_letter(db: Session, letter_id: int) -> Letter:
    letter = db.get(Letter, letter_id)
    if not letter:
        raise HTTPException(status_code=404, detail="Letter not found")
    return letter


def assert_letter_mutable(letter: Letter) -> None:
    if getattr(letter, "is_archived", False) or letter.status in CLOSED_STATUSES | {"Archived"}:
        raise HTTPException(status_code=400, detail="Archived or closed correspondence cannot be modified")


def next_version_number(existing: list[str]) -> str:
    if not existing:
        return "1.0"
    last = existing[-1]
    parts = last.split(".")
    try:
        major, minor = int(parts[0]), int(parts[1]) if len(parts) > 1 else 0
    except ValueError:
        return f"{len(existing) + 1}.0"
    minor += 1
    if minor >= 10:
        major += 1
        minor = 0
    return f"{major}.{minor}"


def serialize_version(row: DocumentVersion) -> dict:
    return {
        "id": row.id,
        "documentId": str(row.document_id),
        "versionNumber": row.version_number,
        "parentVersionId": row.parent_version_id,
        "filename": row.filename,
        "originalFilename": row.original_filename,
        "fileType": row.file_type,
        "mimeType": row.mime_type,
        "fileSize": row.file_size,
        "uploadedBy": row.uploaded_by,
        "uploadDate": row.upload_date.isoformat(),
        "changeDescription": row.change_description,
        "status": row.status,
        "checksum": row.checksum,
        "isCurrent": row.is_current,
        "previewable": can_preview(row.file_type),
    }


_UPLOAD_ROW_PLACEHOLDER = "pending"


def _apply_upload_to_version(
    version: DocumentVersion,
    *,
    original: str,
    size: int,
    file_type: str,
    mime: str,
    checksum: str,
    storage_key: str,
    stored_name: str,
) -> None:
    version.original_filename = original
    version.filename = stored_name
    version.file_type = file_type
    version.mime_type = mime
    version.file_size = size
    version.storage_key = storage_key
    version.checksum = checksum


def serialize_document(db: Session, doc: Document) -> dict:
    versions = db.query(DocumentVersion).filter(DocumentVersion.document_id == doc.id).order_by(DocumentVersion.id).all()
    current = next((v for v in reversed(versions) if v.is_current), versions[-1] if versions else None)
    return {
        "id": str(doc.id),
        "letterId": str(doc.letter_id),
        "documentType": doc.document_type,
        "status": doc.status,
        "createdAt": doc.created_at.isoformat(),
        "versionCount": len(versions),
        "currentVersion": serialize_version(current) if current else None,
    }


async def create_document_with_upload(
    db: Session,
    *,
    letter_id: int,
    document_type: str,
    upload: UploadFile,
    change_description: str = "",
    actor: str | None = None,
) -> Document:
    letter = _get_letter(db, letter_id)
    assert_letter_mutable(letter)
    if document_type not in DOCUMENT_TYPES:
        raise HTTPException(status_code=422, detail="Validation failed: invalid document type")

    actor = actor or current_user_name(db)
    document = Document(letter_id=letter.id, document_type=document_type)
    db.add(document)
    db.flush()

    version = DocumentVersion(
        document_id=document.id,
        version_number="1.0",
        filename=_UPLOAD_ROW_PLACEHOLDER,
        original_filename=_UPLOAD_ROW_PLACEHOLDER,
        storage_key=_UPLOAD_ROW_PLACEHOLDER,
        uploaded_by=actor,
        change_description=change_description or "Initial upload",
        status="Current",
        is_current=True,
    )
    db.add(version)
    db.flush()

    original, size, file_type, mime, checksum, storage_key, stored_name = await save_upload_file(
        upload=upload,
        letter_id=letter.id,
        document_id=document.id,
        version_id=version.id,
    )
    _apply_upload_to_version(
        version,
        original=original,
        size=size,
        file_type=file_type,
        mime=mime,
        checksum=checksum,
        storage_key=storage_key,
        stored_name=stored_name,
    )
    db.flush()

    add_audit(
        db,
        user=actor,
        module="Documents",
        action="Document Uploaded",
        record=letter.number,
        description=f"{document_type}: {original} (v1.0)",
    )
    add_notification(
        db,
        title="Document Uploaded",
        description=f"{original} uploaded for {letter.number}.",
        priority="Medium",
        letter_id=letter.id,
        notification_type="Document Uploaded",
        related_entity_type="document",
        related_entity_id=str(document.id),
    )
    db.flush()
    return document


def create_document_from_staged_file(
    db: Session,
    *,
    letter_id: int,
    document_type: str,
    original_filename: str,
    mime_type: str,
    file_size: int,
    checksum: str,
    source_storage_key: str,
    change_description: str = "",
    actor: str | None = None,
) -> Document:
    """
    Attach an existing staged file to a letter by copying into documents/{letter_id}/….

    Staging file is preserved for audit (copy, not move).
    """
    letter = _get_letter(db, letter_id)
    assert_letter_mutable(letter)
    if document_type not in DOCUMENT_TYPES:
        document_type = "Original Letter"

    actor = actor or current_user_name(db)
    document = Document(letter_id=letter.id, document_type=document_type)
    db.add(document)
    db.flush()

    version = DocumentVersion(
        document_id=document.id,
        version_number="1.0",
        filename=_UPLOAD_ROW_PLACEHOLDER,
        original_filename=_UPLOAD_ROW_PLACEHOLDER,
        storage_key=_UPLOAD_ROW_PLACEHOLDER,
        uploaded_by=actor,
        change_description=change_description or "Attached from AI registration staging",
        status="Current",
        is_current=True,
    )
    db.add(version)
    db.flush()

    original = Path(original_filename or "upload.bin").name
    ext = Path(original).suffix.lower() or ".bin"
    storage_key = build_storage_key(
        letter_id=letter.id,
        document_id=document.id,
        version_id=version.id,
        original_filename=original,
    )
    copy_storage_file(source_key=source_storage_key, dest_key=storage_key)
    mime = mime_type or MIME_BY_EXT.get(ext, "application/octet-stream")
    _apply_upload_to_version(
        version,
        original=original,
        size=file_size,
        file_type=ext.lstrip(".") or "bin",
        mime=mime,
        checksum=checksum or "",
        storage_key=storage_key,
        stored_name=Path(storage_key).name,
    )
    db.flush()

    add_audit(
        db,
        user=actor,
        module="Documents",
        action="Document Uploaded",
        record=letter.number,
        description=f"{document_type}: {original} (v1.0, AI registration)",
    )
    add_notification(
        db,
        title="Document Uploaded",
        description=f"{original} uploaded for {letter.number}.",
        priority="Medium",
        letter_id=letter.id,
        notification_type="Document Uploaded",
        related_entity_type="document",
        related_entity_id=str(document.id),
    )
    db.flush()
    return document


async def add_document_version(
    db: Session,
    *,
    document_id: int,
    upload: UploadFile,
    change_description: str = "",
    actor: str | None = None,
) -> DocumentVersion:
    document = db.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    letter = _get_letter(db, document.letter_id)
    assert_letter_mutable(letter)

    actor = actor or current_user_name(db)
    prior = (
        db.query(DocumentVersion)
        .filter(DocumentVersion.document_id == document.id)
        .order_by(DocumentVersion.id)
        .all()
    )
    version_number = next_version_number([row.version_number for row in prior])
    parent_id = prior[-1].id if prior else None

    for row in prior:
        if row.is_current:
            row.is_current = False
            row.status = "Historical"

    version = DocumentVersion(
        document_id=document.id,
        version_number=version_number,
        parent_version_id=parent_id,
        filename=_UPLOAD_ROW_PLACEHOLDER,
        original_filename=_UPLOAD_ROW_PLACEHOLDER,
        storage_key=_UPLOAD_ROW_PLACEHOLDER,
        uploaded_by=actor,
        change_description=change_description or f"Version {version_number}",
        status="Current",
        is_current=True,
    )
    db.add(version)
    db.flush()

    original, size, file_type, mime, checksum, storage_key, stored_name = await save_upload_file(
        upload=upload,
        letter_id=letter.id,
        document_id=document.id,
        version_id=version.id,
    )
    _apply_upload_to_version(
        version,
        original=original,
        size=size,
        file_type=file_type,
        mime=mime,
        checksum=checksum,
        storage_key=storage_key,
        stored_name=stored_name,
    )
    db.flush()

    add_audit(
        db,
        user=actor,
        module="Documents",
        action="Document Version Created",
        record=letter.number,
        description=f"{document.document_type} {original} (v{version_number})",
    )
    add_notification(
        db,
        title="New Document Version",
        description=f"New version {version_number} for {letter.number}.",
        priority="Medium",
        letter_id=letter.id,
        notification_type="New Document Version",
        related_entity_type="document",
        related_entity_id=str(document.id),
    )
    db.flush()
    return version


def get_version_for_access(db: Session, version_id: int) -> tuple[DocumentVersion, Document, Letter]:
    version = db.get(DocumentVersion, version_id)
    if not version:
        raise HTTPException(status_code=404, detail="Record not found")
    document = db.get(Document, version.document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Record not found")
    letter = _get_letter(db, document.letter_id)
    return version, document, letter
