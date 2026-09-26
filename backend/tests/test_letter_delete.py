"""Administrator letter deletion: confirmation code and cascade cleanup."""

from __future__ import annotations

import unittest
import uuid
from datetime import date
from unittest.mock import patch

from fastapi import HTTPException

from app.database import SessionLocal
from app.letter_delete_service import _challenges, delete_letters, issue_delete_challenge
from app.models import Letter, LetterAction, LetterRelation


def _number() -> str:
    return f"DEL/{uuid.uuid4().hex[:10].upper()}"


class LetterDeleteRulesTest(unittest.TestCase):
    def setUp(self) -> None:
        _challenges.clear()
        self.db = SessionLocal()

    def tearDown(self) -> None:
        self.db.rollback()
        self.db.close()
        _challenges.clear()

    def test_non_admin_cannot_request_code(self) -> None:
        with (
            patch("app.letter_delete_service.current_user_name", return_value="M. Iqbal"),
            patch("app.letter_delete_service.resolve_user_role", return_value="Department/User"),
        ):
            with self.assertRaises(HTTPException) as caught:
                issue_delete_challenge(self.db, [1])
        self.assertEqual(caught.exception.status_code, 403)

    def test_wrong_code_does_not_delete(self) -> None:
        letter = self._letter()
        self.db.commit()
        try:
            with (
                patch("app.letter_delete_service.current_user_name", return_value="A. Rahman"),
                patch("app.letter_delete_service.resolve_user_role", return_value="Administrator"),
            ):
                code, ids, _ttl = issue_delete_challenge(self.db, [letter.id])
                with self.assertRaises(HTTPException) as caught:
                    delete_letters(self.db, list(ids), "WRONG1")
                self.assertEqual(caught.exception.status_code, 400)
                self.assertIsNotNone(self.db.get(Letter, letter.id))
                self.assertNotEqual(code, "WRONG1")
        finally:
            row = self.db.get(Letter, letter.id)
            if row:
                self.db.delete(row)
                self.db.commit()

    def test_admin_cascade_deletes_related_rows(self) -> None:
        source = self._letter()
        target = self._letter()
        self.db.flush()
        action = LetterAction(letter_id=source.id, action="Registered", remarks="", created_by="A. Rahman")
        relation = LetterRelation(
            from_letter_id=source.id,
            to_letter_id=target.id,
            relationship_type="Reply",
            created_by="A. Rahman",
        )
        self.db.add(action)
        self.db.add(relation)
        self.db.commit()
        source_id = source.id
        target_id = target.id
        action_id = action.id
        relation_id = relation.id
        with (
            patch("app.letter_delete_service.current_user_name", return_value="A. Rahman"),
            patch("app.letter_delete_service.resolve_user_role", return_value="Administrator"),
        ):
            _code, ids, _ttl = issue_delete_challenge(self.db, [source_id])
            deleted, _files = delete_letters(self.db, list(ids), _code)
            self.db.commit()
        self.assertEqual(deleted, [source_id])
        self.db.expire_all()
        self.assertIsNone(self.db.get(Letter, source_id))
        self.assertIsNone(self.db.get(LetterAction, action_id))
        self.assertIsNone(self.db.get(LetterRelation, relation_id))
        self.assertIsNotNone(self.db.get(Letter, target_id))
        self.db.delete(self.db.get(Letter, target_id))
        self.db.commit()

    def _letter(self) -> Letter:
        letter = Letter(
            number=_number(),
            letter_date=date.today(),
            received_date=date.today(),
            type="Incoming",
            subject="Deletion test",
            sender="External",
            recipient="Office",
            department="Coordination",
            priority="Routine",
            status="Assigned",
            assigned_to="A. Rahman",
            last_action="Assigned",
        )
        self.db.add(letter)
        self.db.flush()
        return letter


if __name__ == "__main__":
    unittest.main()
