"""AI registration validation tests (master plan step 8 / spec 06)."""

from __future__ import annotations

import json
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from app.ai.extraction_schema import PROMPT_VERSION
from app.ai.extraction_service import write_extraction_artifact
from app.ai.job_service import create_registration_job, serialize_job
from app.ai.job_states import JobStatus
from app.ai.validation_service import (
    load_validation_artifact,
    run_validation_stage,
    strip_html,
    validate_extraction,
)
from app.config import Settings, get_settings
from app.database import SessionLocal, engine
from app.db_upgrade import upgrade_ai_registration_schema
from app.models import AiRegistrationJob, AiStagedDocument, Letter
from app.storage_service import ensure_storage_dirs, resolve_storage_path

_REPO_ROOT = Path(__file__).resolve().parents[2]
_PARTIAL_01 = (
    _REPO_ROOT
    / "fixtures"
    / "ai-letter-registration"
    / "expected"
    / "sample-01-extraction.partial.json"
)


def _full_fields(**overrides: dict) -> dict:
    base = {
        "number": {"value": "MOIT/2026/1234", "confidence": 0.9, "requiredReview": True},
        "letterDate": {"value": "2026-03-15", "confidence": 0.9, "requiredReview": True},
        "receivedDate": {"value": None, "confidence": 0, "requiredReview": False},
        "type": {"value": "Incoming", "confidence": 0.8, "requiredReview": True},
        "subject": {
            "value": "Request for quarterly progress update",
            "confidence": 0.9,
            "requiredReview": True,
        },
        "from": {
            "value": "Ministry of Information Technology",
            "confidence": 0.85,
            "requiredReview": True,
        },
        "to": {"value": "Planning Division", "confidence": 0.85, "requiredReview": True},
        "department": {"value": "Coordination", "confidence": 0.7, "requiredReview": True},
        "priority": {"value": "Routine", "confidence": 0.8, "requiredReview": True},
        "dueDate": {"value": "2026-03-30", "confidence": 0.7, "requiredReview": True},
        "actionRequired": {
            "value": "Acknowledge receipt by 30 March 2026",
            "confidence": 0.8,
            "requiredReview": True,
        },
        "confidentiality": {"value": "Normal", "confidence": 0.7, "requiredReview": True},
        "remarks": {"value": "", "confidence": 0, "requiredReview": False},
        "summary": {"value": "Quarterly progress update request", "confidence": 0.6, "requiredReview": False},
        "documentCategory": {"value": "Original Letter", "confidence": 0.7, "requiredReview": True},
        "relatedLetterNumbers": {"value": [], "confidence": 0, "requiredReview": True},
    }
    for key, val in overrides.items():
        base[key] = val
    return base


def _extraction(**field_overrides: dict) -> dict:
    return {
        "schemaVersion": 1,
        "promptVersion": PROMPT_VERSION,
        "fields": _full_fields(**field_overrides),
        "evidence": [],
        "warnings": [],
    }


class StripHtmlTest(unittest.TestCase):
    def test_strips_script_tags(self) -> None:
        self.assertEqual(strip_html('<script>alert(1)</script>Hello'), "Hello")
        self.assertEqual(strip_html("<b>plain</b>"), "plain")
        self.assertEqual(strip_html("plain"), "plain")


