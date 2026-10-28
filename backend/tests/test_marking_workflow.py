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
    add_draft_attachments,
    add_draft_note,
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
    marked_by_for_holder,
    list_attachments,
    list_drafts,
    list_notes,
    list_tracked,
    marking_actions_payload,
    marking_has_children,
    marking_tree,
    note_is_editable,
    path_ids_visible_to_user,
    revoke_marking,
    update_note,
    user_holds_letter,
)
from app.models import (
    CorrespondenceAttachment,
    CorrespondenceDraftAttachment,
    CorrespondenceDraftNote,
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
                self.db.query(CorrespondenceDraftAttachment).filter(
                    CorrespondenceDraftAttachment.letter_id == self.letter.id
                ).delete()
                self.db.query(CorrespondenceDraftNote).filter(
                    CorrespondenceDraftNote.letter_id == self.letter.id
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
        from app.document_service import assert_can_mutate_registration_document

        self.assertTrue(can_edit_letter_details(self.db, self.letter, self.initiator.name))
        self.assertFalse(can_edit_letter_details(self.db, self.letter, self.user_a.name))
        assert_can_mutate_registration_document(self.db, self.letter, actor=self.initiator.name)
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
        with self.assertRaises(HTTPException) as attach_ctx:
            assert_can_mutate_registration_document(self.db, self.letter, actor=self.initiator.name)
        self.assertEqual(attach_ctx.exception.status_code, 403)
        parent = (
            self.db.query(Marking)
            .filter(Marking.letter_id == self.letter.id, Marking.to_user == self.user_a.name)
            .one()
        )
        revoke_marking(self.db, marking=parent, actor_name=self.initiator.name)
        self.db.flush()
        self.assertTrue(can_edit_letter_details(self.db, self.letter, self.initiator.name))
        assert_can_mutate_registration_document(self.db, self.letter, actor=self.initiator.name)

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
        self.assertNotIn("forward", initiator_actions)
        self.assertNotIn("reply", initiator_actions)
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

        initiator_payload = marking_actions_payload(self.db, self.letter, self.initiator.name)
        self.assertFalse(initiator_payload["initiatorHold"])
        self.assertEqual(len(initiator_payload["activeHolds"]), 0)
        leaf_users = {m["toUser"] for m in initiator_payload["activeLeaves"]}
        self.assertEqual(leaf_users, {self.user_a.name, self.user_b.name})

        hold_a = marking_actions_payload(self.db, self.letter, self.user_a.name)
        self.assertEqual(len(hold_a["activeHolds"]), 1)
        self.assertEqual(hold_a["activeHolds"][0]["toUser"], self.user_a.name)
        self.assertIn("forward", hold_a["actions"])
        self.assertIn("reply", hold_a["actions"])

    def test_actions_payload_initiator_hold_and_multi_hold_parent_required(self) -> None:
        root = marking_actions_payload(self.db, self.letter, self.initiator.name)
        self.assertTrue(root["initiatorHold"])
        self.assertEqual(root["activeLeaves"], [])
        self.assertEqual(root["activeHolds"], [])
        self.assertIn("forward", root["actions"])
        self.assertNotIn("reply", root["actions"])

        # Mark both A and B from initiator, then mark both back to initiator so
        # initiator has two leaf inbound holds (needs parentMarkingId to remake).
        create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[
                {"toUser": self.user_a.name, "action": "for_info"},
                {"toUser": self.user_b.name, "action": "for_info"},
            ],
        )
        self.db.flush()
        mark_a = (
            self.db.query(Marking)
            .filter(Marking.letter_id == self.letter.id, Marking.to_user == self.user_a.name)
            .one()
        )
        mark_b = (
            self.db.query(Marking)
            .filter(Marking.letter_id == self.letter.id, Marking.to_user == self.user_b.name)
            .one()
        )
        create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.user_a.name,
            parent_marking_id=mark_a.id,
            recipients=[{"toUser": self.initiator.name, "action": "forward"}],
        )
        create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.user_b.name,
            parent_marking_id=mark_b.id,
            recipients=[{"toUser": self.initiator.name, "action": "forward"}],
        )
        self.db.flush()

        multi = marking_actions_payload(self.db, self.letter, self.initiator.name)
        self.assertFalse(multi["initiatorHold"])
        self.assertEqual(len(multi["activeHolds"]), 2)
        self.assertEqual(len(multi["activeLeaves"]), 2)

        with self.assertRaises(HTTPException) as ctx:
            create_mark_batch(
                self.db,
                letter=self.letter,
                actor_name=self.initiator.name,
                recipients=[{"toUser": self.user_a.name, "action": "for_info"}],
            )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("parentMarkingId", str(ctx.exception.detail))

        parent_id = multi["activeHolds"][0]["id"]
        create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            parent_marking_id=parent_id,
            recipients=[{"toUser": self.user_a.name, "action": "for_info"}],
        )
        self.db.flush()

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
        self.assertIn("forward", restored)
        self.assertIn("reply", restored)
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
        self.assertIn("forward", actions)
        self.assertNotIn("reply", actions)
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
        self.assertIn("comments, attachments", ctx.exception.detail)

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
        # Track list is For Information only; unchecking track excludes the row.
        create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[
                {"toUser": self.user_a.name, "action": "for_info", "track": False},
                {"toUser": self.user_b.name, "action": "for_info", "track": True},
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

    def test_marked_by_for_holder_is_the_marking_user(self) -> None:
        """Inbox 'Marked by' is the user who marked the letter into this hold."""
        self.assertEqual(marked_by_for_holder(self.db, self.letter.id, self.initiator.name), "")

        create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[{"toUser": self.user_a.name, "action": "forward"}],
        )
        self.db.flush()
        self.assertEqual(
            marked_by_for_holder(self.db, self.letter.id, self.user_a.name),
            self.initiator.name,
        )
        self.assertEqual(marked_by_for_holder(self.db, self.letter.id, self.initiator.name), "")

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
            recipients=[{"toUser": self.user_b.name, "action": "forward"}],
        )
        self.db.flush()
        self.assertEqual(
            marked_by_for_holder(self.db, self.letter.id, self.user_b.name),
            self.user_a.name,
        )
        self.assertEqual(marked_by_for_holder(self.db, self.letter.id, self.user_a.name), "")

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

        # After remaking onward, the letter leaves user_a's Inbox; B and viewer still hold.
        holders = {n.strip() for n in (self.letter.assigned_to or "").split(",") if n.strip()}
        self.assertEqual(holders, {self.user_b.name, self.viewer.name})
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

    def test_sent_forward_and_rr_info_only_in_track(self) -> None:
        """Forward + RR appear in Sent; For Information is Track-only; RR returns to Inbox on respond."""
        from app.marking_workflow_service import list_tracked, sent_markings_for_user

        self.assertIn(self.letter.id, letter_ids_held_by_user(self.db, self.initiator.name))
        self.assertNotIn(self.letter.id, letter_ids_marked_by_user(self.db, self.initiator.name))

        # Forward to two users → two Sent rows (letter 210-style).
        create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[
                {"toUser": self.user_a.name, "action": "forward"},
                {"toUser": self.user_b.name, "action": "forward"},
            ],
        )
        self.db.flush()
        sent = sent_markings_for_user(self.db, self.initiator.name)
        self.assertEqual(len(sent), 2)
        self.assertEqual({m.to_user for m in sent}, {self.user_a.name, self.user_b.name})
        self.assertIn(self.letter.id, letter_ids_marked_by_user(self.db, self.initiator.name))
        self.assertNotIn(self.letter.id, letter_ids_held_by_user(self.db, self.initiator.name))
        self.assertFalse(any(t["action"] == "forward" for t in list_tracked(self.db, self.initiator.name)))

        for row in sent:
            revoke_marking(self.db, marking=row, actor_name=self.initiator.name)
        self.db.flush()
        self.assertEqual(sent_markings_for_user(self.db, self.initiator.name), [])
        self.assertIn(self.letter.id, letter_ids_held_by_user(self.db, self.initiator.name))

        # For Information → Track only, not Sent.
        create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[{"toUser": self.user_a.name, "action": "for_info", "track": True}],
        )
        self.db.flush()
        self.assertNotIn(self.letter.id, letter_ids_marked_by_user(self.db, self.initiator.name))
        tracked = list_tracked(self.db, self.initiator.name)
        self.assertTrue(any(t["toUser"] == self.user_a.name and t["action"] == "for_info" for t in tracked))

        info = (
            self.db.query(Marking)
            .filter(Marking.letter_id == self.letter.id, Marking.to_user == self.user_a.name, Marking.status == "active")
            .one()
        )
        revoke_marking(self.db, marking=info, actor_name=self.initiator.name)
        self.db.flush()

        # RR stays in Sent until answered, then Inbox.
        create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[
                {
                    "toUser": self.user_a.name,
                    "action": "response_required",
                    "responseType": "comments",
                },
                {
                    "toUser": self.user_b.name,
                    "action": "response_required",
                    "responseType": "comments",
                },
            ],
        )
        self.db.flush()
        sent_rr = sent_markings_for_user(self.db, self.initiator.name)
        self.assertEqual(len(sent_rr), 2)
        mark_a = next(m for m in sent_rr if m.to_user == self.user_a.name)
        add_note(
            self.db,
            letter=self.letter,
            actor_name=self.user_a.name,
            body_text="Done",
            marking_id=mark_a.id,
            is_response=True,
        )
        self.db.flush()
        self.assertEqual(len(sent_markings_for_user(self.db, self.initiator.name)), 1)
        self.assertIn(self.letter.id, letter_ids_held_by_user(self.db, self.initiator.name))

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
        # Revoke is not logged as last_action — remaining live mark label is kept.
        self.assertEqual(self.letter.assigned_to, self.user_a.name)
        self.assertEqual(self.letter.assigned_by, self.initiator.name)
        self.assertEqual(self.letter.last_action, "Marked (Forward)")
        self.assertFalse(leaf.track)

        revoke_marking(self.db, marking=parent, actor_name=self.initiator.name)
        self.db.flush()
        self.assertEqual(self.letter.assigned_to, self.initiator.name)
        self.assertEqual(self.letter.assigned_by, self.initiator.name)
        self.assertEqual(self.letter.last_action, "Registered")
        # Revoked markings must not remain in Workflow tree / Track for the recipient.
        self.assertEqual(marking_tree(self.db, self.letter.id), [])
        self.assertNotIn(self.letter.id, letter_ids_held_by_user(self.db, self.user_a.name))
        self.assertNotIn(self.letter.id, letter_ids_held_by_user(self.db, self.user_b.name))

    def test_assigned_to_lists_multiple_holders_and_truncates(self) -> None:
        user_c = User(
            name=f"UserC {uuid.uuid4().hex[:6]}",
            username=f"userc{uuid.uuid4().hex[:6]}",
            password_hash="!",
            role="Actionist",
            status="Active",
            department="Wing",
        )
        user_d = User(
            name=f"UserD {uuid.uuid4().hex[:6]}",
            username=f"userd{uuid.uuid4().hex[:6]}",
            password_hash="!",
            role="Actionist",
            status="Active",
            department="Wing",
        )
        self.db.add_all([user_c, user_d])
        self.db.flush()

        create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[
                {"toUser": self.user_a.name, "action": "for_info"},
                {"toUser": self.user_b.name, "action": "response_required", "responseType": "comments"},
            ],
        )
        self.db.flush()
        self.assertEqual(
            self.letter.assigned_to,
            f"{self.user_a.name}, {self.user_b.name}",
        )

        letter2 = Letter(
            number=_num(),
            letter_date=date.today(),
            received_date=date.today(),
            type="Incoming",
            subject="Multi assign",
            status="Open",
            priority="Routine",
            created_by=self.initiator.name,
            assigned_to=self.initiator.name,
            assigned_by=self.initiator.name,
        )
        self.db.add(letter2)
        self.db.flush()
        create_mark_batch(
            self.db,
            letter=letter2,
            actor_name=self.initiator.name,
            recipients=[
                {"toUser": self.user_a.name, "action": "for_info"},
                {"toUser": self.user_b.name, "action": "for_info"},
                {"toUser": user_c.name, "action": "for_info"},
                {"toUser": user_d.name, "action": "for_info"},
            ],
        )
        self.db.flush()
        # Full list stored; UI truncates preview and shows … popup for the rest.
        self.assertEqual(
            letter2.assigned_to,
            f"{self.user_a.name}, {self.user_b.name}, {user_c.name}, {user_d.name}",
        )

    def test_fan_out_creates_unique_path_ids_single_continues(self) -> None:
        batch = create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[
                {"toUser": self.user_a.name, "action": "forward"},
                {"toUser": self.user_b.name, "action": "forward"},
            ],
        )
        self.db.flush()
        siblings = self.db.query(Marking).filter(Marking.batch_id == batch.id).all()
        self.assertEqual(len(siblings), 2)
        paths = {m.path_id for m in siblings}
        self.assertEqual(len(paths), 2)
        self.assertTrue(all(m.path_id for m in siblings))
        self.assertTrue(all(m.direction == "forward" for m in siblings))

        mark_a = next(m for m in siblings if m.to_user == self.user_a.name)
        continue_batch = create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.user_a.name,
            parent_marking_id=mark_a.id,
            recipients=[{"toUser": self.initiator.name, "action": "for_info"}],
        )
        self.db.flush()
        child = self.db.query(Marking).filter(Marking.batch_id == continue_batch.id).one()
        self.assertEqual(child.path_id, mark_a.path_id)

        mark_b = next(m for m in siblings if m.to_user == self.user_b.name)
        fan = create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.user_b.name,
            parent_marking_id=mark_b.id,
            recipients=[
                {"toUser": self.user_a.name, "action": "forward"},
                {"toUser": self.initiator.name, "action": "forward"},
            ],
        )
        self.db.flush()
        branches = self.db.query(Marking).filter(Marking.batch_id == fan.id).all()
        self.assertEqual(len(branches), 2)
        branch_paths = {m.path_id for m in branches}
        self.assertEqual(len(branch_paths), 2)
        self.assertNotIn(mark_b.path_id, branch_paths)

    def test_reply_targets_previous_marker_and_keeps_path(self) -> None:
        # Initiator at root cannot reply (no inbound marking).
        with self.assertRaises(HTTPException) as ctx:
            create_mark_batch(
                self.db,
                letter=self.letter,
                actor_name=self.initiator.name,
                direction="reply",
                recipients=[{"toUser": self.user_a.name, "action": "forward"}],
            )
        self.assertEqual(ctx.exception.status_code, 400)

        batch = create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[{"toUser": self.user_a.name, "action": "forward"}],
        )
        self.db.flush()
        inbound = self.db.query(Marking).filter(Marking.batch_id == batch.id).one()
        path = inbound.path_id

        reply_batch = create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.user_a.name,
            parent_marking_id=inbound.id,
            direction="reply",
            recipients=[{"toUser": "ignored-wrong-user", "action": "forward"}],
        )
        self.db.flush()
        reply = self.db.query(Marking).filter(Marking.batch_id == reply_batch.id).one()
        self.assertEqual(reply.to_user, self.initiator.name)
        self.assertEqual(reply.direction, "reply")
        self.assertEqual(reply.path_id, path)
        self.assertEqual(reply.parent_marking_id, inbound.id)

    def test_staged_notes_and_attachments_publish_on_mark(self) -> None:
        """Draft comments/files on Forward are attached to each new marking path."""
        batch = create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[
                {
                    "toUser": self.user_a.name,
                    "action": "forward",
                    "notes": [{"bodyText": "Private for A"}],
                },
                {
                    "toUser": self.user_b.name,
                    "action": "forward",
                    "notes": [{"bodyText": "Private for B"}],
                },
            ],
            common_notes=[{"bodyText": "Shared to all"}],
            common_attachments=[
                {
                    "attachmentKind": "Supporting Doc",
                    "originalFilename": "brief.pdf",
                }
            ],
        )
        self.db.flush()
        marks = self.db.query(Marking).filter(Marking.batch_id == batch.id).all()
        self.assertEqual(len(marks), 2)
        mark_a = next(m for m in marks if m.to_user == self.user_a.name)
        mark_b = next(m for m in marks if m.to_user == self.user_b.name)

        notes_a = list_notes(self.db, self.letter.id, actor_name=self.user_a.name)
        bodies_a = {n["bodyText"] for n in notes_a}
        self.assertEqual(bodies_a, {"Private for A", "Shared to all"})
        self.assertTrue(all(n["markingId"] == mark_a.id for n in notes_a))

        notes_b = list_notes(self.db, self.letter.id, actor_name=self.user_b.name)
        bodies_b = {n["bodyText"] for n in notes_b}
        self.assertEqual(bodies_b, {"Private for B", "Shared to all"})

        # Cross-path isolation still applies.
        self.assertNotIn("Private for B", bodies_a)
        self.assertNotIn("Private for A", bodies_b)

        atts_a = list_attachments(self.db, self.letter.id, actor_name=self.user_a.name)
        self.assertEqual(len(atts_a), 1)
        self.assertEqual(atts_a[0]["markingId"], mark_a.id)
        self.assertEqual(atts_a[0]["originalFilename"], "brief.pdf")

        atts_b = list_attachments(self.db, self.letter.id, actor_name=self.user_b.name)
        self.assertEqual(len(atts_b), 1)
        self.assertEqual(atts_b[0]["markingId"], mark_b.id)

    def test_notes_and_tree_are_scoped_to_visible_paths(self) -> None:
        """Sibling fan-out paths cannot see each other's comments or pathway edges."""
        batch = create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[
                {"toUser": self.user_a.name, "action": "forward"},
                {"toUser": self.user_b.name, "action": "forward"},
            ],
        )
        self.db.flush()
        mark_a = (
            self.db.query(Marking)
            .filter(Marking.batch_id == batch.id, Marking.to_user == self.user_a.name)
            .one()
        )
        mark_b = (
            self.db.query(Marking)
            .filter(Marking.batch_id == batch.id, Marking.to_user == self.user_b.name)
            .one()
        )
        self.assertNotEqual(mark_a.path_id, mark_b.path_id)
        self.assertEqual(
            path_ids_visible_to_user(self.db, self.letter.id, self.user_a.name),
            {mark_a.path_id},
        )
        self.assertEqual(
            path_ids_visible_to_user(self.db, self.letter.id, self.user_b.name),
            {mark_b.path_id},
        )
        # Marker sees both paths.
        self.assertEqual(
            path_ids_visible_to_user(self.db, self.letter.id, self.initiator.name),
            {mark_a.path_id, mark_b.path_id},
        )

        note_a = add_note(
            self.db,
            letter=self.letter,
            actor_name=self.user_a.name,
            body_text="Only on path A",
            marking_id=mark_a.id,
        )
        note_b = add_note(
            self.db,
            letter=self.letter,
            actor_name=self.user_b.name,
            body_text="Only on path B",
            marking_id=mark_b.id,
        )
        self.db.flush()

        notes_for_a = list_notes(self.db, self.letter.id, actor_name=self.user_a.name)
        self.assertEqual({n["id"] for n in notes_for_a}, {note_a.id})
        notes_for_b = list_notes(self.db, self.letter.id, actor_name=self.user_b.name)
        self.assertEqual({n["id"] for n in notes_for_b}, {note_b.id})
        notes_for_marker = list_notes(self.db, self.letter.id, actor_name=self.initiator.name)
        self.assertEqual({n["id"] for n in notes_for_marker}, {note_a.id, note_b.id})

        tree_a = marking_tree(self.db, self.letter.id, actor_name=self.user_a.name)
        self.assertEqual(len(tree_a), 1)
        self.assertEqual(tree_a[0]["toUser"], self.user_a.name)
        tree_b = marking_tree(self.db, self.letter.id, actor_name=self.user_b.name)
        self.assertEqual(len(tree_b), 1)
        self.assertEqual(tree_b[0]["toUser"], self.user_b.name)

    def test_tree_shows_fan_out_under_middle_holder_for_upstream(self) -> None:
        """Initiator → holder → (A, B): upstream pathway must list both fan-out children.

        Fan-out mints new path_ids; without ancestor/descendant expansion those
        remakes were dropped from the tree and missing on the React Flow graph.
        """
        first = create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[{"toUser": self.user_a.name, "action": "forward"}],
        )
        self.db.flush()
        hold_a = (
            self.db.query(Marking)
            .filter(Marking.batch_id == first.id, Marking.to_user == self.user_a.name)
            .one()
        )
        create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.user_a.name,
            parent_marking_id=hold_a.id,
            recipients=[
                {"toUser": self.user_b.name, "action": "forward"},
                {"toUser": self.viewer.name, "action": "forward"},
            ],
        )
        self.db.flush()

        tree_init = marking_tree(self.db, self.letter.id, actor_name=self.initiator.name)
        self.assertEqual(len(tree_init), 1)
        self.assertEqual(tree_init[0]["toUser"], self.user_a.name)
        child_names = {c["toUser"] for c in tree_init[0]["children"]}
        self.assertEqual(child_names, {self.user_b.name, self.viewer.name})

        # Sibling privacy: B must not see viewer's branch under A.
        tree_b = marking_tree(self.db, self.letter.id, actor_name=self.user_b.name)
        flat_b: list[str] = []

        def walk(nodes: list[dict]) -> None:
            for n in nodes:
                flat_b.append(n["toUser"])
                walk(n.get("children") or [])

        walk(tree_b)
        self.assertIn(self.user_a.name, flat_b)
        self.assertIn(self.user_b.name, flat_b)
        self.assertNotIn(self.viewer.name, flat_b)

    def test_downstream_junior_sees_for_all_but_not_recipient_only(self) -> None:
        """For-all comments travel with remakes; recipient-only stay on the senior hop."""
        batch = create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[
                {
                    "toUser": self.user_a.name,
                    "action": "forward",
                    "notes": [{"bodyText": "This is for senior only"}],
                }
            ],
            common_notes=[{"bodyText": "This is for all"}],
        )
        self.db.flush()
        senior_mark = self.db.query(Marking).filter(Marking.batch_id == batch.id).one()

        create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.user_a.name,
            parent_marking_id=senior_mark.id,
            recipients=[
                {
                    "toUser": self.user_b.name,
                    "action": "forward",
                    "notes": [{"bodyText": "This is for junior"}],
                }
            ],
            common_notes=[{"bodyText": "Junior hop for all"}],
        )
        self.db.flush()
        junior_mark = (
            self.db.query(Marking)
            .filter(Marking.parent_marking_id == senior_mark.id, Marking.to_user == self.user_b.name)
            .one()
        )
        # Same pathway id after single-recipient remake.
        self.assertEqual(senior_mark.path_id, junior_mark.path_id)

        notes_junior = list_notes(self.db, self.letter.id, actor_name=self.user_b.name)
        bodies_junior = {n["bodyText"] for n in notes_junior}
        self.assertEqual(
            bodies_junior,
            {"This is for all", "This is for junior", "Junior hop for all"},
        )
        self.assertNotIn("This is for senior only", bodies_junior)
        by_body = {n["bodyText"]: n for n in notes_junior}
        self.assertEqual(by_body["This is for all"]["audience"], "all")
        self.assertEqual(by_body["This is for all"]["markingId"], senior_mark.id)
        self.assertEqual(by_body["This is for junior"]["audience"], "recipient")

        notes_senior = list_notes(self.db, self.letter.id, actor_name=self.user_a.name)
        bodies_senior = {n["bodyText"] for n in notes_senior}
        self.assertEqual(
            bodies_senior,
            {
                "This is for senior only",
                "This is for all",
                "This is for junior",
                "Junior hop for all",
            },
        )

        # Upstream marker may still audit recipient-only + shared notes.
        notes_marker = list_notes(self.db, self.letter.id, actor_name=self.initiator.name)
        bodies_marker = {n["bodyText"] for n in notes_marker}
        self.assertEqual(
            bodies_marker,
            {
                "This is for senior only",
                "This is for all",
                "This is for junior",
                "Junior hop for all",
            },
        )

    def test_draft_notes_publish_on_forward_consume(self) -> None:
        """Add Comment drafts for a user are published when Forward consumes them."""
        add_draft_note(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            body_text="For A only",
            target_user=self.user_a.name,
            intent="forward",
        )
        add_draft_note(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            body_text="Common to all",
            target_user="",
            intent="forward",
        )
        self.db.flush()
        bundle = list_drafts(self.db, self.letter.id, self.initiator.name)
        self.assertEqual(bundle["forwardTargetUsers"], [self.user_a.name])
        self.assertTrue(bundle["hasForwardDrafts"])
        self.assertFalse(bundle["hasReplyDrafts"])
        self.assertEqual(bundle["commonNoteCount"], 1)

        with self.assertRaises(HTTPException) as missing:
            create_mark_batch(
                self.db,
                letter=self.letter,
                actor_name=self.initiator.name,
                recipients=[{"toUser": self.user_b.name, "action": "forward"}],
                consume_drafts=True,
            )
        self.assertEqual(missing.exception.status_code, 400)
        self.assertIn("No draft", missing.exception.detail)

        create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[{"toUser": self.user_a.name, "action": "forward"}],
            consume_drafts=True,
        )
        self.db.flush()

        notes = (
            self.db.query(CorrespondenceNote)
            .filter(CorrespondenceNote.letter_id == self.letter.id)
            .order_by(CorrespondenceNote.id.asc())
            .all()
        )
        bodies = {n.body_text for n in notes}
        self.assertEqual(bodies, {"For A only", "Common to all"})
        remaining = list_drafts(self.db, self.letter.id, self.initiator.name)
        self.assertEqual(remaining["notes"], [])
        self.assertEqual(remaining["targetUsers"], [])

    def test_reply_and_forward_drafts_cannot_mix(self) -> None:
        add_draft_note(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            body_text="Reply draft",
            target_user=self.user_a.name,
            intent="reply",
        )
        self.db.flush()
        with self.assertRaises(HTTPException) as ctx:
            add_draft_note(
                self.db,
                letter=self.letter,
                actor_name=self.initiator.name,
                body_text="Forward draft",
                target_user=self.user_b.name,
                intent="forward",
            )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("reply drafts", ctx.exception.detail)

    def test_non_admin_cannot_remark_same_user_without_revoke(self) -> None:
        """After forwarding, sender loses hold — cannot re-forward / edit action until revoke."""
        create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[{"toUser": self.user_a.name, "action": "forward"}],
        )
        self.db.flush()
        self.assertNotIn("forward", available_marking_actions(self.db, self.letter, self.initiator.name))
        self.assertIn("revoke", available_marking_actions(self.db, self.letter, self.initiator.name))
        with self.assertRaises(HTTPException) as ctx:
            create_mark_batch(
                self.db,
                letter=self.letter,
                actor_name=self.initiator.name,
                recipients=[
                    {
                        "toUser": self.user_a.name,
                        "action": "response_required",
                        "responseType": "presentation",
                    }
                ],
                consume_drafts=False,
            )
        # No longer holds the letter → mutate denied (must revoke to regain hold / edit).
        self.assertEqual(ctx.exception.status_code, 403)

    def test_admin_can_update_existing_marking_action(self) -> None:
        admin = User(
            name=f"Admin {uuid.uuid4().hex[:6]}",
            username=f"admin{uuid.uuid4().hex[:6]}",
            password_hash="!",
            role="Administrator",
            status="Active",
            department="Secretariat",
        )
        self.db.add(admin)
        self.db.flush()
        letter = Letter(
            number=_num(),
            letter_date=date.today(),
            received_date=date.today(),
            type="Incoming",
            subject="Admin update marking",
            sender="External",
            recipient="Office",
            department="Secretariat",
            priority="Routine",
            status="Open",
            created_by=admin.name,
            last_action="Registered",
        )
        self.db.add(letter)
        self.db.flush()
        create_mark_batch(
            self.db,
            letter=letter,
            actor_name=admin.name,
            recipients=[{"toUser": self.user_a.name, "action": "forward"}],
            consume_drafts=False,
        )
        self.db.flush()
        marking = (
            self.db.query(Marking)
            .filter(Marking.letter_id == letter.id, Marking.to_user == self.user_a.name)
            .one()
        )
        self.assertEqual(marking.action, "forward")
        create_mark_batch(
            self.db,
            letter=letter,
            actor_name=admin.name,
            recipients=[
                {
                    "toUser": self.user_a.name,
                    "action": "response_required",
                    "responseType": "presentation",
                }
            ],
            consume_drafts=False,
        )
        self.db.flush()
        self.db.refresh(marking)
        self.assertEqual(marking.action, "response_required")
        self.assertEqual(marking.response_type, "presentation")
        self.assertEqual(
            self.db.query(Marking).filter(Marking.letter_id == letter.id, Marking.status == "active").count(),
            1,
        )
        self.db.query(Marking).filter(Marking.letter_id == letter.id).delete()
        self.db.query(Letter).filter(Letter.id == letter.id).delete()
        self.db.query(User).filter(User.id == admin.id).delete()
        self.db.flush()

    def test_revoke_removes_recipient_from_track_and_catalog_access(self) -> None:
        """After revoke, recipient loses owned/Track scope and Catalog unlock via marking."""
        from app.letter_access import owned_letter_filter, user_can_access_letter

        create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[{"toUser": self.user_a.name, "action": "forward"}],
        )
        self.db.flush()
        self.assertTrue(user_can_access_letter(self.db, self.letter, self.user_a.name, "Actionist"))
        owned = (
            self.db.query(Letter)
            .filter(owned_letter_filter(self.user_a.name), Letter.id == self.letter.id)
            .first()
        )
        self.assertIsNotNone(owned)

        marking = (
            self.db.query(Marking)
            .filter(Marking.letter_id == self.letter.id, Marking.to_user == self.user_a.name)
            .one()
        )
        revoke_marking(self.db, marking=marking, actor_name=self.initiator.name)
        self.db.flush()

        self.assertFalse(user_can_access_letter(self.db, self.letter, self.user_a.name, "Actionist"))
        owned_after = (
            self.db.query(Letter)
            .filter(owned_letter_filter(self.user_a.name), Letter.id == self.letter.id)
            .first()
        )
        self.assertIsNone(owned_after)
        self.assertEqual(marking_tree(self.db, self.letter.id, actor_name=self.user_a.name), [])
        self.assertNotIn("Revoked", self.letter.last_action or "")

    def test_legacy_assign_forward_creates_marking_and_inbox(self) -> None:
        """Row Assign/Forward must create a Marking so the recipient sees Inbox (not only assigned_to)."""
        from app.workflow_service import execute_transition

        self.letter.status = "Registered"
        self.letter.assigned_to = self.initiator.name
        self.db.flush()

        execute_transition(
            self.db,
            letter=self.letter,
            action="forward",
            actor_name=self.initiator.name,
            assigned_to=self.user_a.name,
            remarks="Please action",
        )
        self.db.flush()

        self.assertIn(self.letter.id, letter_ids_held_by_user(self.db, self.user_a.name))
        self.assertNotIn(self.letter.id, letter_ids_held_by_user(self.db, self.initiator.name))
        self.assertFalse(can_edit_letter_details(self.db, self.letter, self.initiator.name))
        self.assertEqual(self.letter.status, "Open")
        self.assertIn(self.user_a.name, self.letter.assigned_to or "")

        marking = (
            self.db.query(Marking)
            .filter(
                Marking.letter_id == self.letter.id,
                Marking.to_user == self.user_a.name,
                Marking.status == "active",
            )
            .one()
        )
        revoke_marking(self.db, marking=marking, actor_name=self.initiator.name)
        self.db.flush()
        self.assertTrue(can_edit_letter_details(self.db, self.letter, self.initiator.name))
        self.assertIn(self.letter.id, letter_ids_held_by_user(self.db, self.initiator.name))
        self.assertNotIn(self.letter.id, letter_ids_held_by_user(self.db, self.user_a.name))

    def test_registration_always_assigns_to_registrant(self) -> None:
        from app.letter_create_service import create_letter_record
        from app.schemas import LetterCreate

        payload = LetterCreate(
            number=_num(),
            letterDate=date.today(),
            type="Incoming",
            subject="Registered to self",
            from_="External",
            to="Office",
            department="Secretariat",
            priority="Routine",
            status="Registered",
            # Payload assignee is ignored; holder is always the registrant.
            assignedTo=self.user_a.name,
            correspondenceCategory="Actionable",
        )
        letter = create_letter_record(self.db, payload, actor=self.initiator.name)
        self.db.flush()
        self.assertEqual(letter.assigned_to, self.initiator.name)
        self.assertEqual(letter.correspondence_category, "Actionable")
        self.assertIn(letter.id, letter_ids_held_by_user(self.db, self.initiator.name))
        self.assertNotIn(letter.id, letter_ids_held_by_user(self.db, self.user_a.name))
        self.assertTrue(can_edit_letter_details(self.db, letter, self.initiator.name))
        # Cleanup extra letter created by this test.
        self.db.query(Marking).filter(Marking.letter_id == letter.id).delete()
        self.db.query(Letter).filter(Letter.id == letter.id).delete()
        self.db.flush()

    def test_draft_attachment_publish_on_forward(self) -> None:
        add_draft_attachments(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            target_user=self.user_a.name,
            intent="forward",
            attachments=[
                {
                    "attachmentKind": "Supporting Doc",
                    "documentId": None,
                    "storageKey": "drafts/test.pdf",
                    "originalFilename": "test.pdf",
                }
            ],
        )
        self.db.flush()
        create_mark_batch(
            self.db,
            letter=self.letter,
            actor_name=self.initiator.name,
            recipients=[{"toUser": self.user_a.name, "action": "forward"}],
            consume_drafts=True,
        )
        self.db.flush()
        atts = list_attachments(self.db, self.letter.id, actor_name=self.user_a.name)
        self.assertEqual(len(atts), 1)
        self.assertEqual(atts[0]["originalFilename"], "test.pdf")
        remaining = list_drafts(self.db, self.letter.id, self.initiator.name)
        self.assertEqual(remaining["attachments"], [])


if __name__ == "__main__":
    unittest.main()
