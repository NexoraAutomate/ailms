from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.document_service import (
    add_document_version,
    create_document_with_upload,
    get_version_for_access,
    serialize_document,
    serialize_version,
)
from app.models import Document, DocumentVersion
from app.schemas import DocumentOut, DocumentVersionOut
from app.storage_service import can_preview, resolve_storage_path

router = APIRouter(tags=["documents"])


@router.get("/documents", response_model=list[DocumentOut])
def list_documents(letter_id: int = Query(..., alias="letterId"), db: Session = Depends(get_db)) -> list[DocumentOut]:
    rows = db.query(Document).filter(Document.letter_id == letter_id).order_by(Document.id.desc()).all()
    return [DocumentOut(**serialize_document(db, row)) for row in rows]


@router.get("/documents/{document_id}", response_model=DocumentOut)
def get_document(document_id: int, db: Session = Depends(get_db)) -> DocumentOut:
    row = db.get(Document, document_id)
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")
    return DocumentOut(**serialize_document(db, row))


@router.get("/documents/{document_id}/versions", response_model=list[DocumentVersionOut])
def list_versions(document_id: int, db: Session = Depends(get_db)) -> list[DocumentVersionOut]:
    if not db.get(Document, document_id):
        raise HTTPException(status_code=404, detail="Document not found")
    rows = (
        db.query(DocumentVersion)
        .filter(DocumentVersion.document_id == document_id)
        .order_by(DocumentVersion.id.desc())
        .all()
    )
    return [DocumentVersionOut(**serialize_version(row)) for row in rows]


@router.post("/letters/{letter_id}/documents/upload", response_model=DocumentOut, status_code=201)
async def upload_document(
    letter_id: int,
    document_type: str = Form(...),
    change_description: str = Form(default=""),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> DocumentOut:
    document = await create_document_with_upload(
        db,
        letter_id=letter_id,
        document_type=document_type,
        upload=file,
        change_description=change_description,
    )
    db.commit()
    db.refresh(document)
    return DocumentOut(**serialize_document(db, document))


@router.post("/documents/{document_id}/versions", response_model=DocumentVersionOut, status_code=201)
async def upload_version(
    document_id: int,
    change_description: str = Form(default=""),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> DocumentVersionOut:
    version = await add_document_version(
        db,
        document_id=document_id,
        upload=file,
        change_description=change_description,
    )
    db.commit()
    db.refresh(version)
    return DocumentVersionOut(**serialize_version(version))


@router.get("/document-versions/{version_id}/download")
def download_version(version_id: int, db: Session = Depends(get_db)) -> FileResponse:
    version, _document, _letter = get_version_for_access(db, version_id)
    path = resolve_storage_path(version.storage_key)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(
        path,
        media_type=version.mime_type,
        filename=version.original_filename,
        content_disposition_type="attachment",
    )


@router.get("/document-versions/{version_id}/preview")
def preview_version(version_id: int, db: Session = Depends(get_db)) -> FileResponse:
    version, _document, _letter = get_version_for_access(db, version_id)
    if not can_preview(version.file_type):
        raise HTTPException(status_code=415, detail="Preview not available for this file type")
    path = resolve_storage_path(version.storage_key)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(
        path,
        media_type=version.mime_type,
        filename=version.original_filename,
        content_disposition_type="inline",
    )


@router.get("/document-versions/{version_id}/meta", response_model=DocumentVersionOut)
def version_meta(version_id: int, db: Session = Depends(get_db)) -> DocumentVersionOut:
    version, _document, _letter = get_version_for_access(db, version_id)
    return DocumentVersionOut(**serialize_version(version))
