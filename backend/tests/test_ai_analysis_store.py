"""AI Intelligence Panel persistence and regenerate gating."""

from __future__ import annotations

import json
import unittest
import uuid
from datetime import date
from unittest.mock import patch

from app.ai_analysis_store import (
    get_cached_payload,
    list_letter_analyses,
    upsert_generated,
    user_can_regenerate_ai,
)
from app.database import SessionLocal
from app.models import Letter, Role


def _number() -> str:
    return f"AI/{uuid.uuid4().hex[:10].upper()}"


class AiAnalysisStoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self.db = SessionLocal()

    def tearDown(self) -> None:
        self.db.rollback()
        self.db.close()

    def _letter(self) -> Letter:
        row = Letter(
            number=_number(),
            letter_date=date(2026, 1, 10),
            received_date=date(2026, 1, 11),
            type="Incoming",
            subject="AI analysis persistence test",
            sender="Test Org",
            recipient="Secretary",
            department="Coordination",
            priority="Routine",
            status="Registered",
            assigned_to="A. Rahman",
            created_by="A. Rahman",
            last_action="Registered",
        )
        self.db.add(row)
        self.db.flush()
        return row

    def test_upsert_and_list_analysis(self) -> None:
        letter = self._letter()
        self.db.commit()
        try:
            with (
                patch("app.ai_analysis_store.current_user_name", return_value="A. Rahman"),
                patch("app.ai_analysis_store.resolve_user_role", return_value="Administrator"),
                patch("app.ai_analysis_store.assert_letter_access", return_value=None),
            ):
                payload = {"executiveSummary": "Stored summary", "keyPoints": ["a"]}
                upsert_generated(self.db, letter.id, "summarize", payload, meta={"source": "test"})
                self.db.commit()

                cached = get_cached_payload(self.db, letter.id, "summarize")
                self.assertEqual(cached["executiveSummary"], "Stored summary")
                bundle = list_letter_analyses(self.db, letter.id)
                self.assertTrue(bundle["canRegenerate"])
                self.assertEqual(bundle["analyses"]["summarize"]["payload"]["executiveSummary"], "Stored summary")
        finally:
            row = self.db.get(Letter, letter.id)
            if row:
                self.db.delete(row)
                self.db.commit()

    def test_viewer_cannot_regenerate(self) -> None:
        name = f"Viewer-{uuid.uuid4().hex[:6]}"
        self.db.add(
            Role(
                name=name,
                description="Read only",
                permissions_json=json.dumps(
                    {
                        "ai_intelligence": {
                            "view": True,
                            "create": False,
                            "edit": False,
                            "delete": False,
                            "other": {"Regenerate analysis": False},
                        }
                    }
                ),
            )
        )
        self.db.commit()
        try:
            self.assertFalse(user_can_regenerate_ai(self.db, "Viewer User", name))
        finally:
            row = self.db.query(Role).filter(Role.name == name).one_or_none()
            if row:
                self.db.delete(row)
                self.db.commit()

    def test_clerk_can_regenerate_with_option(self) -> None:
        name = f"Clerk-{uuid.uuid4().hex[:6]}"
        self.db.add(
            Role(
                name=name,
                description="Clerk",
                permissions_json=json.dumps(
                    {
                        "ai_intelligence": {
                            "view": True,
                            "create": False,
                            "edit": True,
                            "delete": False,
                            "other": {"Regenerate analysis": True},
                        }
                    }
                ),
            )
        )
        self.db.commit()
        try:
            self.assertTrue(user_can_regenerate_ai(self.db, "Clerk User", name))
        finally:
            row = self.db.query(Role).filter(Role.name == name).one_or_none()
            if row:
                self.db.delete(row)
                self.db.commit()
