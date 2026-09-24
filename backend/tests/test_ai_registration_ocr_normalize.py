"""AI registration OCR normalization tests (master plan step 6 / spec 03)."""

from __future__ import annotations

import json
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.ai.job_service import create_registration_job
from app.ai.job_states import JobStatus
from app.ai.ocr_normalize import (
    NormalizeError,
    PAGE_HEADER_RE,
    build_combined_text,
    load_normalized_artifact,
    normalize_ocr_dict,
    page_header,
    run_normalize_stage,
    truncate_combined_text,
    write_normalized_artifacts,
)
from app.ai.ocr_service import PyMuPdfTextEngine, run_ocr_stage, write_ocr_artifact
from app.config import Settings, get_settings
from app.database import SessionLocal, engine
from app.db_upgrade import upgrade_ai_registration_schema
from app.models import AiRegistrationJob, AiStagedDocument, Letter
from app.storage_service import ensure_storage_dirs, resolve_storage_path

_REPO_ROOT = Path(__file__).resolve().parents[2]
_SAMPLE_01 = _REPO_ROOT / "fixtures" / "ai-letter-registration" / "sample-01-typed-letter.pdf"
_SAMPLE_06 = _REPO_ROOT / "fixtures" / "ai-letter-registration" / "sample-06-multipage.pdf"


def _synthetic_ocr(*, pages: list[dict], job_id: str = "7") -> dict:
    return {
        "schemaVersion": 1,
        "jobId": job_id,
        "pages": pages,
        "errors": [],
    }