class ValidateExtractionUnitTest(unittest.TestCase):
    def test_unknown_department_issue(self) -> None:
        result = validate_extraction(
            _extraction(department={"value": "NotARealDept", "confidence": 0.5, "requiredReview": True}),
            db=None,
            job_id="7",
            masters={
                "letterTypes": ["Incoming", "Outgoing", "Internal Memo"],
                "priorities": ["Routine", "Important", "Urgent"],
                "confidentiality": ["Normal", "Confidential", "Restricted"],
                "documentCategories": ["Original Letter"],
                "departments": ["Coordination", "Technical", "Finance"],
            },
        )
        self.assertFalse(result["passed"])
        issues = result["fieldIssues"].get("department") or []
        self.assertTrue(any(i["code"] == "UNKNOWN_DEPARTMENT" for i in issues))
        # Raw extracted value retained for human pick.
        self.assertEqual(result["normalizedProposal"]["department"], "NotARealDept")

    def test_invalid_priority_cleared(self) -> None:
        result = validate_extraction(
            _extraction(priority={"value": "SuperUrgent", "confidence": 0.99, "requiredReview": True}),
            db=None,
            job_id="7",
            masters={
                "letterTypes": ["Incoming"],
                "priorities": ["Routine", "Important", "Urgent"],
                "confidentiality": ["Normal"],
                "documentCategories": ["Original Letter"],
                "departments": ["Coordination"],
            },
        )
        self.assertFalse(result["passed"])
        issues = result["fieldIssues"].get("priority") or []
        self.assertTrue(any(i["code"] == "UNKNOWN_PRIORITY" for i in issues))
        self.assertEqual(result["normalizedProposal"]["priority"], "")
        self.assertIsNone(result["normalizedFields"]["priority"]["value"])

    def test_oversized_subject_truncated(self) -> None:
        long_subject = "A" * 500
        result = validate_extraction(
            _extraction(subject={"value": long_subject, "confidence": 0.9, "requiredReview": True}),
            db=None,
            masters={
                "letterTypes": ["Incoming"],
                "priorities": ["Routine"],
                "confidentiality": ["Normal"],
                "documentCategories": ["Original Letter"],
                "departments": ["Coordination"],
            },
        )
        issues = result["fieldIssues"].get("subject") or []
        self.assertTrue(any(i["code"] == "SUBJECT_TOO_LONG" for i in issues))
        self.assertEqual(len(result["normalizedProposal"]["subject"]), 400)

    def test_invalid_date_flagged(self) -> None:
        result = validate_extraction(
            _extraction(letterDate={"value": "2026-13-40", "confidence": 0.5, "requiredReview": True}),
            db=None,
            masters={
                "letterTypes": ["Incoming"],
                "priorities": ["Routine"],
                "confidentiality": ["Normal"],
                "documentCategories": ["Original Letter"],
                "departments": [],
            },
        )
        issues = result["fieldIssues"].get("letterDate") or []
        self.assertTrue(any(i["code"] == "INVALID_DATE" for i in issues))
        self.assertIsNone(result["normalizedProposal"]["letterDate"])

    def test_html_stripped_from_strings(self) -> None:
        result = validate_extraction(
            _extraction(
                subject={
                    "value": "<b>Request</b> for update<script>x</script>",
                    "confidence": 0.9,
                    "requiredReview": True,
                }
            ),
            db=None,
            masters={
                "letterTypes": ["Incoming"],
                "priorities": ["Routine"],
                "confidentiality": ["Normal"],
                "documentCategories": ["Original Letter"],
                "departments": ["Coordination"],
            },
        )
        self.assertNotIn("<", result["normalizedProposal"]["subject"])
        self.assertIn("Request", result["normalizedProposal"]["subject"])

    def test_valid_sample_01_passes(self) -> None:
        payload = _extraction()
        if _PARTIAL_01.is_file():
            partial = json.loads(_PARTIAL_01.read_text(encoding="utf-8"))
            for key, val in (partial.get("fields") or {}).items():
                merged = dict(payload["fields"][key])
                merged.update(val)
                payload["fields"][key] = merged

        result = validate_extraction(
            payload,
            db=None,
            job_id="1",
            masters={
                "letterTypes": ["Incoming", "Outgoing", "Internal Memo"],
                "priorities": ["Routine", "Important", "Urgent"],
                "confidentiality": ["Normal", "Confidential", "Restricted"],
                "documentCategories": ["Original Letter", "Scanned Letter"],
                "departments": ["Coordination", "Technical", "Finance"],
            },
        )
        self.assertTrue(result["passed"], msg=result)
        self.assertEqual(result["blockingErrors"], [])
        self.assertEqual(result["fieldIssues"], {})
        self.assertEqual(result["normalizedProposal"]["number"], "MOIT/2026/1234")
        self.assertEqual(result["normalizedProposal"]["letterDate"], "2026-03-15")
        self.assertEqual(result["normalizedProposal"]["priority"], "Routine")

    def test_case_insensitive_master_canonicalize(self) -> None:
        result = validate_extraction(
            _extraction(priority={"value": "urgent", "confidence": 0.9, "requiredReview": True}),
            db=None,
            masters={
                "letterTypes": ["Incoming"],
                "priorities": ["Routine", "Important", "Urgent"],
                "confidentiality": ["Normal"],
                "documentCategories": ["Original Letter"],
                "departments": ["Coordination"],
            },
        )
        self.assertEqual(result["normalizedProposal"]["priority"], "Urgent")
        self.assertNotIn("priority", result["fieldIssues"])


class ValidationStageIntegrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        upgrade_ai_registration_schema(engine)
        cls._tmpdir = tempfile.TemporaryDirectory()
        get_settings.cache_clear()
        cls._settings = Settings(
            document_storage_path=cls._tmpdir.name,
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
        self._patches = [
            patch("app.config.get_settings", return_value=self._settings),
            patch("app.storage_service.get_settings", return_value=self._settings),
            patch("app.ai.job_service.get_settings", return_value=self._settings),
            patch("app.ai.validation_service.load_master_hints", return_value={
                "letterTypes": ["Incoming", "Outgoing", "Internal Memo"],
                "priorities": ["Routine", "Important", "Urgent"],
                "confidentiality": ["Normal", "Confidential", "Restricted"],
                "documentCategories": ["Original Letter", "Scanned Letter"],
                "departments": ["Coordination", "Technical", "Finance"],
            }),
        ]
        for p in self._patches:
            p.start()

    def tearDown(self) -> None:
        for p in self._patches:
            p.stop()
        self.db.rollback()
        self.db.close()
        get_settings.cache_clear()

    def _job_with_extraction(self, payload: dict) -> AiRegistrationJob:
        row = AiStagedDocument(
            original_filename="synthetic.pdf",
            mime_type="application/pdf",
            file_size=10,
            checksum="abc",
            storage_key="pending",
            uploaded_by="tester",
        )
        self.db.add(row)
        self.db.flush()
        key = f"ai/staging/{row.id}/synthetic.pdf"
        path = resolve_storage_path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"%PDF-1.4 synthetic")
        row.storage_key = key
        self.db.flush()

        with patch("app.ai.job_service.current_user_name", return_value="tester"):
            job = create_registration_job(self.db, staged_document_id=row.id)
            self.db.flush()

        job.status = JobStatus.EXTRACTION_COMPLETE.value
        artifact = dict(payload)
        artifact["jobId"] = str(job.id)
        job.extraction_artifact_key = write_extraction_artifact(job.id, artifact)
        self.db.flush()
        return job

    def test_stage_writes_validation_result_and_needs_review(self) -> None:
        job = self._job_with_extraction(_extraction())
        run_validation_stage(self.db, job)
        self.db.commit()
        self.db.refresh(job)

        self.assertEqual(job.status, JobStatus.NEEDS_REVIEW.value)
        self.assertTrue(job.validation_artifact_key.endswith("validation-result.json"))
        self.assertIsNotNone(job.review_ready_at)

        artifact = load_validation_artifact(job.validation_artifact_key)
        self.assertIsNotNone(artifact)
        assert artifact is not None
        self.assertTrue(artifact["passed"])
        self.assertEqual(artifact["schemaVersion"], 1)

        proposal = json.loads(job.proposal_json)
        self.assertEqual(proposal["number"], "MOIT/2026/1234")
        self.assertEqual(proposal["subject"], "Request for quarterly progress update")

        # No letter created at validation (approve is step 12).
        self.assertEqual(self.db.query(Letter).count(), self._letter_count_before)

        serialized = serialize_job(job)
        self.assertIsNotNone(serialized.get("validation"))
        self.assertTrue(serialized["validation"]["passed"])
        self.assertEqual(serialized["status"], "NEEDS_REVIEW")

    def test_duplicate_number_blocking_error(self) -> None:
        dup_number = f"AI-VAL-DUP-{self._letter_count_before + 1}"
        letter = Letter(
            number=dup_number,
            letter_date=date(2026, 1, 1),
            received_date=date(2026, 1, 2),
            subject="Existing letter",
        )
        self.db.add(letter)
        self.db.flush()

        job = self._job_with_extraction(
            _extraction(number={"value": dup_number, "confidence": 0.9, "requiredReview": True})
        )
        run_validation_stage(self.db, job)
        self.db.flush()
        self.db.refresh(job)

        # Still NEEDS_REVIEW so human can change the number.
        self.assertEqual(job.status, JobStatus.NEEDS_REVIEW.value)
        artifact = load_validation_artifact(job.validation_artifact_key)
        assert artifact is not None
        self.assertFalse(artifact["passed"])
        codes = [e["code"] for e in artifact["blockingErrors"]]
        self.assertIn("DUPLICATE_NUMBER", codes)
        field_codes = [i["code"] for i in (artifact["fieldIssues"].get("number") or [])]
        self.assertIn("DUPLICATE_NUMBER", field_codes)
        # Leave letter uncommitted — tearDown rollback cleans it up.

    def test_unknown_priority_still_needs_review(self) -> None:
        job = self._job_with_extraction(
            _extraction(priority={"value": "SuperUrgent", "confidence": 0.99, "requiredReview": True})
        )
        run_validation_stage(self.db, job)
        self.db.commit()
        self.db.refresh(job)

        self.assertEqual(job.status, JobStatus.NEEDS_REVIEW.value)
        artifact = load_validation_artifact(job.validation_artifact_key)
        assert artifact is not None
        self.assertFalse(artifact["passed"])
        issues = artifact["fieldIssues"].get("priority") or []
        self.assertTrue(any(i["code"] == "UNKNOWN_PRIORITY" for i in issues))
        self.assertEqual(artifact["normalizedProposal"]["priority"], "")

    def test_missing_extraction_fails_job(self) -> None:
        row = AiStagedDocument(
            original_filename="x.pdf",
            mime_type="application/pdf",
            file_size=1,
            checksum="x",
            storage_key="ai/staging/0/x.pdf",
            uploaded_by="tester",
        )
        self.db.add(row)
        self.db.flush()
        with patch("app.ai.job_service.current_user_name", return_value="tester"):
            job = create_registration_job(self.db, staged_document_id=row.id)
        job.status = JobStatus.EXTRACTION_COMPLETE.value
        job.extraction_artifact_key = ""
        self.db.flush()

        run_validation_stage(self.db, job)
        self.db.commit()
        self.db.refresh(job)
        self.assertEqual(job.status, JobStatus.FAILED.value)
        self.assertEqual(job.error_code, "EXTRACTION_MISSING")


if __name__ == "__main__":
    unittest.main()
