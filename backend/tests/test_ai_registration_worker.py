"""AI registration background worker tests (master plan step 9 / spec 10)."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from app.ai.job_service import create_registration_job
from app.ai.job_states import JobStatus
from app.ai.job_worker import (
    claim_next_queued_job,
    process_one_job,
    run_ai_registration_cycle,
)
from app.config import Settings, get_settings
from app.database import SessionLocal, engine
from app.db_upgrade import upgrade_ai_registration_schema
from app.models import AiRegistrationJob, AiStagedDocument, Letter
from app.storage_service import ensure_storage_dirs


def _advance_ocr(db, job: AiRegistrationJob) -> AiRegistrationJob:
    from app.ai.job_service import transition_job

    if job.status == JobStatus.QUEUED.value:
        transition_job(db, job, new_status=JobStatus.PROCESSING)
    if job.status == JobStatus.PROCESSING.value:
        transition_job(db, job, new_status=JobStatus.OCR_COMPLETE)
    job.ocr_artifact_key = f"ai/jobs/{job.id}/ocr-output.json"
    db.flush()
    return job


def _advance_normalize(db, job: AiRegistrationJob) -> AiRegistrationJob:
    job.normalized_artifact_key = f"ai/jobs/{job.id}/llm-input.json"
    db.flush()
    return job


def _advance_extract(db, job: AiRegistrationJob) -> AiRegistrationJob:
    from app.ai.job_service import transition_job

    transition_job(db, job, new_status=JobStatus.EXTRACTION_COMPLETE)
    job.extraction_artifact_key = f"ai/jobs/{job.id}/extraction-result.json"
    job.proposal_json = '{"number":"MOIT/2026/1234"}'
    db.flush()
    return job


def _advance_validate(db, job: AiRegistrationJob) -> AiRegistrationJob:
    from app.ai.job_service import transition_job

    transition_job(db, job, new_status=JobStatus.NEEDS_REVIEW)
    job.validation_artifact_key = f"ai/jobs/{job.id}/validation-result.json"
    db.flush()
    return job


class WorkerPipelineTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        upgrade_ai_registration_schema(engine)
        cls._tmpdir = tempfile.TemporaryDirectory()
        cls._storage = Path(cls._tmpdir.name)
        get_settings.cache_clear()
        cls._settings_enabled = Settings(
            document_storage_path=str(cls._storage),
            ai_registration_enabled=True,
            ai_registration_worker_enabled=True,
            ai_registration_worker_poll_seconds=0.1,
        )
        cls._settings_disabled = Settings(
            document_storage_path=str(cls._storage),
            ai_registration_enabled=True,
            ai_registration_worker_enabled=False,
        )
        with patch("app.storage_service.get_settings", return_value=cls._settings_enabled):
            ensure_storage_dirs()

    @classmethod
    def tearDownClass(cls) -> None:
        get_settings.cache_clear()
        cls._tmpdir.cleanup()

    def setUp(self) -> None:
        self.db = SessionLocal()
        # Worker claims oldest QUEUED row — clear leftovers from prior runs/tests.
        self.db.query(AiRegistrationJob).filter(
            AiRegistrationJob.status.in_(
                [JobStatus.QUEUED.value, JobStatus.PROCESSING.value]
            )
        ).delete(synchronize_session=False)
        self.db.commit()
        self._letter_count_before = self.db.query(Letter).count()
        get_settings.cache_clear()
        self._patches = [
            patch("app.config.get_settings", return_value=self._settings_enabled),
            patch("app.ai.job_worker.get_settings", return_value=self._settings_enabled),
            patch("app.ai.job_service.get_settings", return_value=self._settings_enabled),
            patch("app.storage_service.get_settings", return_value=self._settings_enabled),
        ]
        for p in self._patches:
            p.start()

    def tearDown(self) -> None:
        for p in self._patches:
            p.stop()
        self.db.rollback()
        self.db.close()
        get_settings.cache_clear()

    def _stage_doc(self) -> AiStagedDocument:
        row = AiStagedDocument(
            original_filename="sample.pdf",
            mime_type="application/pdf",
            file_size=12,
            checksum="abc",
            storage_key="ai/staging/tmp/sample.pdf",
            uploaded_by="tester",
        )
        self.db.add(row)
        self.db.flush()
        return row

    def test_queued_to_needs_review(self) -> None:
        """Acceptance: worker drains QUEUED → NEEDS_REVIEW with mocked stages."""
        staged = self._stage_doc()
        with patch("app.ai.job_service.current_user_name", return_value="tester"):
            job = create_registration_job(self.db, staged_document_id=staged.id)
            self.db.commit()
            self.db.refresh(job)

        self.assertEqual(job.status, JobStatus.QUEUED.value)
        letter_count = self.db.query(Letter).count()

        with (
            patch("app.ai.job_worker.run_ocr_stage", side_effect=_advance_ocr),
            patch("app.ai.job_worker.run_normalize_stage", side_effect=_advance_normalize),
            patch("app.ai.job_worker.run_extraction_stage", side_effect=_advance_extract),
            patch("app.ai.job_worker.run_validation_stage", side_effect=_advance_validate),
        ):
            stats = run_ai_registration_cycle()

        self.assertEqual(stats.get("claimed"), 1)
        self.assertEqual(stats.get("jobId"), job.id)
        self.assertEqual(stats.get("status"), JobStatus.NEEDS_REVIEW.value)

        self.db.expire_all()
        refreshed = self.db.query(AiRegistrationJob).filter_by(id=job.id).one()
        self.assertEqual(refreshed.status, JobStatus.NEEDS_REVIEW.value)
        self.assertIsNotNone(refreshed.started_at)
        self.assertIsNotNone(refreshed.ocr_completed_at)
        self.assertIsNotNone(refreshed.extraction_completed_at)
        self.assertIsNotNone(refreshed.review_ready_at)
        self.assertEqual(self.db.query(Letter).count(), letter_count)

    def test_worker_disabled_leaves_job_queued(self) -> None:
        staged = self._stage_doc()
        with patch("app.ai.job_service.current_user_name", return_value="tester"):
            job = create_registration_job(self.db, staged_document_id=staged.id)
            self.db.commit()
            self.db.refresh(job)

        with patch(
            "app.ai.job_worker.get_settings", return_value=self._settings_disabled
        ):
            stats = run_ai_registration_cycle()

        self.assertEqual(stats.get("skipped"), "worker_disabled")
        self.assertEqual(stats.get("claimed"), 0)
        self.db.refresh(job)
        self.assertEqual(job.status, JobStatus.QUEUED.value)

    def test_claim_marks_processing(self) -> None:
        staged = self._stage_doc()
        with patch("app.ai.job_service.current_user_name", return_value="tester"):
            job = create_registration_job(self.db, staged_document_id=staged.id)
            self.db.flush()

        claimed = claim_next_queued_job(self.db)
        self.assertIsNotNone(claimed)
        assert claimed is not None
        self.assertEqual(claimed.id, job.id)
        self.assertEqual(claimed.status, JobStatus.PROCESSING.value)
        self.assertIsNotNone(claimed.started_at)

        second = claim_next_queued_job(self.db)
        self.assertIsNone(second)

    def test_pipeline_crash_marks_failed(self) -> None:
        staged = self._stage_doc()
        with patch("app.ai.job_service.current_user_name", return_value="tester"):
            job = create_registration_job(self.db, staged_document_id=staged.id)
            self.db.commit()
            self.db.refresh(job)

        with patch(
            "app.ai.job_worker.run_ocr_stage",
            side_effect=RuntimeError("simulated OCR boom"),
        ):
            stats = run_ai_registration_cycle()

        self.assertEqual(stats.get("claimed"), 1)
        self.assertEqual(stats.get("status"), JobStatus.FAILED.value)
        self.assertEqual(stats.get("error"), "WORKER_CRASH")

        self.db.expire_all()
        refreshed = self.db.query(AiRegistrationJob).filter_by(id=job.id).one()
        self.assertEqual(refreshed.status, JobStatus.FAILED.value)
        self.assertEqual(refreshed.error_code, "WORKER_CRASH")
        self.assertIn("simulated OCR boom", refreshed.error_message or "")

    def test_process_one_job_stops_on_failed_ocr(self) -> None:
        staged = self._stage_doc()
        with patch("app.ai.job_service.current_user_name", return_value="tester"):
            job = create_registration_job(self.db, staged_document_id=staged.id)
            self.db.flush()
        claim_next_queued_job(self.db)

        def fail_ocr(db, job_row: AiRegistrationJob) -> AiRegistrationJob:
            from app.ai.job_service import transition_job

            transition_job(
                db,
                job_row,
                new_status=JobStatus.FAILED,
                error_code="OCR_ENGINE_ERROR",
                error_message="nope",
            )
            return job_row

        normalize = MagicMock()
        with (
            patch("app.ai.job_worker.run_ocr_stage", side_effect=fail_ocr),
            patch("app.ai.job_worker.run_normalize_stage", normalize),
        ):
            process_one_job(self.db, job)

        normalize.assert_not_called()
        self.assertEqual(job.status, JobStatus.FAILED.value)


if __name__ == "__main__":
    unittest.main()
