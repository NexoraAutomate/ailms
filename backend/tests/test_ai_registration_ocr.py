"""AI registration OCR tests (master plan step 5 / spec 02)."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from app.ai.job_service import create_registration_job
from app.ai.job_states import JobStatus
from app.ai.job_worker import run_ocr_for_job_id
from app.ai.ocr_service import (
    OcrError,
    PyMuPdfTextEngine,
    get_ocr_engine,
    load_ocr_artifact,
    ocr_document,
    run_ocr_stage,
    write_ocr_artifact,
)
from app.config import Settings, get_settings
from app.database import SessionLocal, engine
from app.db_upgrade import upgrade_ai_registration_schema
from app.models import AiRegistrationJob, AiStagedDocument, Letter
from app.storage_service import ensure_storage_dirs, resolve_storage_path

_REPO_ROOT = Path(__file__).resolve().parents[2]
_FIXTURES = _REPO_ROOT / "fixtures" / "ai-letter-registration"
_SAMPLE_01 = _FIXTURES / "sample-01-typed-letter.pdf"
_SAMPLE_06 = _FIXTURES / "sample-06-multipage.pdf"
_PARTIAL_01 = _FIXTURES / "expected" / "sample-01-ocr-output.partial.json"


class OcrUnitTest(unittest.TestCase):
    def test_get_engine_pymupdf_text(self) -> None:
        engine = get_ocr_engine("pymupdf_text")
        self.assertEqual(engine.name, "pymupdf_text")

    def test_ocr_sample_01_typed_letter(self) -> None:
        if not _SAMPLE_01.is_file():
            self.skipTest(f"missing fixture {_SAMPLE_01}")
        pages, errors, eng = ocr_document(_SAMPLE_01, engine=PyMuPdfTextEngine())
        self.assertEqual(eng.name, "pymupdf_text")
        self.assertEqual(errors, [])
        self.assertGreaterEqual(len(pages), 1)
        self.assertEqual(pages[0].page_number, 1)
        self.assertIn("Ref", pages[0].full_text)
        self.assertTrue(pages[0].full_text.strip())

        if _PARTIAL_01.is_file():
            partial = json.loads(_PARTIAL_01.read_text(encoding="utf-8"))
            for needle in partial["pages"][0]["fullTextContains"]:
                self.assertIn(needle, pages[0].full_text)

    def test_ocr_sample_06_multipage_monotonic(self) -> None:
        if not _SAMPLE_06.is_file():
            self.skipTest(f"missing fixture {_SAMPLE_06}")
        pages, errors, _eng = ocr_document(_SAMPLE_06, engine=PyMuPdfTextEngine())
        self.assertEqual(errors, [])
        self.assertEqual(len(pages), 3)
        numbers = [p.page_number for p in pages]
        self.assertEqual(numbers, [1, 2, 3])
        self.assertIn("FIXTURE-MULTI-001", pages[0].full_text)
        self.assertIn("Action", pages[2].full_text)

    def test_artifact_immutable_version_suffix(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            storage = Path(tmp)
            settings = Settings(document_storage_path=str(storage), ocr_engine="pymupdf_text")
            get_settings.cache_clear()
            with patch("app.storage_service.get_settings", return_value=settings):
                with patch("app.ai.ocr_service.get_settings", return_value=settings):
                    ensure_storage_dirs()
                    artifact = {
                        "schemaVersion": 1,
                        "jobId": "1",
                        "pages": [],
                        "errors": [],
                    }
                    key1 = write_ocr_artifact(1, artifact)
                    key2 = write_ocr_artifact(1, {**artifact, "jobId": "1b"})
                    self.assertEqual(key1, "ai/jobs/1/ocr-output.json")
                    self.assertEqual(key2, "ai/jobs/1/ocr-output.v2.json")
                    p1 = resolve_storage_path(key1)
                    mtime1 = p1.stat().st_mtime_ns
                    # First file unchanged after second write
                    self.assertEqual(p1.stat().st_mtime_ns, mtime1)
                    loaded = load_ocr_artifact(key1)
                    self.assertEqual(loaded["jobId"], "1")
            get_settings.cache_clear()

    def test_max_pages_raises(self) -> None:
        if not _SAMPLE_06.is_file():
            self.skipTest(f"missing fixture {_SAMPLE_06}")
        with self.assertRaises(OcrError) as ctx:
            ocr_document(_SAMPLE_06, engine=PyMuPdfTextEngine(), max_pages=2)
        self.assertEqual(ctx.exception.code, "OCR_TOO_MANY_PAGES")


class OcrJobIntegrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        upgrade_ai_registration_schema(engine)
        cls._tmpdir = tempfile.TemporaryDirectory()
        cls._storage = Path(cls._tmpdir.name)
        get_settings.cache_clear()
        cls._settings = Settings(
            document_storage_path=str(cls._storage),
            ai_registration_enabled=True,
            ai_registration_worker_enabled=False,
            ocr_engine="pymupdf_text",
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
        get_settings.cache_clear()
        self._patches = [
            patch("app.config.get_settings", return_value=self._settings),
            patch("app.storage_service.get_settings", return_value=self._settings),
            patch("app.ai.ocr_service.get_settings", return_value=self._settings),
            patch("app.ai.job_service.get_settings", return_value=self._settings),
        ]
        for p in self._patches:
            p.start()

    def tearDown(self) -> None:
        for p in self._patches:
            p.stop()
        self.db.rollback()
        self.db.close()
        get_settings.cache_clear()

    def _stage_fixture(self, pdf_path: Path) -> AiStagedDocument:
        content = pdf_path.read_bytes()
        row = AiStagedDocument(
            original_filename=pdf_path.name,
            mime_type="application/pdf",
            file_size=len(content),
            checksum="deadbeef",
            storage_key="pending",
            uploaded_by="tester",
        )
        self.db.add(row)
        self.db.flush()
        key = f"ai/staging/{row.id}/{pdf_path.name}"
        path = resolve_storage_path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        row.storage_key = key
        self.db.flush()
        return row

    def test_sample_01_job_writes_ocr_output(self) -> None:
        if not _SAMPLE_01.is_file():
            self.skipTest(f"missing fixture {_SAMPLE_01}")

        staged = self._stage_fixture(_SAMPLE_01)
        with patch("app.ai.job_service.current_user_name", return_value="tester"):
            job = create_registration_job(self.db, staged_document_id=staged.id)
            self.db.flush()

        run_ocr_stage(self.db, job, engine=PyMuPdfTextEngine())
        self.db.commit()
        self.db.refresh(job)

        self.assertEqual(job.status, JobStatus.OCR_COMPLETE.value)
        self.assertTrue(job.ocr_artifact_key)
        self.assertIsNotNone(job.ocr_completed_at)
        self.assertEqual(self.db.query(Letter).count(), self._letter_count_before)

        artifact_path = resolve_storage_path(job.ocr_artifact_key)
        self.assertTrue(artifact_path.is_file())
        self.assertTrue(artifact_path.name.startswith("ocr-output"))
        artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
        self.assertEqual(artifact["schemaVersion"], 1)
        self.assertEqual(artifact["jobId"], str(job.id))
        self.assertGreaterEqual(len(artifact["pages"]), 1)
        self.assertIn("Ref", artifact["pages"][0]["fullText"])

    def test_run_ocr_for_job_id_cli_path(self) -> None:
        if not _SAMPLE_01.is_file():
            self.skipTest(f"missing fixture {_SAMPLE_01}")
        staged = self._stage_fixture(_SAMPLE_01)
        with patch("app.ai.job_service.current_user_name", return_value="tester"):
            job = create_registration_job(self.db, staged_document_id=staged.id)
            self.db.flush()

        with patch("app.ai.ocr_service.get_ocr_engine", return_value=PyMuPdfTextEngine()):
            updated = run_ocr_for_job_id(self.db, job.id)
            self.db.commit()
            self.db.refresh(updated)

        self.assertEqual(updated.status, JobStatus.OCR_COMPLETE.value)
        self.assertTrue(updated.ocr_artifact_key.endswith("ocr-output.json"))

    def test_empty_ocr_goes_needs_review(self) -> None:
        if not _SAMPLE_01.is_file():
            self.skipTest(f"missing fixture {_SAMPLE_01}")
        staged = self._stage_fixture(_SAMPLE_01)
        with patch("app.ai.job_service.current_user_name", return_value="tester"):
            job = create_registration_job(self.db, staged_document_id=staged.id)
            self.db.flush()

        class EmptyEngine:
            name = "fake"
            version = "0"

            def recognize_pdf_page(self, pdf_path: Path, page_index: int):
                return []

            def recognize_image(self, image: Image.Image):
                return []

        run_ocr_stage(self.db, job, engine=EmptyEngine())
        self.db.commit()
        self.db.refresh(job)
        self.assertEqual(job.status, JobStatus.NEEDS_REVIEW.value)
        self.assertTrue(job.ocr_artifact_key)

    def test_missing_source_fails(self) -> None:
        row = AiStagedDocument(
            original_filename="gone.pdf",
            mime_type="application/pdf",
            file_size=1,
            checksum="x",
            storage_key="ai/staging/999/does-not-exist.pdf",
            uploaded_by="tester",
        )
        self.db.add(row)
        self.db.flush()
        job = AiRegistrationJob(
            staged_document_id=row.id,
            status=JobStatus.QUEUED.value,
            created_by="tester",
        )
        self.db.add(job)
        self.db.flush()

        run_ocr_stage(self.db, job, engine=PyMuPdfTextEngine())
        self.db.commit()
        self.db.refresh(job)
        self.assertEqual(job.status, JobStatus.FAILED.value)
        self.assertEqual(job.error_code, "SOURCE_FILE_MISSING")


if __name__ == "__main__":
    unittest.main()
