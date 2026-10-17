"""Simple marking workflow acceptance tests (spec 09)."""

from __future__ import annotations

import unittest
import uuid
from datetime import date, timedelta
from unittest.mock import patch

from fastapi import HTTPException

from app.database import SessionLocal, engine
from app.db_upgrade import upgrade_simple_marking_schema
from app.marking_reminders import process_marking_reminders
from app.marking_workflow_service import (
    add_note,
    batch_tracker,
    close_letter,
    create_mark_batch,
    list_tracked,
    marking_tree,
    revoke_marking,
    user_holds_letter,
)
from app.models import Letter, Marking, MarkingReminderLog, User


def _num() -> str:
    return f"MK/{uuid.uuid4().hex[:10].upper()}"


class MarkingWorkflowTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        upgrade_simple_marking_schema(engine)

    def setUp(self) -> None:
        self.db = SessionLocal()
        suffix = uuid.uuid4().hex[:6]
        self.initiator = User(
            name=f"Init {suffix}",
            username=f"init{suffix}",
            role="Coordinator",
            status="Active",
            department="Secretariat",
        )
        self.user_a = User(
            name=f"UserA {suffix}",
            username=f"usera{suffix}",
            role="Actionist",
            status="Active",
            department="Wing",
        )
        self.user_b = User(
            name=f"UserB {suffix}",
            username=f"userb{suffix}",
            role="Actionist",
            status="Active",
            department="Wing",
        )
        self.viewer = User(
            name=f"Viewer {suffix}",
            username=f"view{suffix}",
            role="Viewer",
            status="Active",
            department="Wing",
        )
        self.db.add_all([self.initiator, self.user_a, self.user_b, self.viewer])
        self.db.flush()
        self.letter = Letter(
            number=_num(),
            letter_date=date.today(),
            received_date=date.today(),
            type="Incoming",
            subject="Marking workflow test",
            sender="External",
            recipient="Office",
            department="Secretariat",
            priority="Routine",
            status="Open",
            created_by=self.initiator.name,
            initiator_user_id=self.initiator.id,
            last_action="Registered",
        )
        self.db.add(self.letter)
        self.db.commit()
        self.db.refresh(self.letter)

    def tearDown(self) -> None:
        try:
            self.db.rollback()
            if self.letter.id:
                self.db.query(MarkingReminderLog).filter(
                    MarkingReminderLog.letter_id == self.letter.id
                ).delete()
                self.db.query(Marking).filter(Marking.letter_id == self.letter.id).delete()
                self.db.query(Letter).filter(Letter.id == self.letter.id).delete()
            for u in (self.initiator, self.user_a, self.user_b, self.viewer):
                self.db.query(User).filter(User.id == u.id).delete()
            self.db.commit()
        finally:
            self.db.close()

    def test_mixed_batch_and_notifications_path(self) -> None:
        self.assertTrue(user_holds_letter(self.db, self.letter, self.initiator.name))
        batch = create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            client_ip="203.0.113.10",
            pathway_notify=True,
            recipients=[
                {"toUser": self.user_a.name, "action": "for_info", "track": True},
                {
                    "toUser": self.user_b.name,
                    "action": "response_required",
                    "responseType": "draft_letter",
                    "dueAt": (date.today() + timedelta(days=2)).isoformat(),
                    "track": True,
                },
            ],
        )
        self.db.commit()
        markings = self.db.query(Marking).filter(Marking.batch_id == batch.id).all()
        self.assertEqual(len(markings), 2)
        self.assertTrue(all(m.client_ip == "203.0.113.10" for m in markings))
        tracker = batch_tracker(self.db, batch.id, self.initiator.name)
        self.assertEqual(tracker["pendingCount"], 1)
        self.assertFalse(tracker["allResponsesReceived"])

    def test_self_mark_rejected(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            create_mark_batch(
                self.db,
                letter=self.letter,
                actor_name=self.initiator.name,
                recipients=[{"toUser": self.initiator.name, "action": "forward"}],
            )
        self.assertEqual(ctx.exception.status_code, 400)

    def test_chain_and_revoke_rules(self) -> None:
        batch = create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[{"toUser": self.user_a.name, "action": "forward"}],
        )
        self.db.flush()
        parent = self.db.query(Marking).filter(Marking.batch_id == batch.id).one()
        create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.user_a.name,
            parent_marking_id=parent.id,
            recipients=[{"toUser": self.user_b.name, "action": "forward"}],
        )
        self.db.flush()
        tree = marking_tree(self.db, self.letter.id)
        self.assertEqual(len(tree), 1)
        self.assertEqual(len(tree[0]["children"]), 1)

        with self.assertRaises(HTTPException) as ctx:
            revoke_marking(self.db, marking=parent, actor_name=self.initiator.name)
        self.assertEqual(ctx.exception.status_code, 409)

        child = self.db.query(Marking).filter(Marking.parent_marking_id == parent.id).one()
        revoke_marking(self.db, marking=child, actor_name=self.user_a.name, client_ip="10.0.0.1")
        self.db.commit()
        self.db.refresh(child)
        self.assertEqual(child.status, "revoked")
        self.assertEqual(child.revoke_ip, "10.0.0.1")

    def test_response_required_fulfillment(self) -> None:
        batch = create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[
                {
                    "toUser": self.user_a.name,
                    "action": "response_required",
                    "responseType": "comments",
                }
            ],
        )
        self.db.flush()
        marking = self.db.query(Marking).filter(Marking.batch_id == batch.id).one()
        add_note(
            self.db,
            letter=self.letter,
            actor_name=self.user_a.name,
            body_text="Here is my reply",
            marking_id=marking.id,
            is_response=True,
            client_ip="198.51.100.2",
        )
        self.db.commit()
        self.db.refresh(marking)
        self.assertEqual(marking.status, "responded")
        tracker = batch_tracker(self.db, batch.id, self.initiator.name)
        self.assertEqual(tracker["pendingCount"], 0)
        self.assertTrue(tracker["allResponsesReceived"])

    def test_viewer_cannot_mark(self) -> None:
        # Give viewer an active marking so they "hold", but Viewer role blocks mutate.
        create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[{"toUser": self.viewer.name, "action": "forward"}],
        )
        self.db.flush()
        with self.assertRaises(HTTPException) as ctx:
            create_mark_batch(
                self.db,
                letter=self.letter,
                actor_name=self.viewer.name,
                parent_marking_id=self.db.query(Marking)
                .filter(Marking.to_user == self.viewer.name)
                .one()
                .id,
                recipients=[{"toUser": self.user_a.name, "action": "forward"}],
            )
        self.assertEqual(ctx.exception.status_code, 403)

    def test_track_false_excluded_from_tracked_list(self) -> None:
        create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[
                {"toUser": self.user_a.name, "action": "forward", "track": False},
                {"toUser": self.user_b.name, "action": "forward", "track": True},
            ],
        )
        self.db.commit()
        tracked = list_tracked(self.db, self.initiator.name)
        self.assertEqual(len(tracked), 1)
        self.assertEqual(tracked[0]["toUser"], self.user_b.name)

    def test_close_requires_force_when_open_rr(self) -> None:
        create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[
                {
                    "toUser": self.user_a.name,
                    "action": "response_required",
                    "responseType": "draft_letter",
                }
            ],
        )
        self.db.flush()
        # Mark back to initiator so they hold
        parent = (
            self.db.query(Marking)
            .filter(Marking.letter_id == self.letter.id, Marking.to_user == self.user_a.name)
            .one()
        )
        create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.user_a.name,
            parent_marking_id=parent.id,
            recipients=[{"toUser": self.initiator.name, "action": "forward"}],
        )
        self.db.flush()
        with self.assertRaises(HTTPException) as ctx:
            close_letter(self.db, letter=self.letter, actor_name=self.initiator.name, force=False)
        self.assertEqual(ctx.exception.status_code, 400)
        close_letter(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            force=True,
            client_ip="127.0.0.1",
        )
        self.db.commit()
        self.db.refresh(self.letter)
        self.assertEqual(self.letter.status, "Closed")
        self.assertEqual(self.letter.close_ip, "127.0.0.1")

    def test_reminder_dedupe(self) -> None:
        due = date.today()
        create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[
                {
                    "toUser": self.user_a.name,
                    "action": "response_required",
                    "responseType": "comments",
                    "dueAt": due.isoformat(),
                    "remindersEnabled": True,
                    "track": True,
                }
            ],
        )
        self.db.commit()
        with patch("app.marking_reminders.get_dispatcher") as mock_disp:
            mock_disp.return_value.notify = lambda *a, **k: None
            first = process_marking_reminders(self.db, today=due)
            self.db.commit()
            second = process_marking_reminders(self.db, today=due)
            self.db.commit()
        self.assertEqual(first["sent"], 1)
        self.assertEqual(second["sent"], 0)


if __name__ == "__main__":
    unittest.main()
