"""AI registration job API + state machine tests (master plan step 4 / spec 10)."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import text

from app.ai.job_service import (
    create_registration_job,
    get_registration_job,
    retry_registration_job,
    serialize_job,
    serialize_job_create,
    transition_job,
)
from app.ai.job_states import (
    JobStatus,
    assert_transition,
    can_transition,
    current_stage,
    is_retryable,
)
from app.ai.job_worker import run_ai_registration_cycle
from app.config import Settings, get_settings
from app.database import SessionLocal, engine
from app.db_upgrade import upgrade_ai_registration_schema
from app.models import AiRegistrationJob, AiStagedDocument, Letter
from app.storage_service import ensure_storage_dirs


class JobStateMachineTest(unittest.TestCase):
    def test_queued_to_processing_allowed(self) -> None:
        self.assertTrue(can_transition(JobStatus.QUEUED, JobStatus.PROCESSING))
        assert_transition("QUEUED", "PROCESSING")

    def test_registered_is_terminal(self) -> None:
        self.assertFalse(can_transition(JobStatus.REGISTERED, JobStatus.QUEUED))
        with self.assertRaises(ValueError):
            assert_transition(JobStatus.REGISTERED, JobStatus.FAILED)

    def test_failed_retryable_to_queued(self) -> None:
        self.assertTrue(is_retryable(JobStatus.FAILED))
        self.assertTrue(can_transition(JobStatus.FAILED, JobStatus.QUEUED))

    def test_current_stage_hints(self) -> None:
        self.assertIsNone(current_stage(JobStatus.QUEUED))
        self.assertEqual(current_stage(JobStatus.PROCESSING), "ocr")
        self.assertEqual(current_stage(JobStatus.OCR_COMPLETE), "llm")
        self.assertEqual(current_stage(JobStatus.EXTRACTION_COMPLETE), "validation")
        self.assertIsNone(current_stage(JobStatus.NEEDS_REVIEW))


class JobApiIntegrationTest(unittest.TestCase):
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
        self._settings_patch = patch("app.config.get_settings", return_value=self._settings)
        self._settings_patch.start()
        self._job_service_settings = patch(
            "app.ai.job_service.get_settings", return_value=self._settings
        )
        self._job_service_settings.start()

    def tearDown(self) -> None:
        self._job_service_settings.stop()
        self._settings_patch.stop()
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

    def test_create_job_returns_queued_without_letter(self) -> None:
        staged = self._stage_doc()
        with patch("app.ai.job_service.current_user_name", return_value="tester"):
            job = create_registration_job(self.db, staged_document_id=staged.id)
            self.db.commit()
            self.db.refresh(job)

        self.assertEqual(job.status, JobStatus.QUEUED.value)
        self.assertEqual(job.staged_document_id, staged.id)
        self.assertIsNone(job.letter_id)
        self.assertEqual(job.error_code, "")
        self.assertEqual(job.error_message, "")

        created = serialize_job_create(job)
        self.assertEqual(created["jobId"], str(job.id))
        self.assertEqual(created["status"], "QUEUED")
        self.assertEqual(created["stagedDocumentId"], str(staged.id))

        payload = serialize_job(job)
        self.assertEqual(payload["status"], "QUEUED")
        self.assertIsNone(payload["currentStage"])
        self.assertFalse(payload["workerEnabled"])
        self.assertIsNone(payload["proposal"])

        self.assertEqual(self.db.query(Letter).count(), self._letter_count_before)

        with engine.connect() as conn:
            status = conn.execute(
                text("SELECT status FROM cms_ai_registration_jobs WHERE id = :id"),
                {"id": job.id},
            ).scalar()
        self.assertEqual(status, "QUEUED")

    def test_create_job_missing_staged_document_404(self) -> None:
        with patch("app.ai.job_service.current_user_name", return_value="tester"):
            with self.assertRaises(HTTPException) as ctx:
                create_registration_job(self.db, staged_document_id=2_147_483_647)
        self.assertEqual(ctx.exception.status_code, 404)

    def test_get_job_not_found(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            get_registration_job(self.db, 2_147_483_647)
        self.assertEqual(ctx.exception.status_code, 404)

    def test_retry_failed_job_requeues(self) -> None:
        staged = self._stage_doc()
        with patch("app.ai.job_service.current_user_name", return_value="tester"):
            job = create_registration_job(self.db, staged_document_id=staged.id)
            self.db.flush()
            transition_job(
                self.db,
                job,
                new_status=JobStatus.PROCESSING,
            )
            transition_job(
                self.db,
                job,
                new_status=JobStatus.FAILED,
                error_code="TEST",
                error_message="boom",
            )
            self.db.commit()
            self.db.refresh(job)

        self.assertEqual(job.status, JobStatus.FAILED.value)
        self.assertEqual(job.error_code, "TEST")

        with patch("app.ai.job_service.current_user_name", return_value="tester"):
            retried = retry_registration_job(self.db, job_id=job.id)
            self.db.commit()
            self.db.refresh(retried)

        self.assertEqual(retried.status, JobStatus.QUEUED.value)
        self.assertEqual(retried.error_code, "")
        self.assertEqual(retried.error_message, "")
        self.assertIsNone(retried.started_at)
        self.assertIsNone(retried.completed_at)

    def test_retry_queued_job_conflicts(self) -> None:
        staged = self._stage_doc()
        with patch("app.ai.job_service.current_user_name", return_value="tester"):
            job = create_registration_job(self.db, staged_document_id=staged.id)
            self.db.commit()
            with self.assertRaises(HTTPException) as ctx:
                retry_registration_job(self.db, job_id=job.id)
        self.assertEqual(ctx.exception.status_code, 409)

    def test_worker_disabled_leaves_job_queued(self) -> None:
        staged = self._stage_doc()
        with patch("app.ai.job_service.current_user_name", return_value="tester"):
            job = create_registration_job(self.db, staged_document_id=staged.id)
            self.db.commit()
            self.db.refresh(job)

        with patch("app.ai.job_worker.get_settings", return_value=self._settings):
            stats = run_ai_registration_cycle()
        self.assertEqual(stats.get("skipped"), "worker_disabled")
        self.assertEqual(stats.get("claimed"), 0)

        self.db.refresh(job)
        self.assertEqual(job.status, JobStatus.QUEUED.value)
        self.assertEqual(self.db.query(AiRegistrationJob).filter_by(id=job.id).one().status, "QUEUED")


if __name__ == "__main__":
    unittest.main()
