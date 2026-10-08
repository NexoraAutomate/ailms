"""Letter-scoped Q&A for the AI Intelligence Panel."""

from __future__ import annotations

import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.ai_service import letter_qa


class LetterQaTest(unittest.IsolatedAsyncioTestCase):
    async def test_letter_qa_answers_from_opened_letter(self) -> None:
        letter = SimpleNamespace(
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
            body_text="Please clarify delivery milestones for the S-band proposal.",
            completion_date=None,
            is_archived=False,
            correspondence_category="",
            close_reason="",
            department_id=1,
            validated_at=None,
            classified_at=None,
        )
        db = MagicMock()
        db.get.return_value = letter

        with patch(
            "app.ai_service.chat_completion",
            new=AsyncMock(return_value="The letter asks for delivery milestone clarification."),
        ) as mock_chat:
            result = await letter_qa(
                db,
                12,
                "What is this letter about?",
                history=[{"role": "user", "content": "hello"}],
            )

        self.assertEqual(result["letterId"], 12)
        self.assertIn("clarification", result["text"].lower())
        mock_chat.assert_awaited_once()
        user_prompt = mock_chat.await_args.kwargs["user"]
        self.assertIn("What is this letter about?", user_prompt)
        self.assertIn("SUP/IN/2026/001", user_prompt)
        self.assertIn("delivery milestones", user_prompt)
        self.assertIn("user: hello", user_prompt)

    async def test_letter_qa_missing_letter(self) -> None:
        db = MagicMock()
        db.get.return_value = None
        with self.assertRaises(ValueError):
            await letter_qa(db, 999, "Any question?")


if __name__ == "__main__":
    unittest.main()
