"""Instruction-guided draft response for AI Intelligence Panel."""

from __future__ import annotations

import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.ai_service import draft_response_from_instructions


class GuidedDraftTest(unittest.IsolatedAsyncioTestCase):
    async def test_requires_instructions(self) -> None:
        letter = SimpleNamespace(id=3, number="X/1")
        db = MagicMock()
        db.get.return_value = letter
        with self.assertRaises(ValueError):
            await draft_response_from_instructions(db, 3, "   ")

    async def test_guided_draft_uses_instructions_and_letter(self) -> None:
        letter = SimpleNamespace(
            id=3,
            number="SUP/IN/2026/010",
            letter_date=date(2026, 3, 1),
            received_date=date(2026, 3, 2),
            type="Incoming",
            subject="Nomination list",
            sender="OrbitTech",
            recipient="SUPARCO",
            department="Admin",
            priority="Routine",
            status="In Progress",
            due_date=None,
            assigned_to="S. Khan",
            created_by="Registrar",
            assigned_by="Registrar",
            last_action="Assigned",
            confidentiality="Normal",
            action_required="",
            remarks="",
            body_text="Please confirm the attached nomination list.",
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
        db.query.return_value.filter.return_value.order_by.return_value.first.return_value = None

        llm_payload = {
            "text": "We acknowledge receipt and confirm the nomination list.",
            "tone": "Formal official",
            "pointsAddressed": ["Acknowledgement", "Confirmation"],
            "missingInformation": [],
        }

        with (
            patch(
                "app.ai_service.chat_json",
                new=AsyncMock(return_value=llm_payload),
            ) as mock_chat,
            patch("app.ai_qa_cache.build_letter_qa_workflow_context", return_value={"enabled": False}),
            patch("app.services.current_user_name", return_value="S. Khan"),
        ):
            result = await draft_response_from_instructions(
                db,
                3,
                "Formal acknowledgement confirming the nomination list in one paragraph.",
            )

        self.assertEqual(result["tone"], "Formal official")
        self.assertIn("acknowledge", result["text"].lower())
        self.assertIn("nomination list", result["instructions"].lower())
        mock_chat.assert_awaited_once()
        user_prompt = mock_chat.await_args.kwargs["user"]
        self.assertIn("Formal acknowledgement", user_prompt)
        self.assertIn("SUP/IN/2026/010", user_prompt)
        system_prompt = mock_chat.await_args.kwargs["system"]
        self.assertIn("grammar", system_prompt.lower())


if __name__ == "__main__":
    unittest.main()
