"""AI registration end-to-end acceptance (master plan step 14 / specs 12–13).

CI (mocked LLM, real pymupdf text OCR — no GPU)::

    cd backend && python -m pytest tests/test_ai_registration_e2e.py -m "not live" -v

Live (Ollama + optional PaddleOCR)::

    cd backend && python -m pytest tests/test_ai_registration_e2e.py -m live -v
"""

from __future__ import annotations

import json
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import text

from app.ai.extraction_schema import PROMPT_VERSION, LetterExtractionResult
from app.ai.extraction_service import run_extraction_stage
from app.ai.ingestion_service import stage_document_upload
from app.ai.job_service import create_registration_job
from app.ai.job_states import JobStatus
from app.ai.job_worker import run_ai_registration_cycle
from app.ai.ocr_normalize import run_normalize_stage
from app.ai.ocr_service import PyMuPdfTextEngine, load_ocr_artifact, run_ocr_stage
from app.ai.registration_commit import approve_registration_job
from app.ai.review_service import patch_proposal
from app.ai.validation_service import load_validation_artifact, run_validation_stage
from app.config import Settings, get_settings
from app.database import SessionLocal, engine
from app.db_upgrade import upgrade_ai_registration_schema
from app.models import AiRegistrationJob, Document, Letter
from app.storage_service import ensure_storage_dirs, resolve_storage_path

_REPO_ROOT = Path(__file__).resolve().parents[2]
_FIXTURES = _REPO_ROOT / "fixtures" / "ai-letter-registration"
_SAMPLE_01 = _FIXTURES / "sample-01-typed-letter.pdf"
_PARTIAL_EXTRACTION = _FIXTURES / "expected" / "sample-01-extraction.partial.json"


def _unique_accept_number() -> str:
    return f"ACCEPT-TEST-{uuid.uuid4().hex[:12].upper()}"


def _full_fields(**overrides: dict) -> dict:
    base = {
        "number": {"value": None, "confidence": 0, "requiredReview": True},
        "letterDate": {"value": None, "confidence": 0, "requiredReview": True},
        "receivedDate": {"value": None, "confidence": 0, "requiredReview": False},
        "type": {"value": "Incoming", "confidence": 0.7, "requiredReview": True},
        "subject": {"value": None, "confidence": 0, "requiredReview": True},
        "from": {"value": None, "confidence": 0, "requiredReview": True},
        "to": {"value": None, "confidence": 0, "requiredReview": True},
        "department": {"value": None, "confidence": 0, "requiredReview": True},
        "priority": {"value": "Routine", "confidence": 0.5, "requiredReview": True},
        "dueDate": {"value": None, "confidence": 0, "requiredReview": False},
        "actionRequired": {"value": None, "confidence": 0, "requiredReview": True},
        "confidentiality": {"value": "Normal", "confidence": 0.5, "requiredReview": True},
        "remarks": {"value": "", "confidence": 0, "requiredReview": False},
        "summary": {"value": None, "confidence": 0, "requiredReview": False},
        "documentCategory": {"value": "Original Letter", "confidence": 0.6, "requiredReview": True},
        "relatedLetterNumbers": {"value": [], "confidence": 0, "requiredReview": True},
    }
    for key, val in overrides.items():
        base[key] = val
    return base


def _sample_llm_payload(**field_overrides: dict) -> dict:
    return {
        "schemaVersion": 1,
        "promptVersion": PROMPT_VERSION,
        "fields": _full_fields(**field_overrides),
        "evidence": [
            {
                "field": "number",
                "page": 1,
                "snippet": "Ref: MOIT/2026/1234",
                "confidence": 0.95,
            }
        ],
        "warnings": [],
    }


def _mock_llm_provider(payload: dict) -> MagicMock:
    provider = MagicMock()
    provider.provider_name = "ollama"
    provider.model_id = "qwen2.5:7b"
    provider.is_configured.return_value = True
    provider.complete_json = AsyncMock(return_value=payload)
    return provider


