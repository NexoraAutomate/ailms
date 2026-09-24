"""Staged file ingestion tests (master plan step 3 / spec 01)."""

from __future__ import annotations

import asyncio
import hashlib
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException, UploadFile
from sqlalchemy import text

from app.ai.ingestion_service import serialize_staged_document, stage_document_upload
from app.config import Settings, get_settings
from app.database import SessionLocal, engine
from app.db_upgrade import upgrade_ai_registration_schema
from app.models import AiStagedDocument, Letter
from app.storage_service import (
    STAGED_UPLOAD_EXTENSIONS,
    ensure_storage_dirs,
    resolve_storage_path,
    validate_staged_upload,
)

# Minimal valid PDF (one empty page).
_MINIMAL_PDF = b"""%PDF-1.1
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>endobj
xref
0 4
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
trailer<< /Size 4 /Root 1 0 R >>
startxref
190
%%EOF
"""


def _upload(filename: str, content: bytes, content_type: str = "application/pdf") -> UploadFile:
    return UploadFile(filename=filename, file=BytesIO(content), headers={"content-type": content_type})


class StagedUploadValidationTest(unittest.TestCase):
    def test_staged_upload_rejects_exe(self) -> None:
        upload = _upload("malware.exe", b"MZ\x90\x00fake", "application/octet-stream")
        with self.assertRaises(HTTPException) as ctx:
            validate_staged_upload(upload, size=len(b"MZ\x90\x00fake"))
        self.assertEqual(ctx.exception.status_code, 415)

    def test_staged_upload_rejects_docx(self) -> None:
        """Office formats allowed for letter documents are not OCR staging types."""
        upload = _upload("letter.docx", b"PK\x03\x04", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        with self.assertRaises(HTTPException) as ctx:
            validate_staged_upload(upload, size=4)
        self.assertEqual(ctx.exception.status_code, 415)

    def test_staged_extensions_ocr_subset(self) -> None:
        self.assertEqual(STAGED_UPLOAD_EXTENSIONS, {".pdf", ".png", ".jpg", ".jpeg", ".webp"})


class StagedIngestionIntegrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        upgrade_ai_registration_schema(engine)
        cls._tmpdir = tempfile.TemporaryDirectory()
        cls._storage = Path(cls._tmpdir.name)
        get_settings.cache_clear()
        cls._settings = Settings(
            document_storage_path=str(cls._storage),
            ai_registration_enabled=True,
        )
        with patch("app.storage_service.get_settings", return_value=cls._settings):
            ensure_storage_dirs()

    @classmethod
    def tearDownClass(cls) -> None:
        get_settings.cache_clear()
        cls._tmpdir.cleanup()

    def setUp(self) -> None:
        self.db = SessionLocal()
        self._letter_count_before = self.db.query(Letter).count()
        self._staged_count_before = self.db.query(AiStagedDocument).count()

    def tearDown(self) -> None:
        self.db.rollback()
        self.db.close()

    def test_stage_pdf_creates_row_and_file_without_letter(self) -> None:
        upload = _upload("sample-letter.pdf", _MINIMAL_PDF)
        expected_checksum = hashlib.sha256(_MINIMAL_PDF).hexdigest()

        with patch("app.storage_service.get_settings", return_value=self._settings):
            with patch("app.ai.ingestion_service.current_user_name", return_value="tester"):
                row = asyncio.run(
                    stage_document_upload(self.db, upload=upload, source="register-letter")
                )
                self.db.commit()
                self.db.refresh(row)

        self.assertIsNotNone(row.id)
        self.assertEqual(row.original_filename, "sample-letter.pdf")
        self.assertEqual(row.checksum, expected_checksum)
        self.assertEqual(row.file_size, len(_MINIMAL_PDF))
        self.assertTrue(row.storage_key.startswith(f"ai/staging/{row.id}/"))

        with patch("app.storage_service.get_settings", return_value=self._settings):
            path = resolve_storage_path(row.storage_key)
        self.assertTrue(path.is_file())
        self.assertEqual(path.read_bytes(), _MINIMAL_PDF)

        payload = serialize_staged_document(row)
        self.assertEqual(payload["stagedDocumentId"], str(row.id))
        self.assertEqual(payload["checksum"], f"sha256:{expected_checksum}")

        self.assertEqual(self.db.query(Letter).count(), self._letter_count_before)
        self.assertEqual(self.db.query(AiStagedDocument).count(), self._staged_count_before + 1)

    def test_exe_via_service_raises_415_and_no_row(self) -> None:
        upload = _upload("bad.exe", b"not-a-pdf")
        before = self.db.query(AiStagedDocument).count()
        with patch("app.storage_service.get_settings", return_value=self._settings):
            with patch("app.ai.ingestion_service.current_user_name", return_value="tester"):
                with self.assertRaises(HTTPException) as ctx:
                    asyncio.run(stage_document_upload(self.db, upload=upload))
        self.assertEqual(ctx.exception.status_code, 415)
        self.db.rollback()
        self.assertEqual(self.db.query(AiStagedDocument).count(), before)

    def test_db_select_staged_documents(self) -> None:
        with engine.connect() as conn:
            count = conn.execute(text("SELECT COUNT(*) FROM cms_ai_staged_documents")).scalar()
        self.assertIsNotNone(count)
        self.assertGreaterEqual(int(count), 0)


if __name__ == "__main__":
    unittest.main()
