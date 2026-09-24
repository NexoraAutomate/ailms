"""AI registration review API tests (master plan step 10 / spec 07)."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import text

from app.ai.job_service import create_registration_job, transition_job
from app.ai.job_states import JobStatus
from app.ai.review_service import (
    assert_job_access,
    enrich_job_payload,
    get_staged_document_for_preview,
    patch_proposal,
    reject_job,
    request_rerun,
)
from app.config import Settings, get_settings
from app.database import SessionLocal, engine
from app.db_upgrade import upgrade_ai_registration_schema
from app.models import AiRegistrationJob, AiStagedDocument, AuditRecord, Letter
from app.storage_service import ensure_storage_dirs


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


class ReviewApiIntegrationTest(unittest.TestCase):
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
        self._storage_settings = patch(
            "app.storage_service.get_settings", return_value=self._settings
        )
        self._storage_settings.start()

    def tearDown(self) -> None:
        self._storage_settings.stop()
        self._job_service_settings.stop()
        self._settings_patch.stop()
        self.db.rollback()
        self.db.close()
        get_settings.cache_clear()

    def _stage_doc(self, *, uploaded_by: str = "tester") -> AiStagedDocument:
        row = AiStagedDocument(
            original_filename="sample.pdf",
            mime_type="application/pdf",
            file_size=len(_MINIMAL_PDF),
            checksum="abc",
            storage_key="pending",
            uploaded_by=uploaded_by,
        )
        self.db.add(row)
        self.db.flush()
        key = f"ai/staging/{row.id}/sample.pdf"
        path = self._storage / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(_MINIMAL_PDF)
        row.storage_key = key
        self.db.flush()
        return row

    def _needs_review_job(
        self,
        *,
        proposal: dict | None = None,
        created_by: str = "tester",
    ) -> AiRegistrationJob:
        staged = self._stage_doc(uploaded_by=created_by)
        with patch("app.ai.job_service.current_user_name", return_value=created_by):
            job = create_registration_job(self.db, staged_document_id=staged.id)
        transition_job(self.db, job, new_status=JobStatus.PROCESSING)
        transition_job(self.db, job, new_status=JobStatus.NEEDS_REVIEW)
        job.proposal_json = json.dumps(
            proposal
            or {
                "number": "MOIT/2026/1234",
                "subject": "Original subject",
                "letterDate": "2026-03-01",
                "type": "Incoming",
                "priority": "Normal",
            },
            ensure_ascii=False,
        )
        self.db.commit()
        self.db.refresh(job)
        return job

    def test_patch_proposal_updates_get_and_tracks_overrides(self) -> None:
        job = self._needs_review_job()
        letter_count = self.db.query(Letter).count()

        with patch("app.ai.review_service.current_user_name", return_value="tester"):
            patched = patch_proposal(
                self.db,
                job_id=job.id,
                updates={"subject": "TEST-SUBJECT-123"},
            )
            self.db.commit()
            self.db.refresh(patched)

        proposal = json.loads(patched.proposal_json)
        self.assertEqual(proposal["subject"], "TEST-SUBJECT-123")
        self.assertEqual(proposal["number"], "MOIT/2026/1234")
        self.assertIn("subject", proposal["userOverrides"])
        self.assertEqual(proposal["userOverrides"]["subject"]["from"], "Original subject")
        self.assertEqual(proposal["userOverrides"]["subject"]["to"], "TEST-SUBJECT-123")
        self.assertEqual(proposal["userOverrides"]["subject"]["by"], "tester")
        self.assertEqual(patched.reviewed_by, "tester")

        with patch("app.ai.review_service.current_user_name", return_value="tester"):
            payload = enrich_job_payload(self.db, patched)
        self.assertEqual(payload["proposal"]["subject"], "TEST-SUBJECT-123")
        self.assertEqual(payload["userOverrides"]["subject"]["to"], "TEST-SUBJECT-123")
        self.assertEqual(payload["stagedDocument"]["id"], str(job.staged_document_id))
        self.assertIn("/preview", payload["stagedDocument"]["previewUrl"])

        self.assertEqual(self.db.query(Letter).count(), letter_count)
        self.assertIsNone(patched.letter_id)

        audits = (
            self.db.query(AuditRecord)
            .filter(
                AuditRecord.module == "AI Registration",
                AuditRecord.action == "Proposal Edited",
                AuditRecord.record == str(job.id),
            )
            .all()
        )
        self.assertTrue(audits)

    def test_patch_strips_html_and_rejects_unknown_fields(self) -> None:
        job = self._needs_review_job()
        with patch("app.ai.review_service.current_user_name", return_value="tester"):
            patched = patch_proposal(
                self.db,
                job_id=job.id,
                updates={"subject": "<b>Safe</b> text"},
            )
            self.db.commit()
            self.db.refresh(patched)
            with self.assertRaises(HTTPException) as ctx:
                patch_proposal(self.db, job_id=job.id, updates={"notAField": "x"})
        self.assertEqual(ctx.exception.status_code, 422)
        self.assertEqual(json.loads(patched.proposal_json)["subject"], "Safe text")

    def test_patch_only_when_needs_review(self) -> None:
        staged = self._stage_doc()
        with patch("app.ai.job_service.current_user_name", return_value="tester"):
            job = create_registration_job(self.db, staged_document_id=staged.id)
            self.db.commit()
        with patch("app.ai.review_service.current_user_name", return_value="tester"):
            with self.assertRaises(HTTPException) as ctx:
                patch_proposal(self.db, job_id=job.id, updates={"subject": "x"})
        self.assertEqual(ctx.exception.status_code, 409)

    def test_reject_sets_status_without_letter(self) -> None:
        job = self._needs_review_job()
        letter_count = self.db.query(Letter).count()

        with patch("app.ai.review_service.current_user_name", return_value="tester"):
            rejected = reject_job(self.db, job_id=job.id, reason="Not useful")
            self.db.commit()
            self.db.refresh(rejected)

        self.assertEqual(rejected.status, JobStatus.REJECTED.value)
        self.assertEqual(rejected.error_message, "Not useful")
        self.assertIsNone(rejected.letter_id)
        self.assertEqual(self.db.query(Letter).count(), letter_count)
        self.assertTrue(rejected.proposal_json)  # artifacts / proposal retained

        with engine.connect() as conn:
            status = conn.execute(
                text("SELECT status FROM cms_ai_registration_jobs WHERE id = :id"),
                {"id": job.id},
            ).scalar()
        self.assertEqual(status, "REJECTED")

    def test_rerun_requeues_from_needs_review(self) -> None:
        job = self._needs_review_job()
        with patch("app.ai.review_service.current_user_name", return_value="tester"):
            rerun = request_rerun(self.db, job_id=job.id)
            self.db.commit()
            self.db.refresh(rerun)

        self.assertEqual(rerun.status, JobStatus.QUEUED.value)
        self.assertEqual(rerun.proposal_json, "")
        self.assertIsNone(rerun.letter_id)
        self.assertEqual(self.db.query(Letter).count(), self._letter_count_before)

    def test_ownership_blocks_other_user(self) -> None:
        job = self._needs_review_job(created_by="owner-user")
        with patch("app.ai.review_service.current_user_name", return_value="other-user"):
            with patch("app.ai.review_service.resolve_user_role", return_value="Department/User"):
                with self.assertRaises(HTTPException) as ctx:
                    assert_job_access(self.db, job)
                self.assertEqual(ctx.exception.status_code, 403)
                with self.assertRaises(HTTPException) as ctx2:
                    patch_proposal(self.db, job_id=job.id, updates={"subject": "hack"})
                self.assertEqual(ctx2.exception.status_code, 403)

    def test_admin_can_access_other_users_job(self) -> None:
        job = self._needs_review_job(created_by="owner-user")
        with patch("app.ai.review_service.current_user_name", return_value="admin-user"):
            with patch("app.ai.review_service.resolve_user_role", return_value="Administrator"):
                assert_job_access(self.db, job)
                patched = patch_proposal(
                    self.db, job_id=job.id, updates={"subject": "Admin edit"}
                )
                self.db.commit()
        self.assertEqual(json.loads(patched.proposal_json)["subject"], "Admin edit")

    def test_staged_preview_resolves_file(self) -> None:
        job = self._needs_review_job()
        with patch("app.ai.review_service.current_user_name", return_value="tester"):
            staged, path = get_staged_document_for_preview(self.db, job.staged_document_id)
        self.assertEqual(staged.id, job.staged_document_id)
        self.assertTrue(path.is_file())
        self.assertEqual(path.read_bytes(), _MINIMAL_PDF)


if __name__ == "__main__":
    unittest.main()