class AiRegistrationE2EMockedTest(unittest.TestCase):
    """Full pipeline on sample-01 with mocked LLM (CI-safe, no GPU)."""

    @classmethod
    def setUpClass(cls) -> None:
        if not _SAMPLE_01.is_file():
            raise unittest.SkipTest(f"missing fixture {_SAMPLE_01}")
        upgrade_ai_registration_schema(engine)
        cls._tmpdir = tempfile.TemporaryDirectory()
        cls._storage = Path(cls._tmpdir.name)
        get_settings.cache_clear()
        cls._settings = Settings(
            document_storage_path=str(cls._storage),
            ai_registration_enabled=True,
            ai_registration_worker_enabled=False,
            ocr_engine="pymupdf_text",
            llm_enabled=True,
            llm_provider="ollama",
            llm_base_url="http://127.0.0.1:11434/v1",
            llm_model="qwen2.5:7b",
            llm_input_max_chars=100_000,
            extraction_max_chars=24_000,
        )
        with patch("app.storage_service.get_settings", return_value=cls._settings):
            ensure_storage_dirs()

    @classmethod
    def tearDownClass(cls) -> None:
        get_settings.cache_clear()
        cls._tmpdir.cleanup()

    def setUp(self) -> None:
        self.db = SessionLocal()
        # Avoid worker/claim races with leftover QUEUED jobs from other tests.
        self.db.query(AiRegistrationJob).filter(
            AiRegistrationJob.status.in_(
                [JobStatus.QUEUED.value, JobStatus.PROCESSING.value]
            )
        ).delete(synchronize_session=False)
        self.db.commit()
        get_settings.cache_clear()
        self._patches = [
            patch("app.config.get_settings", return_value=self._settings),
            patch("app.storage_service.get_settings", return_value=self._settings),
            patch("app.ai.ocr_service.get_settings", return_value=self._settings),
            patch("app.ai.ocr_normalize.get_settings", return_value=self._settings),
            patch("app.ai.extraction_service.get_settings", return_value=self._settings),
            patch("app.ai.job_service.get_settings", return_value=self._settings),
            patch("app.ai.job_worker.get_settings", return_value=self._settings),
            patch("app.ai.llm_provider.get_settings", return_value=self._settings),
            patch("app.ai.review_service.current_user_name", return_value="e2e-tester"),
            patch("app.letter_create_service.current_user_name", return_value="e2e-tester"),
            patch("app.document_service.current_user_name", return_value="e2e-tester"),
            patch("app.correspondence_service.current_user_name", return_value="e2e-tester"),
            patch("app.ai.job_service.current_user_name", return_value="e2e-tester"),
            patch("app.ai.ingestion_service.current_user_name", return_value="e2e-tester"),
        ]
        for p in self._patches:
            p.start()
        self.accept_number = _unique_accept_number()
        self.edited_subject = f"E2E edited subject {uuid.uuid4().hex[:8]}"

    def tearDown(self) -> None:
        for p in self._patches:
            p.stop()
        self.db.rollback()
        self.db.close()
        get_settings.cache_clear()

    def _stage_sample_01(self):
        from fastapi import UploadFile
        from io import BytesIO

        content = _SAMPLE_01.read_bytes()
        upload = UploadFile(
            filename=_SAMPLE_01.name,
            file=BytesIO(content),
            headers={"content-type": "application/pdf"},
        )
        import asyncio

        return asyncio.run(stage_document_upload(self.db, upload=upload, source="e2e"))

    def _assert_artifacts_on_disk(self, job: AiRegistrationJob) -> None:
        self.assertTrue(job.ocr_artifact_key)
        self.assertTrue(job.normalized_artifact_key)
        self.assertTrue(job.extraction_artifact_key)
        self.assertTrue(job.validation_artifact_key)
        for key in (
            job.ocr_artifact_key,
            job.normalized_artifact_key,
            job.extraction_artifact_key,
            job.validation_artifact_key,
        ):
            path = resolve_storage_path(key)
            self.assertTrue(path.is_file(), f"missing artifact {key}")
            data = json.loads(path.read_text(encoding="utf-8"))
            self.assertIsInstance(data, dict)

        ocr = load_ocr_artifact(job.ocr_artifact_key)
        assert ocr is not None
        self.assertGreaterEqual(len(ocr.get("pages") or []), 1)
        page_text = (ocr["pages"][0].get("fullText") or "")
        self.assertIn("MOIT/2026/1234", page_text)

        validation = load_validation_artifact(job.validation_artifact_key)
        assert validation is not None
        self.assertIn("normalizedProposal", validation)
        self.assertIn("fieldIssues", validation)

    def test_mocked_pipeline_no_letter_before_approve_one_after(self) -> None:
        """Spec 12 M1: upload → NEEDS_REVIEW → edit → approve; SQL + artifacts."""
        letter_count_before = self.db.query(Letter).count()
        staged = self._stage_sample_01()
        self.db.commit()

        job = create_registration_job(self.db, staged_document_id=staged.id)
        self.db.commit()
        self.db.refresh(job)
        self.assertEqual(job.status, JobStatus.QUEUED.value)
        self.assertIsNone(job.letter_id)

        # No letter created between upload and approve.
        count_after_queue = self.db.execute(
            text("SELECT COUNT(*) FROM cms_letters WHERE number = :n"),
            {"n": self.accept_number},
        ).scalar()
        self.assertEqual(count_after_queue, 0)

        payload = _sample_llm_payload(
            number={"value": self.accept_number, "confidence": 0.95, "requiredReview": True},
            letterDate={"value": "2026-03-15", "confidence": 0.9, "requiredReview": True},
            receivedDate={"value": "2026-03-16", "confidence": 0.8, "requiredReview": False},
            subject={
                "value": "Request for quarterly progress update",
                "confidence": 0.9,
                "requiredReview": True,
            },
            dueDate={"value": "2026-03-30", "confidence": 0.8, "requiredReview": True},
            actionRequired={
                "value": "Acknowledge receipt by 30 March 2026",
                "confidence": 0.85,
                "requiredReview": True,
            },
            **{
                "from": {
                    "value": "Ministry of Information Technology",
                    "confidence": 0.9,
                    "requiredReview": True,
                },
                "to": {"value": "Planning Division", "confidence": 0.9, "requiredReview": True},
            },
        )
        provider = _mock_llm_provider(payload)

        run_ocr_stage(self.db, job, engine=PyMuPdfTextEngine())
        self.assertEqual(job.status, JobStatus.OCR_COMPLETE.value)
        run_normalize_stage(self.db, job)
        self.assertTrue(job.normalized_artifact_key)
        run_extraction_stage(self.db, job, provider=provider)
        self.assertEqual(job.status, JobStatus.EXTRACTION_COMPLETE.value)
        run_validation_stage(self.db, job)
        self.db.commit()
        self.db.refresh(job)

        self.assertEqual(job.status, JobStatus.NEEDS_REVIEW.value)
        self.assertIsNone(job.letter_id)
        self.assertEqual(self.db.query(Letter).count(), letter_count_before)
        self._assert_artifacts_on_disk(job)

        # Partial fixture subset still matches extraction schema shape.
        if _PARTIAL_EXTRACTION.is_file():
            partial = json.loads(_PARTIAL_EXTRACTION.read_text(encoding="utf-8"))
            extraction = json.loads(
                resolve_storage_path(job.extraction_artifact_key).read_text(encoding="utf-8")
            )
            LetterExtractionResult.model_validate(extraction)
            for key, expected_field in (partial.get("fields") or {}).items():
                # Number intentionally unique for E2E; other golden fields should match.
                if key == "number":
                    continue
                self.assertEqual(
                    extraction["fields"][key]["value"],
                    expected_field["value"],
                    msg=f"field {key}",
                )

        patch_proposal(self.db, job_id=job.id, updates={"subject": self.edited_subject})
        self.db.commit()
        self.db.refresh(job)
        proposal = json.loads(job.proposal_json)
        self.assertEqual(proposal["subject"], self.edited_subject)
        self.assertEqual(proposal["number"], self.accept_number)

        # Still no letter before approve.
        still_none = self.db.execute(
            text("SELECT COUNT(*) FROM cms_letters WHERE number = :n"),
            {"n": self.accept_number},
        ).scalar()
        self.assertEqual(still_none, 0)

        result = approve_registration_job(self.db, job_id=job.id, confirm=True)
        self.db.commit()
        self.db.refresh(job)

        self.assertEqual(job.status, JobStatus.REGISTERED.value)
        self.assertIsNotNone(job.letter_id)
        self.assertEqual(int(result["letterId"]), job.letter_id)

        row = self.db.execute(
            text(
                """
                SELECT l.number, l.subject, j.status, j.letter_id
                FROM cms_ai_registration_jobs j
                JOIN cms_letters l ON l.id = j.letter_id
                WHERE j.id = :jid
                """
            ),
            {"jid": job.id},
        ).one()
        self.assertEqual(row.number, self.accept_number)
        self.assertEqual(row.subject, self.edited_subject)
        self.assertEqual(row.status, JobStatus.REGISTERED.value)
        self.assertEqual(row.letter_id, job.letter_id)

        docs = (
            self.db.query(Document)
            .filter(Document.letter_id == job.letter_id)
            .all()
        )
        self.assertGreaterEqual(len(docs), 1)
        self.assertEqual(self.db.query(Letter).count(), letter_count_before + 1)

        # Exactly one letter with this acceptance number.
        accept_count = self.db.execute(
            text("SELECT COUNT(*) FROM cms_letters WHERE number = :n"),
            {"n": self.accept_number},
        ).scalar()
        self.assertEqual(accept_count, 1)

    def test_worker_cycle_with_mocked_stages_then_approve(self) -> None:
        """Alternate path: worker cycle with stage mocks still produces reviewable job."""
        staged = self._stage_sample_01()
        self.db.commit()
        job = create_registration_job(self.db, staged_document_id=staged.id)
        self.db.commit()
        self.db.refresh(job)
        letter_count = self.db.query(Letter).count()

        def _ocr(db, j):
            return run_ocr_stage(db, j, engine=PyMuPdfTextEngine())

        def _normalize(db, j):
            return run_normalize_stage(db, j)

        payload = _sample_llm_payload(
            number={"value": self.accept_number, "confidence": 0.95, "requiredReview": True},
            letterDate={"value": "2026-03-15", "confidence": 0.9, "requiredReview": True},
            subject={
                "value": "Worker cycle subject",
                "confidence": 0.9,
                "requiredReview": True,
            },
            **{
                "from": {
                    "value": "Ministry of Information Technology",
                    "confidence": 0.9,
                    "requiredReview": True,
                },
                "to": {"value": "Planning Division", "confidence": 0.9, "requiredReview": True},
            },
        )
        provider = _mock_llm_provider(payload)

        def _extract(db, j):
            return run_extraction_stage(db, j, provider=provider)

        def _validate(db, j):
            return run_validation_stage(db, j)

        with (
            patch("app.ai.job_worker.run_ocr_stage", side_effect=_ocr),
            patch("app.ai.job_worker.run_normalize_stage", side_effect=_normalize),
            patch("app.ai.job_worker.run_extraction_stage", side_effect=_extract),
            patch("app.ai.job_worker.run_validation_stage", side_effect=_validate),
            patch(
                "app.ai.job_worker.get_settings",
                return_value=Settings(
                    document_storage_path=str(self._storage),
                    ai_registration_enabled=True,
                    ai_registration_worker_enabled=True,
                    ocr_engine="pymupdf_text",
                ),
            ),
        ):
            stats = run_ai_registration_cycle()

        self.assertEqual(stats.get("claimed"), 1)
        self.assertEqual(stats.get("jobId"), job.id)
        self.assertEqual(stats.get("status"), JobStatus.NEEDS_REVIEW.value)
        self.db.expire_all()
        refreshed = self.db.query(AiRegistrationJob).filter_by(id=job.id).one()
        self.assertEqual(refreshed.status, JobStatus.NEEDS_REVIEW.value)
        self.assertEqual(self.db.query(Letter).count(), letter_count)

        result = approve_registration_job(self.db, job_id=job.id, confirm=True)
        self.db.commit()
        self.db.refresh(refreshed)
        self.assertEqual(refreshed.status, JobStatus.REGISTERED.value)
        self.assertEqual(int(result["letterId"]), refreshed.letter_id)


