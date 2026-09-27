import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.ai_service import (
    _is_followup_question,
    _letters_by_ids,
    _search_keywords,
    _text_match_letters,
)


class AiSearchKeywordTest(unittest.TestCase):
    def test_extracts_topic_from_natural_question(self):
        self.assertEqual(
            _search_keywords("is there a letter about pension?"),
            ["pension"],
        )

    def test_keeps_multiword_topics(self):
        self.assertEqual(
            _search_keywords("show letters about pension increase"),
            ["pension", "increase"],
        )

    def test_strips_relational_filler_words(self):
        self.assertEqual(
            _search_keywords("is there any letter pertaining to pension?"),
            ["pension"],
        )

    def test_partial_keyword_fallback_still_finds_topic(self):
        pension = SimpleNamespace(
            id=50,
            number="FD.SR-III-4-113/2026",
            subject="GRANT OF INCREASE IN PENSION TO CIVIL PENSIONERS",
            sender="Finance Secretary",
            department="Finance Department",
            status="Pending",
            remarks="",
            is_archived=False,
        )
        other = SimpleNamespace(
            id=49,
            number="10-01/2025-Min-II",
            subject="Declaration of Public Holiday",
            sender="Cabinet Division",
            department="Cabinet",
            status="Pending",
            remarks="",
            is_archived=False,
        )

        query = MagicMock()
        query.filter.return_value.all.return_value = [pension, other]
        db = MagicMock()
        db.query.return_value = query

        # Even if a filler token slips through, topic tokens should still match.
        hits = _text_match_letters(db, "is there any letter pertaining to pension?")
        self.assertEqual([row.id for row in hits], [50])


class AiChatFollowupTest(unittest.TestCase):
    def test_detects_that_letter_followup(self):
        self.assertTrue(
            _is_followup_question(
                "what is the summary of that letter in a single sentence not more than 15 words"
            )
        )

    def test_topic_question_is_not_followup(self):
        self.assertFalse(_is_followup_question("is there a letter about pension?"))

    def test_letters_by_ids_preserves_order(self):
        from datetime import date

        received = date(2026, 7, 22)
        first = SimpleNamespace(
            id=50,
            number="A",
            subject="Pension",
            letter_date=received,
            received_date=received,
            type="Incoming",
            sender="Finance",
            recipient="",
            department="Finance",
            priority="Routine",
            status="Pending",
            due_date=None,
            assigned_to="",
            last_action="",
            confidentiality="Normal",
            action_required="",
            remarks="3.5% pension increase",
            completion_date=None,
            is_archived=False,
        )
        second = SimpleNamespace(
            id=49,
            number="B",
            subject="Holiday",
            letter_date=received,
            received_date=received,
            type="Incoming",
            sender="Cabinet",
            recipient="",
            department="Cabinet",
            priority="Routine",
            status="Pending",
            due_date=None,
            assigned_to="",
            last_action="",
            confidentiality="Normal",
            action_required="",
            remarks="",
            completion_date=None,
            is_archived=False,
        )
        query = MagicMock()
        query.filter.return_value.all.return_value = [second, first]
        db = MagicMock()
        db.query.return_value = query

        rows = _letters_by_ids(db, [50, 49])
        self.assertEqual([row["id"] for row in rows], ["50", "49"])
        self.assertIn("pension", rows[0]["remarks"].lower())


if __name__ == "__main__":
    unittest.main()
