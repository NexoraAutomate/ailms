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
    add_attachments_to_marking,
    add_note,
    assert_can_edit_letter_details,
    attachment_is_editable,
    available_marking_actions,
    batch_tracker,
    can_edit_letter_details,
    close_letter,
    create_mark_batch,
    letter_ids_held_by_user,
    letter_ids_marked_by_user,
    letter_ids_marked_to_user,
    list_attachments,
    list_notes,
    list_tracked,
    marking_has_children,
    marking_tree,
    note_is_editable,
    revoke_marking,
    update_note,
    user_holds_letter,
)
from app.models import (
    CorrespondenceAttachment,
    CorrespondenceNote,
    Letter,
    Marking,
    MarkingReminderLog,
    User,
)


def _num() -> str:
    return f"MK/{uuid.uuid4().hex[:10].upper()}"


class MarkingWorkflowTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        upgrade_simple_marking_schema(engine)

    def setUp(self) -> None:
        self.db = SessionLocal()
        suffix = uuid.uuid4().hex[:6]
        # Non-empty password_hash so server startup auth bootstrap does not dirty
        # these rows (avoids StaleDataError if teardown races with --reload).
        self.initiator = User(
            name=f"Init {suffix}",
            username=f"init{suffix}",
            password_hash="!",
            role="Coordinator",
            status="Active",
            department="Secretariat",
        )
        self.user_a = User(
            name=f"UserA {suffix}",
            username=f"usera{suffix}",
            password_hash="!",
            role="Actionist",
            status="Active",
            department="Wing",
        )
        self.user_b = User(
            name=f"UserB {suffix}",
            username=f"userb{suffix}",
            password_hash="!",
            role="Actionist",
            status="Active",
            department="Wing",
        )
        self.viewer = User(
            name=f"Viewer {suffix}",
            username=f"view{suffix}",
            password_hash="!",
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
                self.db.query(CorrespondenceAttachment).filter(
                    CorrespondenceAttachment.letter_id == self.letter.id
                ).delete()
                self.db.query(CorrespondenceNote).filter(
                    CorrespondenceNote.letter_id == self.letter.id
                ).delete()
                self.db.query(Marking).filter(Marking.letter_id == self.letter.id).delete()
                self.db.query(Letter).filter(Letter.id == self.letter.id).delete()
            for u in (self.initiator, self.user_a, self.user_b, self.viewer):
                self.db.query(User).filter(User.id == u.id).delete()
            self.db.commit()
        finally:
            self.db.close()

    def test_initiator_can_edit_details_only_before_marking(self) -> None:
        self.assertTrue(can_edit_letter_details(self.db, self.letter, self.initiator.name))
        self.assertFalse(can_edit_letter_details(self.db, self.letter, self.user_a.name))
        create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[{"toUser": self.user_a.name, "action": "forward"}],
        )
        self.db.flush()
        self.assertFalse(can_edit_letter_details(self.db, self.letter, self.initiator.name))
        self.assertFalse(can_edit_letter_details(self.db, self.letter, self.user_a.name))
        with self.assertRaises(HTTPException) as ctx:
            assert_can_edit_letter_details(self.db, self.letter, self.initiator.name)
        self.assertEqual(ctx.exception.status_code, 403)
        parent = (
            self.db.query(Marking)
            .filter(Marking.letter_id == self.letter.id, Marking.to_user == self.user_a.name)
            .one()
        )
        revoke_marking(self.db, marking=parent, actor_name=self.initiator.name)
        self.db.flush()
        self.assertTrue(can_edit_letter_details(self.db, self.letter, self.initiator.name))

    def test_notes_locked_after_marking_onward(self) -> None:
        add_note(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            body_text="Draft while holding",
            client_ip="10.0.0.5",
        )
        self.db.flush()
        note = (
            self.db.query(CorrespondenceNote)
            .filter(CorrespondenceNote.letter_id == self.letter.id)
            .one()
        )
        self.assertTrue(note_is_editable(self.db, note, self.initiator.name))
        create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[{"toUser": self.user_a.name, "action": "forward"}],
        )
        self.db.flush()
        self.assertFalse(note_is_editable(self.db, note, self.initiator.name))
        with self.assertRaises(HTTPException) as ctx:
            update_note(self.db, note=note, actor_name=self.initiator.name, body_text="Nope")
        self.assertEqual(ctx.exception.status_code, 403)

    def test_older_notes_locked_when_remarked_to_same_user(self) -> None:
        """When remade to a user again, only notes from the new hold are editable."""
        batch1 = create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[{"toUser": self.user_a.name, "action": "forward"}],
        )
        self.db.flush()
        first_mark = self.db.query(Marking).filter(Marking.batch_id == batch1.id).one()
        old_note = add_note(
            self.db,
            letter=self.letter,
            actor_name=self.user_a.name,
            body_text="Comment on first hold",
            marking_id=first_mark.id,
        )
        self.db.flush()
        self.assertTrue(note_is_editable(self.db, old_note, self.user_a.name))

        create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.user_a.name,
            parent_marking_id=first_mark.id,
            recipients=[{"toUser": self.user_b.name, "action": "forward"}],
        )
        self.db.flush()
        self.assertFalse(note_is_editable(self.db, old_note, self.user_a.name))

        mark_to_b = (
            self.db.query(Marking)
            .filter(Marking.parent_marking_id == first_mark.id, Marking.to_user == self.user_b.name)
            .one()
        )
        batch2 = create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.user_b.name,
            parent_marking_id=mark_to_b.id,
            recipients=[{"toUser": self.user_a.name, "action": "forward"}],
        )
        self.db.flush()
        second_mark = self.db.query(Marking).filter(Marking.batch_id == batch2.id).one()

        # Prior hold notes stay locked even though A holds again.
        self.assertFalse(note_is_editable(self.db, old_note, self.user_a.name))
        with self.assertRaises(HTTPException) as ctx:
            update_note(self.db, note=old_note, actor_name=self.user_a.name, body_text="Nope")
        self.assertEqual(ctx.exception.status_code, 403)

        new_note = add_note(
            self.db,
            letter=self.letter,
            actor_name=self.user_a.name,
            body_text="Comment on second hold",
            marking_id=second_mark.id,
        )
        self.db.flush()
        self.assertTrue(note_is_editable(self.db, new_note, self.user_a.name))
        self.assertFalse(note_is_editable(self.db, old_note, self.user_a.name))

    def test_marker_is_revoke_only_after_marking_onward(self) -> None:
        self.assertTrue(user_holds_letter(self.db, self.letter, self.initiator.name))
        create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[{"toUser": self.user_a.name, "action": "forward"}],
        )
        self.db.flush()
        self.assertFalse(user_holds_letter(self.db, self.letter, self.initiator.name))
        self.assertTrue(user_holds_letter(self.db, self.letter, self.user_a.name))
        initiator_actions = available_marking_actions(self.db, self.letter, self.initiator.name)
        self.assertIn("revoke", initiator_actions)
        self.assertNotIn("mark", initiator_actions)
        self.assertNotIn("add_note", initiator_actions)
        self.assertNotIn("close", initiator_actions)
        with self.assertRaises(HTTPException) as ctx:
            add_note(
                self.db,
                letter=self.letter,
                actor_name=self.initiator.name,
                body_text="Should not be allowed",
            )
        self.assertEqual(ctx.exception.status_code, 403)
        with self.assertRaises(HTTPException) as ctx2:
            close_letter(self.db, letter=self.letter, actor_name=self.initiator.name, force=True)
        self.assertEqual(ctx2.exception.status_code, 403)

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

    def test_can_remark_same_user_after_correspondence_returns(self) -> None:
        """Prior active mark that was remade onward must not block marking that user again."""
        first = create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[{"toUser": self.user_a.name, "action": "forward"}],
        )
        self.db.flush()
        parent = self.db.query(Marking).filter(Marking.batch_id == first.id).one()

        # Recipient remakes back to initiator (prior A→recipient stays active with children).
        create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.user_a.name,
            parent_marking_id=parent.id,
            recipients=[{"toUser": self.initiator.name, "action": "forward"}],
        )
        self.db.flush()
        self.assertTrue(user_holds_letter(self.db, self.letter, self.initiator.name))
        self.assertTrue(marking_has_children(self.db, parent.id))
        self.assertEqual(parent.status, "active")

        # Initiator may mark the same recipient again after the letter returns.
        second = create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[{"toUser": self.user_a.name, "action": "forward"}],
        )
        self.db.flush()
        remark = (
            self.db.query(Marking)
            .filter(Marking.batch_id == second.id, Marking.to_user == self.user_a.name)
            .one()
        )
        self.assertEqual(remark.status, "active")
        self.assertIsNotNone(remark.parent_marking_id)

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

        # Only the last marker (user A → user B) may revoke; initiator no longer can.
        self.assertNotIn(
            "revoke",
            available_marking_actions(self.db, self.letter, self.initiator.name),
        )
        self.assertIn(
            "revoke",
            available_marking_actions(self.db, self.letter, self.user_a.name),
        )
        self.assertNotIn(
            "revoke",
            available_marking_actions(self.db, self.letter, self.user_b.name),
        )

        child = self.db.query(Marking).filter(Marking.parent_marking_id == parent.id).one()
        revoke_marking(self.db, marking=child, actor_name=self.user_a.name, client_ip="10.0.0.1")
        self.db.commit()
        self.db.refresh(child)
        self.assertEqual(child.status, "revoked")
        self.assertEqual(child.revoke_ip, "10.0.0.1")
        # Revoked remake restores the prior holder's leaf — mark/note come back, revoke goes away.
        self.assertFalse(marking_has_children(self.db, parent.id))
        self.assertTrue(user_holds_letter(self.db, self.letter, self.user_a.name))
        restored = available_marking_actions(self.db, self.letter, self.user_a.name)
        self.assertIn("mark", restored)
        self.assertIn("add_note", restored)
        self.assertNotIn("revoke", restored)

    def test_initiator_revoke_restores_hold_and_actions(self) -> None:
        batch = create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[{"toUser": self.user_a.name, "action": "forward"}],
        )
        self.db.flush()
        marking = self.db.query(Marking).filter(Marking.batch_id == batch.id).one()
        self.assertFalse(user_holds_letter(self.db, self.letter, self.initiator.name))
        self.assertIn("revoke", available_marking_actions(self.db, self.letter, self.initiator.name))

        revoke_marking(self.db, marking=marking, actor_name=self.initiator.name)
        self.db.flush()
        self.assertEqual(marking.status, "revoked")
        self.assertTrue(user_holds_letter(self.db, self.letter, self.initiator.name))
        actions = available_marking_actions(self.db, self.letter, self.initiator.name)
        self.assertIn("mark", actions)
        self.assertIn("add_note", actions)
        self.assertIn("close", actions)
        self.assertNotIn("revoke", actions)

    def test_cannot_revoke_after_recipient_comments_or_attachments(self) -> None:
        batch = create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[{"toUser": self.user_a.name, "action": "forward"}],
        )
        self.db.flush()
        marking = self.db.query(Marking).filter(Marking.batch_id == batch.id).one()
        self.assertIn(
            "revoke",
            available_marking_actions(self.db, self.letter, self.initiator.name),
        )

        add_note(
            self.db,
            letter=self.letter,
            actor_name=self.user_a.name,
            body_text="Recipient comment",
            marking_id=marking.id,
        )
        self.db.flush()
        self.assertNotIn(
            "revoke",
            available_marking_actions(self.db, self.letter, self.initiator.name),
        )
        with self.assertRaises(HTTPException) as ctx:
            revoke_marking(self.db, marking=marking, actor_name=self.initiator.name)
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn("comments or attachments", ctx.exception.detail)

        # Fresh letter: attachment alone also blocks revoke.
        letter2 = Letter(
            number=_num(),
            letter_date=date.today(),
            received_date=date.today(),
            type="Incoming",
            subject="Revoke after attachment",
            sender="External",
            recipient="Office",
            department="Secretariat",
            priority="Routine",
            status="Open",
            created_by=self.initiator.name,
            initiator_user_id=self.initiator.id,
            last_action="Registered",
        )
        self.db.add(letter2)
        self.db.flush()
        try:
            batch2 = create_mark_batch(
                self.db,
                letter=letter2,
                actor_name=self.initiator.name,
                recipients=[{"toUser": self.user_a.name, "action": "forward"}],
            )
            self.db.flush()
            marking2 = self.db.query(Marking).filter(Marking.batch_id == batch2.id).one()
            add_attachments_to_marking(
                self.db,
                letter=letter2,
                actor_name=self.user_a.name,
                marking_id=marking2.id,
                attachments=[
                    {"attachmentKind": "Supporting Doc", "originalFilename": "x.pdf"}
                ],
            )
            self.db.flush()
            self.assertNotIn(
                "revoke",
                available_marking_actions(self.db, letter2, self.initiator.name),
            )
            with self.assertRaises(HTTPException) as ctx2:
                revoke_marking(self.db, marking=marking2, actor_name=self.initiator.name)
            self.assertEqual(ctx2.exception.status_code, 409)
        finally:
            self.db.query(CorrespondenceAttachment).filter(
                CorrespondenceAttachment.letter_id == letter2.id
            ).delete()
            self.db.query(CorrespondenceNote).filter(
                CorrespondenceNote.letter_id == letter2.id
            ).delete()
            self.db.query(Marking).filter(Marking.letter_id == letter2.id).delete()
            self.db.query(Letter).filter(Letter.id == letter2.id).delete()
            self.db.flush()

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
        self.db.refresh(self.letter)
        self.assertEqual(marking.status, "responded")
        self.assertEqual(self.letter.last_action, "Responded")
        self.assertEqual(self.letter.assigned_to, self.initiator.name)
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

    def test_attachments_scoped_to_marking_not_notes(self) -> None:
        batch = create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[{"toUser": self.user_a.name, "action": "forward"}],
        )
        self.db.flush()
        marking = self.db.query(Marking).filter(Marking.batch_id == batch.id).one()

        note_a = add_note(
            self.db,
            letter=self.letter,
            actor_name=self.user_a.name,
            body_text="First note",
            marking_id=marking.id,
        )
        note_b = add_note(
            self.db,
            letter=self.letter,
            actor_name=self.user_a.name,
            body_text="Second note",
            marking_id=marking.id,
        )
        created = add_attachments_to_marking(
            self.db,
            letter=self.letter,
            actor_name=self.user_a.name,
            marking_id=marking.id,
            attachments=[
                {"attachmentKind": "Supporting Doc", "originalFilename": "a.pdf"},
                {"attachmentKind": "Other", "originalFilename": "b.pdf"},
            ],
            client_ip="10.1.1.1",
        )
        self.db.flush()
        self.assertEqual(len(created), 2)
        for row in created:
            self.assertEqual(row.marking_id, marking.id)
            self.assertIsNone(row.note_id)
            self.assertEqual(row.letter_id, self.letter.id)
            self.assertEqual(row.created_by, self.user_a.name)
            self.assertTrue(attachment_is_editable(self.db, row, self.user_a.name))

        notes = list_notes(self.db, self.letter.id, actor_name=self.user_a.name)
        self.assertEqual(len(notes), 2)
        self.assertTrue(all("attachments" not in n for n in notes))
        self.assertEqual({n["id"] for n in notes}, {note_a.id, note_b.id})

        atts = list_attachments(self.db, self.letter.id, actor_name=self.user_a.name)
        self.assertEqual(len(atts), 2)
        self.assertTrue(all(a["markingId"] == marking.id for a in atts))
        self.assertTrue(all(a["editable"] for a in atts))

        create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.user_a.name,
            parent_marking_id=marking.id,
            recipients=[{"toUser": self.user_b.name, "action": "forward"}],
        )
        self.db.flush()
        for row in created:
            self.db.refresh(row)
            self.assertFalse(attachment_is_editable(self.db, row, self.user_a.name))

    def test_active_markings_appear_in_recipient_inbox(self) -> None:
        """Inbox is only letters currently marked to the user (leaf holds), not remade onward."""
        create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[
                {"toUser": self.user_a.name, "action": "response_required", "responseType": "comments"},
                {"toUser": self.user_b.name, "action": "for_info"},
            ],
        )
        self.db.flush()

        self.assertIn(self.letter.id, letter_ids_marked_to_user(self.db, self.user_a.name))
        self.assertIn(self.letter.id, letter_ids_marked_to_user(self.db, self.user_b.name))
        self.assertNotIn(self.letter.id, letter_ids_marked_to_user(self.db, self.initiator.name))
        self.assertIn(self.letter.id, letter_ids_marked_by_user(self.db, self.initiator.name))

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
            recipients=[{"toUser": self.viewer.name, "action": "forward"}],
        )
        self.db.flush()

        # After remaking onward, the letter leaves user_a's Inbox; current holder is viewer.
        self.assertEqual(self.letter.assigned_to, self.viewer.name)
        self.assertNotIn(self.letter.id, letter_ids_marked_to_user(self.db, self.user_a.name))
        self.assertIn(self.letter.id, letter_ids_marked_to_user(self.db, self.user_b.name))
        self.assertIn(self.letter.id, letter_ids_marked_to_user(self.db, self.viewer.name))

        info_mark = (
            self.db.query(Marking)
            .filter(Marking.letter_id == self.letter.id, Marking.to_user == self.user_b.name)
            .one()
        )
        revoke_marking(self.db, marking=info_mark, actor_name=self.initiator.name)
        self.db.flush()
        self.assertNotIn(self.letter.id, letter_ids_marked_to_user(self.db, self.user_b.name))
        self.assertNotIn(self.letter.id, letter_ids_marked_to_user(self.db, self.user_a.name))
        self.assertIn(self.letter.id, letter_ids_marked_to_user(self.db, self.viewer.name))

    def test_sent_excludes_revoked_only_marks_and_inbox_regains_hold(self) -> None:
        """First mark + revoke: letter leaves Sent and returns to initiator Inbox."""
        self.assertIn(self.letter.id, letter_ids_held_by_user(self.db, self.initiator.name))
        self.assertNotIn(self.letter.id, letter_ids_marked_by_user(self.db, self.initiator.name))

        create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[{"toUser": self.user_a.name, "action": "forward"}],
        )
        self.db.flush()
        self.assertIn(self.letter.id, letter_ids_marked_by_user(self.db, self.initiator.name))
        self.assertNotIn(self.letter.id, letter_ids_held_by_user(self.db, self.initiator.name))
        self.assertIn(self.letter.id, letter_ids_held_by_user(self.db, self.user_a.name))

        marking = (
            self.db.query(Marking)
            .filter(Marking.letter_id == self.letter.id, Marking.to_user == self.user_a.name)
            .one()
        )
        revoke_marking(self.db, marking=marking, actor_name=self.initiator.name)
        self.db.flush()

        self.assertNotIn(self.letter.id, letter_ids_marked_by_user(self.db, self.initiator.name))
        self.assertIn(self.letter.id, letter_ids_held_by_user(self.db, self.initiator.name))
        self.assertNotIn(self.letter.id, letter_ids_held_by_user(self.db, self.user_a.name))

        # Remark keeps it in Sent even after a later revoke of a different recipient? —
        # remark then leave active: stays in Sent.
        create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[{"toUser": self.user_b.name, "action": "forward"}],
        )
        self.db.flush()
        self.assertIn(self.letter.id, letter_ids_marked_by_user(self.db, self.initiator.name))

    def test_assigned_to_and_last_action_follow_markings(self) -> None:
        create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[{"toUser": self.user_a.name, "action": "forward"}],
        )
        self.db.flush()
        self.assertEqual(self.letter.assigned_to, self.user_a.name)
        self.assertEqual(self.letter.assigned_by, self.initiator.name)
        self.assertEqual(self.letter.last_action, "Marked (Forward)")

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
            recipients=[{"toUser": self.user_b.name, "action": "for_info"}],
        )
        self.db.flush()
        self.assertEqual(self.letter.assigned_to, self.user_b.name)
        self.assertEqual(self.letter.assigned_by, self.user_a.name)
        self.assertEqual(self.letter.last_action, "Marked (For Information)")

        leaf = (
            self.db.query(Marking)
            .filter(Marking.letter_id == self.letter.id, Marking.to_user == self.user_b.name)
            .one()
        )
        revoke_marking(self.db, marking=leaf, actor_name=self.user_a.name)
        self.db.flush()
        # After revoke of the leaf, hold returns to user_a (still has active inbound with no children).
        self.assertEqual(self.letter.assigned_to, self.user_a.name)
        self.assertEqual(self.letter.assigned_by, self.initiator.name)
        self.assertEqual(self.letter.last_action, f"Revoked (from {self.user_b.name})")

        revoke_marking(self.db, marking=parent, actor_name=self.initiator.name)
        self.db.flush()
        self.assertEqual(self.letter.assigned_to, self.initiator.name)
        self.assertEqual(self.letter.assigned_by, self.initiator.name)
        self.assertEqual(self.letter.last_action, f"Revoked (from {self.user_a.name})")


if __name__ == "__main__":
    unittest.main()
