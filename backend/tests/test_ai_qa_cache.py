"""Letter Q&A cache: exact match, fingerprint invalidation, deterministic answers."""

from __future__ import annotations

import unittest
import uuid
from datetime import date
from unittest.mock import AsyncMock, patch

from app.ai_qa_cache import (
    get_cached_answer,
    letter_content_fingerprint,
    list_letter_questions,
    normalize_question,
    question_hash,
    try_deterministic_answer,
    upsert_qa_answer,
)
from app.ai_service import letter_qa
from app.database import SessionLocal
from app.db_upgrade import upgrade_letter_qa_cache_schema
from app.database import engine
from app.models import Letter, LetterQaCache


def _number() -> str:
    return f"QA/{uuid.uuid4().hex[:10].upper()}"


class QaCacheHelpersTest(unittest.TestCase):
    def test_normalize_question(self) -> None:
        self.assertEqual(normalize_question("  When is the deadline?  "), "when is the deadline")
        self.assertEqual(question_hash("Hello?"), question_hash("hello"))

    def test_deterministic_deadline_and_sender(self) -> None:
        letter = Letter(
            number="SUP/IN/2026/001",
            letter_date=date(2026, 3, 1),
            type="Incoming",
            subject="Test",
            sender="OrbitTech",
            status="Under Review",
            due_date=date(2026, 3, 20),
            assigned_to="S. Khan",
            action_required="Provide clarification",
        )
        due = try_deterministic_answer(letter, "When is the deadline?")
        self.assertIsNotNone(due)
        self.assertIn("2026-03-20", due or "")
        sender = try_deterministic_answer(letter, "Who sent this letter?")
        self.assertIsNotNone(sender)
        self.assertIn("OrbitTech", sender or "")
        self.assertIsNone(try_deterministic_answer(letter, "What is this letter about?"))


class QaCacheStoreTest(unittest.TestCase):
    def setUp(self) -> None:
        upgrade_letter_qa_cache_schema(engine)
        self.db = SessionLocal()

    def tearDown(self) -> None:
        self.db.rollback()
        self.db.close()

    def _letter(self, **kwargs) -> Letter:
        defaults = dict(
            number=_number(),
            letter_date=date(2026, 1, 10),
            received_date=date(2026, 1, 11),
            type="Incoming",
            subject="Q&A cache persistence test",
            sender="Test Org",
            recipient="Secretary",
            department="Coordination",
            priority="Routine",
            status="Registered",
            assigned_to="A. Rahman",
            created_by="A. Rahman",
            last_action="Registered",
            due_date=date(2026, 2, 1),
            body_text="Please confirm receipt of the proposal.",
        )
        defaults.update(kwargs)
        row = Letter(**defaults)
        self.db.add(row)
        self.db.flush()
        return row

    def test_upsert_hit_and_list(self) -> None:
        letter = self._letter()
        self.db.commit()
        try:
            with (
                patch("app.ai_qa_cache.current_user_name", return_value="A. Rahman"),
                patch("app.ai_qa_cache.resolve_user_role", return_value="Administrator"),
                patch("app.ai_qa_cache.assert_letter_access", return_value=None),
            ):
                upsert_qa_answer(
                    self.db,
                    letter,
                    "What is this letter about?",
                    "It asks for proposal confirmation.",
                    source="llm",
                )
                self.db.commit()

                cached = get_cached_answer(self.db, letter, "what is this letter about")
                self.assertIsNotNone(cached)
                assert cached is not None
                self.assertIn("proposal", cached.answer)

                bundle = list_letter_questions(self.db, letter.id)
                self.assertEqual(bundle["letterId"], letter.id)
                self.assertEqual(len(bundle["questions"]), 1)
                self.assertTrue(bundle["questions"][0]["valid"])
                # Suggested list drops the already-asked prompt
                self.assertNotIn("What is this letter about?", bundle["suggested"])
        finally:
            self.db.query(LetterQaCache).filter(LetterQaCache.letter_id == letter.id).delete()
            row = self.db.get(Letter, letter.id)
            if row:
                self.db.delete(row)
            self.db.commit()

    def test_fingerprint_invalidates_cache(self) -> None:
        letter = self._letter()
        self.db.commit()
        try:
            with patch("app.ai_qa_cache.current_user_name", return_value="A. Rahman"):
                upsert_qa_answer(self.db, letter, "Who sent this?", "Test Org", source="deterministic")
                self.db.commit()
                self.assertIsNotNone(get_cached_answer(self.db, letter, "Who sent this?"))

                letter.sender = "Changed Org"
                self.db.flush()
                self.assertNotEqual(
                    letter_content_fingerprint(letter),
                    self.db.query(LetterQaCache)
                    .filter(LetterQaCache.letter_id == letter.id)
                    .one()
                    .content_fingerprint,
                )
                self.assertIsNone(get_cached_answer(self.db, letter, "Who sent this?"))
        finally:
            self.db.query(LetterQaCache).filter(LetterQaCache.letter_id == letter.id).delete()
            row = self.db.get(Letter, letter.id)
            if row:
                self.db.delete(row)
            self.db.commit()