@pytest.mark.live
class AiRegistrationE2ELiveTest(unittest.TestCase):
    """Optional live acceptance — skipped unless Ollama is healthy."""

    def test_live_sample_01_reaches_needs_review_with_artifacts(self) -> None:
        import asyncio

        from app.ai.llm_provider import get_llm_provider
        from app.llm_client import llm_is_configured

        if not _SAMPLE_01.is_file():
            self.skipTest(f"missing fixture {_SAMPLE_01}")
        if not llm_is_configured():
            self.skipTest("LLM not configured")

        provider = get_llm_provider()
        health = asyncio.run(provider.health())
        if health.get("status") != "ok":
            self.skipTest(f"Ollama unhealthy: {health}")

        upgrade_ai_registration_schema(engine)
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        storage = Path(tmp.name)
        get_settings.cache_clear()
        settings = Settings(
            document_storage_path=str(storage),
            ai_registration_enabled=True,
            ai_registration_worker_enabled=False,
            ocr_engine="pymupdf_text",
            llm_enabled=True,
        )
        patches = [
            patch("app.config.get_settings", return_value=settings),
            patch("app.storage_service.get_settings", return_value=settings),
            patch("app.ai.ocr_service.get_settings", return_value=settings),
            patch("app.ai.ocr_normalize.get_settings", return_value=settings),
            patch("app.ai.extraction_service.get_settings", return_value=settings),
            patch("app.ai.job_service.get_settings", return_value=settings),
            patch("app.ai.llm_provider.get_settings", return_value=settings),
            patch("app.ai.job_service.current_user_name", return_value="live-e2e"),
            patch("app.ai.ingestion_service.current_user_name", return_value="live-e2e"),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

        with patch("app.storage_service.get_settings", return_value=settings):
            ensure_storage_dirs()

        db = SessionLocal()
        self.addCleanup(db.close)
        try:
            from io import BytesIO

            from fastapi import UploadFile

            content = _SAMPLE_01.read_bytes()
            upload = UploadFile(
                filename=_SAMPLE_01.name,
                file=BytesIO(content),
                headers={"content-type": "application/pdf"},
            )
            staged = asyncio.run(stage_document_upload(db, upload=upload, source="live-e2e"))
            job = create_registration_job(db, staged_document_id=staged.id)
            db.commit()
            db.refresh(job)

            run_ocr_stage(db, job, engine=PyMuPdfTextEngine())
            run_normalize_stage(db, job)
            run_extraction_stage(db, job, provider=provider)
            if job.status == JobStatus.FAILED.value:
                self.fail(f"live extraction failed: {job.error_code} {job.error_message}")
            run_validation_stage(db, job)
            db.commit()
            db.refresh(job)

            self.assertEqual(job.status, JobStatus.NEEDS_REVIEW.value)
            self.assertIsNone(job.letter_id)
            for key in (
                job.ocr_artifact_key,
                job.normalized_artifact_key,
                job.extraction_artifact_key,
                job.validation_artifact_key,
            ):
                self.assertTrue(key)
                self.assertTrue(resolve_storage_path(key).is_file())

            proposal = json.loads(job.proposal_json or "{}")
            # Soft: when the model finds a number, it should relate to the fixture ref.
            number = str(proposal.get("number") or "")
            if number:
                self.assertTrue(
                    "MOIT" in number.upper() or "2026" in number,
                    msg=f"unexpected live number: {number}",
                )
        finally:
            db.rollback()
            get_settings.cache_clear()


if __name__ == "__main__":
    unittest.main()