class NormalizeUnitTest(unittest.TestCase):
    def test_combined_text_exact_for_synthetic(self) -> None:
        ocr = _synthetic_ocr(
            pages=[
                {
                    "pageNumber": 1,
                    "width": 100,
                    "height": 200,
                    "lines": [
                        {"text": "Ref: MOIT/2026/1234", "confidence": 0.9, "bbox": [10, 20, 90, 30]},
                        {"text": "Date: 15 March 2026", "confidence": 0.9, "bbox": [10, 40, 90, 50]},
                    ],
                }
            ]
        )
        result = normalize_ocr_dict(ocr, max_chars=100_000)
        expected = (
            "=== PAGE 1 ===\n"
            "Ref: MOIT/2026/1234\n"
            "Date: 15 March 2026"
        )
        # Close vertical gap → may merge into one paragraph depending on heights.
        # Lines at y=20–30 and y=40–50: height=10, threshold=15, gap=20 → separate paragraphs.
        self.assertEqual(result["combinedText"], expected)
        self.assertEqual(result["pageCount"], 1)
        self.assertFalse(result["truncated"])

    def test_three_page_headers(self) -> None:
        ocr = _synthetic_ocr(
            pages=[
                {
                    "pageNumber": 1,
                    "width": 10,
                    "height": 100,
                    "lines": [{"text": "A", "confidence": 1, "bbox": [0, 0, 5, 5]}],
                },
                {
                    "pageNumber": 2,
                    "width": 10,
                    "height": 100,
                    "lines": [{"text": "B", "confidence": 1, "bbox": [0, 0, 5, 5]}],
                },
                {
                    "pageNumber": 3,
                    "width": 10,
                    "height": 100,
                    "lines": [{"text": "C", "confidence": 1, "bbox": [0, 0, 5, 5]}],
                },
            ]
        )
        result = normalize_ocr_dict(ocr)
        headers = PAGE_HEADER_RE.findall(result["combinedText"])
        self.assertEqual(headers, ["1", "2", "3"])
        for n in (1, 2, 3):
            self.assertIn(page_header(n), result["combinedText"])

    def test_empty_page_placeholder(self) -> None:
        ocr = _synthetic_ocr(
            pages=[
                {"pageNumber": 1, "width": 10, "height": 100, "lines": []},
            ]
        )
        result = normalize_ocr_dict(ocr)
        self.assertEqual(
            result["combinedText"],
            "=== PAGE 1 ===\n[no text detected]",
        )
        self.assertEqual(result["pages"][0]["paragraphs"], [])

    def test_sort_reading_order(self) -> None:
        # Out-of-order lines: bottom line listed first in OCR.
        ocr = _synthetic_ocr(
            pages=[
                {
                    "pageNumber": 1,
                    "width": 100,
                    "height": 200,
                    "lines": [
                        {"text": "Second", "confidence": 1, "bbox": [10, 80, 50, 90]},
                        {"text": "First", "confidence": 1, "bbox": [10, 10, 50, 20]},
                    ],
                }
            ]
        )
        result = normalize_ocr_dict(ocr)
        # gap large → two paragraphs; reading order First then Second
        texts = [p["text"] for p in result["pages"][0]["paragraphs"]]
        self.assertEqual(texts, ["First", "Second"])
        # sourceLineIndices preserve original OCR indices
        self.assertEqual(result["pages"][0]["paragraphs"][0]["sourceLineIndices"], [1])
        self.assertEqual(result["pages"][0]["paragraphs"][1]["sourceLineIndices"], [0])
        self.assertEqual(result["pages"][0]["paragraphs"][0]["sourcePage"], 1)

    def test_source_line_indices_valid(self) -> None:
        ocr = _synthetic_ocr(
            pages=[
                {
                    "pageNumber": 1,
                    "width": 100,
                    "height": 200,
                    "lines": [
                        {"text": "Line A", "confidence": 1, "bbox": [0, 0, 10, 8]},
                        {"text": "Line B", "confidence": 1, "bbox": [0, 10, 10, 18]},
                        {"text": "Line C", "confidence": 1, "bbox": [0, 50, 10, 58]},
                    ],
                }
            ]
        )
        result = normalize_ocr_dict(ocr)
        n_lines = 3
        for para in result["pages"][0]["paragraphs"]:
            for idx in para["sourceLineIndices"]:
                self.assertGreaterEqual(idx, 0)
                self.assertLess(idx, n_lines)

    def test_control_chars_stripped(self) -> None:
        ocr = _synthetic_ocr(
            pages=[
                {
                    "pageNumber": 1,
                    "width": 10,
                    "height": 100,
                    "lines": [
                        {
                            "text": "Hello\x00World\x07",
                            "confidence": 1,
                            "bbox": [0, 0, 10, 10],
                        }
                    ],
                }
            ]
        )
        result = normalize_ocr_dict(ocr)
        self.assertIn("HelloWorld", result["combinedText"])
        self.assertNotIn("\x00", result["combinedText"])

    def test_truncate_marker(self) -> None:
        text, truncated = truncate_combined_text("abcdefghij", 8)
        self.assertTrue(truncated)
        self.assertTrue(text.endswith("[TRUNCATED]"))
        self.assertLessEqual(len(text), 8 + len("\n[TRUNCATED]"))  # keep + marker

        # Via normalize
        long_line = "X" * 200
        ocr = _synthetic_ocr(
            pages=[
                {
                    "pageNumber": 1,
                    "width": 10,
                    "height": 100,
                    "lines": [{"text": long_line, "confidence": 1, "bbox": [0, 0, 5, 5]}],
                }
            ]
        )
        result = normalize_ocr_dict(ocr, max_chars=40)
        self.assertTrue(result["truncated"])
        self.assertIn("[TRUNCATED]", result["combinedText"])

    def test_malformed_raises(self) -> None:
        with self.assertRaises(NormalizeError) as ctx:
            normalize_ocr_dict({"jobId": "1"})  # no pages
        self.assertEqual(ctx.exception.code, "OCR_PARSE_ERROR")

    def test_build_combined_text_helpers(self) -> None:
        pages = [
            {"pageNumber": 1, "paragraphs": [{"text": "A", "sourceLineIndices": [0]}]},
            {"pageNumber": 2, "paragraphs": []},
        ]
        text = build_combined_text(pages)
        self.assertEqual(
            text,
            "=== PAGE 1 ===\nA\n=== PAGE 2 ===\n[no text detected]",
        )