class LetterQaWithCacheTest(unittest.IsolatedAsyncioTestCase):
    async def test_cache_hit_skips_llm(self) -> None:
        letter = Letter(
            id=12,
            number="SUP/IN/2026/001",
            letter_date=date(2026, 3, 1),
            received_date=date(2026, 3, 2),
            type="Incoming",
            subject="Request for technical clarification",
            sender="OrbitTech",
            recipient="SUPARCO",
            department="Technical",
            priority="Important",
            status="Under Review",
            due_date=date(2026, 3, 20),
            assigned_to="S. Khan",
            created_by="Registrar",
            assigned_by="Registrar",
            last_action="Assigned for review",
            confidentiality="Normal",
            action_required="Provide clarification",
            remarks="",
            body_text="Please clarify delivery milestones.",
            completion_date=None,
            is_archived=False,
            correspondence_category="",
            close_reason="",
            department_id=1,
            validated_at=None,
            classified_at=None,
        )
        from types import SimpleNamespace
        from unittest.mock import MagicMock

        cached_row = SimpleNamespace(
            answer="Cached summary about milestones.",
            source="llm",
            hit_count=1,
        )
        db = MagicMock()
        db.get.return_value = letter

        with (
            patch("app.ai_qa_cache.get_cached_answer", return_value=cached_row),
            patch("app.ai_qa_cache.record_cache_hit") as hit,
            patch("app.ai_service.chat_completion", new=AsyncMock()) as mock_chat,
        ):
            result = await letter_qa(db, 12, "What is this letter about?", history=[])

        self.assertTrue(result["cached"])
        self.assertIn("Cached summary", result["text"])
        mock_chat.assert_not_awaited()
        hit.assert_called_once()

    async def test_deterministic_skips_llm(self) -> None:
        letter = Letter(
            id=12,
            number="SUP/IN/2026/001",
            letter_date=date(2026, 3, 1),
            type="Incoming",
            subject="Request",
            sender="OrbitTech",
            status="Under Review",
            due_date=date(2026, 3, 20),
            assigned_to="S. Khan",
            action_required="",
            remarks="",
            body_text="",
        )
        from unittest.mock import MagicMock

        db = MagicMock()
        db.get.return_value = letter

        with (
            patch("app.ai_qa_cache.get_cached_answer", return_value=None),
            patch("app.ai_qa_cache.upsert_qa_answer") as upsert,
            patch("app.ai_service.chat_completion", new=AsyncMock()) as mock_chat,
        ):
            result = await letter_qa(db, 12, "When is the deadline?", history=[])

        self.assertEqual(result["source"], "deterministic")
        self.assertIn("2026-03-20", result["text"])
        mock_chat.assert_not_awaited()
        upsert.assert_called_once()


if __name__ == "__main__":
    unittest.main()
