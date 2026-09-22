"""Schema tests for AI registration tables (master plan step 2)."""

from __future__ import annotations

import unittest

from sqlalchemy import inspect, text

from app.database import engine
from app.db_upgrade import upgrade_ai_registration_schema
from app.models import AiRegistrationJob, AiRun, AiStagedDocument


class AiRegistrationSchemaTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        upgrade_ai_registration_schema(engine)
        # Idempotent second pass must not fail.
        upgrade_ai_registration_schema(engine)

    def test_orm_table_names(self) -> None:
        self.assertEqual(AiStagedDocument.__tablename__, "cms_ai_staged_documents")
        self.assertEqual(AiRegistrationJob.__tablename__, "cms_ai_registration_jobs")
        self.assertEqual(AiRun.__tablename__, "cms_ai_runs")

    def test_tables_exist(self) -> None:
        inspector = inspect(engine)
        for name in (
            "cms_ai_staged_documents",
            "cms_ai_registration_jobs",
            "cms_ai_runs",
        ):
            self.assertTrue(inspector.has_table(name), f"missing table {name}")

    def test_job_count_query(self) -> None:
        """Acceptance: SELECT COUNT(*) FROM cms_ai_registration_jobs works."""
        with engine.connect() as conn:
            count = conn.execute(text("SELECT COUNT(*) FROM cms_ai_registration_jobs")).scalar()
        self.assertIsNotNone(count)
        self.assertGreaterEqual(int(count), 0)

    def test_job_status_and_lifecycle_columns(self) -> None:
        columns = {col["name"] for col in inspect(engine).get_columns("cms_ai_registration_jobs")}
        for required in (
            "staged_document_id",
            "letter_id",
            "status",
            "error_code",
            "error_message",
            "ocr_artifact_key",
            "normalized_artifact_key",
            "extraction_artifact_key",
            "validation_artifact_key",
            "proposal_json",
            "prompt_version",
            "model_id",
            "model_config_json",
            "created_by",
            "reviewed_by",
            "approved_by",
            "started_at",
            "ocr_completed_at",
            "extraction_completed_at",
            "review_ready_at",
            "approved_at",
            "completed_at",
        ):
            self.assertIn(required, columns)


if __name__ == "__main__":
    unittest.main()