class NormalizeJobIntegrationTest(unittest.TestCase):
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
            llm_input_max_chars=100_000,
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
            patch("app.ai.ocr_normalize.get_settings", return_value=self._settings),
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

    def test_ocr_then_normalize_writes_llm_input(self) -> None:
        if not _SAMPLE_01.is_file():
            self.skipTest(f"missing fixture {_SAMPLE_01}")

        staged = self._stage_fixture(_SAMPLE_01)
        with patch("app.ai.job_service.current_user_name", return_value="tester"):
            job = create_registration_job(self.db, staged_document_id=staged.id)
            self.db.flush()

        run_ocr_stage(self.db, job, engine=PyMuPdfTextEngine())
        self.db.flush()
        ocr_path = resolve_storage_path(job.ocr_artifact_key)
        ocr_mtime = ocr_path.stat().st_mtime_ns

        run_normalize_stage(self.db, job)
        self.db.commit()
        self.db.refresh(job)

        self.assertEqual(job.status, JobStatus.OCR_COMPLETE.value)
        self.assertTrue(job.normalized_artifact_key)
        self.assertTrue(job.normalized_artifact_key.endswith("llm-input.json"))
        self.assertEqual(self.db.query(Letter).count(), self._letter_count_before)

        # Raw OCR immutable
        self.assertEqual(ocr_path.stat().st_mtime_ns, ocr_mtime)

        json_path = resolve_storage_path(job.normalized_artifact_key)
        txt_key = job.normalized_artifact_key.replace("llm-input.json", "llm-input.txt")
        txt_path = resolve_storage_path(txt_key)
        self.assertTrue(json_path.is_file())
        self.assertTrue(txt_path.is_file())

        artifact = json.loads(json_path.read_text(encoding="utf-8"))
        self.assertEqual(artifact["schemaVersion"], 1)
        self.assertEqual(artifact["jobId"], str(job.id))
        self.assertGreaterEqual(artifact["pageCount"], 1)
        self.assertIn("=== PAGE 1 ===", artifact["combinedText"])
        self.assertIn("PAGE 1", txt_path.read_text(encoding="utf-8"))

        loaded = load_normalized_artifact(job.normalized_artifact_key)
        self.assertIsNotNone(loaded)
        self.assertEqual(loaded["combinedText"], artifact["combinedText"])

    def test_multipage_three_headers(self) -> None:
        if not _SAMPLE_06.is_file():
            self.skipTest(f"missing fixture {_SAMPLE_06}")

        staged = self._stage_fixture(_SAMPLE_06)
        with patch("app.ai.job_service.current_user_name", return_value="tester"):
            job = create_registration_job(self.db, staged_document_id=staged.id)
            self.db.flush()

        run_ocr_stage(self.db, job, engine=PyMuPdfTextEngine())
        run_normalize_stage(self.db, job)
        self.db.commit()
        self.db.refresh(job)

        artifact = load_normalized_artifact(job.normalized_artifact_key)
        assert artifact is not None
        self.assertEqual(artifact["pageCount"], 3)
        headers = re.findall(r"^=== PAGE (\d+) ===$", artifact["combinedText"], re.M)
        self.assertEqual(headers, ["1", "2", "3"])

    def test_missing_ocr_fails(self) -> None:
        row = AiStagedDocument(
            original_filename="x.pdf",
            mime_type="application/pdf",
            file_size=1,
            checksum="x",
            storage_key="ai/staging/1/x.pdf",
            uploaded_by="tester",
        )
        self.db.add(row)
        self.db.flush()
        job = AiRegistrationJob(
            staged_document_id=row.id,
            status=JobStatus.OCR_COMPLETE.value,
            created_by="tester",
            ocr_artifact_key="ai/jobs/999/does-not-exist.json",
        )
        self.db.add(job)
        self.db.flush()

        run_normalize_stage(self.db, job)
        self.db.commit()
        self.db.refresh(job)
        self.assertEqual(job.status, JobStatus.FAILED.value)
        self.assertEqual(job.error_code, "OCR_ARTIFACT_MISSING")

    def test_malformed_ocr_fails(self) -> None:
        row = AiStagedDocument(
            original_filename="x.pdf",
            mime_type="application/pdf",
            file_size=1,
            checksum="x",
            storage_key="ai/staging/1/x.pdf",
            uploaded_by="tester",
        )
        self.db.add(row)
        self.db.flush()
        job = AiRegistrationJob(
            staged_document_id=row.id,
            status=JobStatus.OCR_COMPLETE.value,
            created_by="tester",
        )
        self.db.add(job)
        self.db.flush()

        bad_key = write_ocr_artifact(job.id, {"schemaVersion": 1, "jobId": str(job.id)})
        # Overwrite with invalid JSON structure that parses but lacks pages — write via path
        path = resolve_storage_path(bad_key)
        path.write_text('{"jobId": "1", "notPages": true}', encoding="utf-8")
        job.ocr_artifact_key = bad_key
        self.db.flush()

        run_normalize_stage(self.db, job)
        self.db.commit()
        self.db.refresh(job)
        self.assertEqual(job.status, JobStatus.FAILED.value)
        self.assertEqual(job.error_code, "OCR_PARSE_ERROR")

    def test_versioned_normalized_artifacts(self) -> None:
        artifact = {
            "schemaVersion": 1,
            "jobId": "1",
            "pageCount": 0,
            "pages": [],
            "combinedText": "=== PAGE 1 ===\n[no text detected]",
            "truncated": False,
        }
        key1 = write_normalized_artifacts(1, artifact)
        key2 = write_normalized_artifacts(1, {**artifact, "jobId": "1b"})
        self.assertEqual(key1, "ai/jobs/1/llm-input.json")
        self.assertEqual(key2, "ai/jobs/1/llm-input.v2.json")
        p1 = resolve_storage_path(key1)
        mtime1 = p1.stat().st_mtime_ns
        self.assertEqual(p1.stat().st_mtime_ns, mtime1)
        self.assertTrue(resolve_storage_path("ai/jobs/1/llm-input.txt").is_file())
        self.assertTrue(resolve_storage_path("ai/jobs/1/llm-input.v2.txt").is_file())


if __name__ == "__main__":
    unittest.main()
