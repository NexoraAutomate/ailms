"""Local filesystem storage for correspondence documents."""

from __future__ import annotations

import hashlib
import re
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile

from app.config import get_settings

ALLOWED_EXTENSIONS = {
    ".pdf",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".csv",
    ".txt",
}

MIME_BY_EXT = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".csv": "text/csv",
    ".txt": "text/plain",
}

PREVIEW_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp"}


def storage_root() -> Path:
    settings = get_settings()
    root = Path(settings.document_storage_path).expanduser().resolve()
    return root


def ensure_storage_dirs() -> None:
    root = storage_root()
    for sub in ("letters", "attachments", "documents"):
        (root / sub).mkdir(parents=True, exist_ok=True)


def _safe_original_name(name: str) -> str:
    base = Path(name).name
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "_", base).strip("._")
    return cleaned[:200] or "file"


def validate_upload(file: UploadFile, size: int) -> tuple[str, str]:
    settings = get_settings()
    if size <= 0:
        raise HTTPException(status_code=422, detail="Validation failed: empty file")
    if size > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="File too large")

    original = _safe_original_name(file.filename or "upload.bin")
    ext = Path(original).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Unsupported file type")

    mime = file.content_type or MIME_BY_EXT.get(ext, "application/octet-stream")
    return original, ext


def build_storage_key(*, letter_id: int, document_id: int, version_id: int, original_filename: str) -> str:
    safe = _safe_original_name(original_filename)
    token = uuid.uuid4().hex[:12]
    return f"documents/{letter_id}/{document_id}/{version_id}_{token}_{safe}"


def resolve_storage_path(storage_key: str) -> Path:
    if ".." in storage_key.replace("\\", "/") or storage_key.startswith(("/", "\\")):
        raise HTTPException(status_code=400, detail="Invalid storage reference")
    root = storage_root()
    target = (root / storage_key).resolve()
    if not str(target).startswith(str(root)):
        raise HTTPException(status_code=400, detail="Invalid storage reference")
    return target


async def save_upload_file(
    *,
    upload: UploadFile,
    letter_id: int,
    document_id: int,
    version_id: int,
) -> tuple[str, int, str, str, str, str, str]:
    """Returns original_filename, size, file_type, mime, checksum, storage_key, stored_name."""
    content = await upload.read()
    size = len(content)
    original, ext = validate_upload(upload, size)
    storage_key = build_storage_key(
        letter_id=letter_id,
        document_id=document_id,
        version_id=version_id,
        original_filename=original,
    )
    path = resolve_storage_path(storage_key)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    checksum = hashlib.sha256(content).hexdigest()
    mime = upload.content_type or MIME_BY_EXT.get(ext, "application/octet-stream")
    stored_name = Path(storage_key).name
    return original, size, ext.lstrip("."), mime, checksum, storage_key, stored_name


def can_preview(ext_or_type: str) -> bool:
    ext = ext_or_type if ext_or_type.startswith(".") else f".{ext_or_type.lower()}"
    return ext in PREVIEW_EXTENSIONS
