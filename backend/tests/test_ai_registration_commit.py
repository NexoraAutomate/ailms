"""AI registration commit tests (master plan step 12 / spec 08)."""

from __future__ import annotations

import json
import tempfile
import unittest
import uuid
from datetime import date
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import text

from app.ai.job_service import create_registration_job, transition_job
from app.ai.job_states import JobStatus
from app.ai.registration_commit import approve_registration_job
from app.config import Settings, get_settings
from app.database import SessionLocal, engine
from app.db_upgrade import upgrade_ai_registration_schema
from app.models import AiRegistrationJob, AiStagedDocument, AuditRecord, Document, Letter, LetterRelation
from app.storage_service import ensure_storage_dirs, resolve_storage_path


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


def _unique_number(prefix: str = "AI-REG") -> str:
    return f"{prefix}/{uuid.uuid4().hex[:12].upper()}"


class RegistrationCommitIntegrationTest(unittest.TestCase):
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
        get_settings.cache_clear()
        self._settings_patch = patch("app.config.get_settings", return_value=self._settings)
        self._settings_patch.start()
        self._patches = [
            patch("app.ai.job_service.get_settings", return_value=self._settings),
            patch("app.storage_service.get_settings", return_value=self._settings),
            patch("app.ai.review_service.current_user_name", return_value="tester"),
            patch("app.letter_create_service.current_user_name", return_value="tester"),
            patch("app.document_service.current_user_name", return_value="tester"),
            patch("app.correspondence_service.current_user_name", return_value="tester"),
        ]
        for p in self._patches:
            p.start()

    def tearDown(self) -> None:
        for p in self._patches:
            p.stop()
        self._settings_patch.stop()
        self.db.rollback()
        self.db.close()
        get_settings.cache_clear()

    def _stage_doc(self, *, uploaded_by: str = "tester") -> AiStagedDocument:
        row = AiStagedDocument(
            original_filename="sample.pdf",
            mime_type="application/pdf",
            file_size=len(_MINIMAL_PDF),
            checksum="abc123",
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
        number: str | None = None,
    ) -> AiRegistrationJob:
        number = number or _unique_number()
        staged = self._stage_doc(uploaded_by=created_by)
        with patch("app.ai.job_service.current_user_name", return_value=created_by):
            job = create_registration_job(self.db, staged_document_id=staged.id)
        transition_job(self.db, job, new_status=JobStatus.PROCESSING)
        transition_job(self.db, job, new_status=JobStatus.NEEDS_REVIEW)
        job.proposal_json = json.dumps(
            proposal
            or {
                "number": number,
                "subject": "AI commit subject",
                "letterDate": "2026-03-15",
                "receivedDate": "2026-03-16",
                "type": "Incoming",
                "priority": "Routine",
                "from": "Sender Org",
                "to": "Ministry",
                "department": "",
                "documentCategory": "Original Letter",
                "relatedLetterNumbers": [],
            },
            ensure_ascii=False,
        )
        self.db.commit()
        self.db.refresh(job)
        return job

    def test_no_letter_before_approve(self) -> None:
        number = _unique_number("AI-PRE")
        job = self._needs_review_job(number=number)
        self.assertIsNone(job.letter_id)
        self.assertEqual(job.status, JobStatus.NEEDS_REVIEW.value)
        count = self.db.execute(
            text("SELECT COUNT(*) FROM cms_letters WHERE number = :n"),
            {"n": number},
        ).scalar()
        self.assertEqual(count, 0)

    def test_approve_creates_letter_document_and_registers_job(self) -> None:
        number = _unique_number("AI-OK")
        job = self._needs_review_job(
            proposal={
                "number": number,
                "subject": "TEST-SUBJECT-123",
                "letterDate": "2026-03-01",
                "type": "Incoming",
                "priority": "Important",
                "from": "Unit A",
                "documentCategory": "Scanned Letter",
            }
        )
        letter_count_before = self.db.query(Letter).count()
        self.assertIsNone(job.letter_id)

        result = approve_registration_job(self.db, job_id=job.id, confirm=True)
        self.db.commit()
        self.db.refresh(job)

        self.assertEqual(result["status"], JobStatus.REGISTERED.value)
        self.assertEqual(result["number"], number)
        self.assertEqual(job.status, JobStatus.REGISTERED.value)
        self.assertIsNotNone(job.letter_id)
        self.assertEqual(str(job.letter_id), result["letterId"])
        self.assertEqual(job.approved_by, "tester")
        self.assertEqual(self.db.query(Letter).count(), letter_count_before + 1)

        letter = self.db.get(Letter, job.letter_id)
        assert letter is not None
        self.assertEqual(letter.subject, "TEST-SUBJECT-123")
        self.assertEqual(letter.number, number)
        self.assertEqual(letter.sender, "Unit A")

        docs = self.db.query(Document).filter(Document.letter_id == letter.id).all()
        self.assertEqual(len(docs), 1)
        self.assertEqual(docs[0].document_type, "Scanned Letter")
        versions = docs[0].versions
        self.assertTrue(versions)
        stored = resolve_storage_path(versions[0].storage_key)
        self.assertTrue(stored.is_file())
        staged_path = self._storage / f"ai/staging/{job.staged_document_id}/sample.pdf"
        self.assertTrue(staged_path.is_file())

        audits = (
            self.db.query(AuditRecord)
            .filter(
                AuditRecord.module == "AI Registration",
                AuditRecord.action == "Letter Registered via AI",
                AuditRecord.record == letter.number,
            )
            .all()
        )
        self.assertTrue(audits)

    def test_approve_duplicate_number_returns_409(self) -> None:
        number = _unique_number("AI-DUP")
        existing = Letter(
            number=number,
            letter_date=date(2026, 1, 1),
            received_date=date(2026, 1, 1),
            type="Incoming",
            subject="Existing",
            status="Registered",
        )
        self.db.add(existing)
        self.db.commit()

        job = self._needs_review_job(number=number)
        letter_count = self.db.query(Letter).count()
        with self.assertRaises(HTTPException) as ctx:
            approve_registration_job(self.db, job_id=job.id, confirm=True)
        self.assertEqual(ctx.exception.status_code, 409)
        self.db.rollback()
        self.db.refresh(job)
        self.assertEqual(job.status, JobStatus.NEEDS_REVIEW.value)
        self.assertIsNone(job.letter_id)
        self.assertEqual(self.db.query(Letter).count(), letter_count)

    def test_approve_wrong_status_returns_400(self) -> None:
        staged = self._stage_doc()
        with patch("app.ai.job_service.current_user_name", return_value="tester"):
            job = create_registration_job(self.db, staged_document_id=staged.id)
        self.db.commit()
        with self.assertRaises(HTTPException) as ctx:
            approve_registration_job(self.db, job_id=job.id, confirm=True)
        self.assertEqual(ctx.exception.status_code, 400)

    def test_approve_requires_confirm(self) -> None:
        job = self._needs_review_job()
        with self.assertRaises(HTTPException) as ctx:
            approve_registration_job(self.db, job_id=job.id, confirm=False)
        self.assertEqual(ctx.exception.status_code, 422)

    def test_approve_links_related_letter_when_found(self) -> None:
        related_number = _unique_number("AI-REL")
        related = Letter(
            number=related_number,
            letter_date=date(2025, 12, 1),
            received_date=date(2025, 12, 1),
            type="Incoming",
            subject="Related prior",
            status="Registered",
        )
        self.db.add(related)
        self.db.commit()

        number = _unique_number("AI-MAIN")
        job = self._needs_review_job(
            proposal={
                "number": number,
                "subject": "With relation",
                "letterDate": "2026-04-01",
                "type": "Incoming",
                "priority": "Routine",
                "relatedLetterNumbers": [related_number, "MISSING-NUM"],
            },
        )
        result = approve_registration_job(self.db, job_id=job.id, confirm=True)
        self.db.commit()
        self.assertTrue(any("MISSING-NUM" in w for w in result.get("warnings") or []))
        letter = self.db.get(Letter, int(result["letterId"]))
        assert letter is not None
        rels = (
            self.db.query(LetterRelation)
            .filter(LetterRelation.from_letter_id == letter.id)
            .all()
        )
        self.assertEqual(len(rels), 1)
        self.assertEqual(rels[0].to_letter_id, related.id)


if __name__ == "__main__":
    unittest.main()
