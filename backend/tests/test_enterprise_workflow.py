"""Enterprise workflow e2e: FYI path and Actionable → multi-tier approve → dispatch."""

from __future__ import annotations

import unittest
import uuid
from datetime import date
from unittest.mock import patch

from fastapi import HTTPException

from app.database import SessionLocal, engine
from app.db_upgrade import upgrade_enterprise_workflow_schema
from app.enterprise_workflow_service import (
    execute_enterprise_action,
    list_action_items,
    list_approval_steps_for_letter,
    list_dispatches,
    list_route_steps,
)
from app.models import Department, Letter, ResponseVersion, User


def _num(prefix: str = "ENT") -> str:
    return f"{prefix}/{uuid.uuid4().hex[:10].upper()}"


class EnterpriseWorkflowE2ETest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        upgrade_enterprise_workflow_schema(engine)

    def setUp(self) -> None:
        self.db = SessionLocal()
        suffix = uuid.uuid4().hex[:6]
        self.wing = Department(
            code=f"W{suffix}",
            name=f"Wing {suffix}",
            head="Mgr Wing",
            tier="Wing",
        )
        self.db.add(self.wing)
        self.db.flush()
        self.section = Department(
            code=f"S{suffix}",
            name=f"Section {suffix}",
            head="Mgr Section",
            parent_id=self.wing.id,
            tier="Section",
        )
        self.db.add(self.section)
        self.db.flush()

        self.coordinator = User(
            name=f"Coord {suffix}",
            username=f"coord{suffix}",
            department=self.wing.name,
            role="Coordinator",
            status="Active",
        )
        self.manager = User(
            name=f"Mgr {suffix}",
            username=f"mgr{suffix}",
            department=self.section.name,
            role="Manager",
            status="Active",
        )
        self.actionist = User(
            name=f"Act {suffix}",
            username=f"act{suffix}",
            department=self.section.name,
            role="Actionist",
            status="Active",
        )
        self.management = User(
            name=f"Mgmt {suffix}",
            username=f"mgmt{suffix}",
            department=self.wing.name,
            role="Management",
            status="Active",
        )
        # Unique head names for this run
        self.wing.head = self.management.name
        self.section.head = self.manager.name
        self.db.add_all([self.coordinator, self.manager, self.actionist, self.management])
        self.db.flush()

        self.letter = Letter(
            number=_num(),
            letter_date=date.today(),
            received_date=date.today(),
            type="Incoming",
            subject="Enterprise workflow test",
            sender="External Org",
            recipient="Secretariat",
            department=self.wing.name,
            department_id=self.wing.id,
            priority="Important",
            status="Registered",
            created_by=self.coordinator.name,
            last_action="Registered",
        )
        self.db.add(self.letter)
        self.db.commit()
        self.db.refresh(self.letter)

    def tearDown(self) -> None:
        try:
            self.db.rollback()
            if getattr(self, "letter", None) and self.letter.id:
                self.db.query(Letter).filter(Letter.id == self.letter.id).delete()
            for u in (self.coordinator, self.manager, self.actionist, self.management):
                self.db.query(User).filter(User.id == u.id).delete()
            self.db.query(Department).filter(Department.id == self.section.id).delete()
            self.db.query(Department).filter(Department.id == self.wing.id).delete()
            self.db.commit()
        finally:
            self.db.close()

    def test_information_path_closes_as_delivered(self) -> None:
        execute_enterprise_action(
            self.db,
            letter=self.letter,
            action="validate",
            actor_name=self.coordinator.name,
        )
        self.assertEqual(self.letter.status, "Validated")

        execute_enterprise_action(
            self.db,
            letter=self.letter,
            action="classify",
            actor_name=self.coordinator.name,
            category="Information",
        )
        self.assertEqual(self.letter.correspondence_category, "Information")
        self.assertEqual(self.letter.status, "Classified")

        execute_enterprise_action(
            self.db,
            letter=self.letter,
            action="route_info",
            actor_name=self.coordinator.name,
            info_recipients=[{"user": self.actionist.name}],
        )
        routes = list_route_steps(self.db, self.letter.id)
        self.assertTrue(any(r["stepType"] == "INFO" and r["toUser"] == self.actionist.name for r in routes))

        execute_enterprise_action(
            self.db,
            letter=self.letter,
            action="close_information",
            actor_name=self.coordinator.name,
        )
        self.assertEqual(self.letter.status, "Information Delivered")
        self.assertEqual(self.letter.close_reason, "INFORMATION_DELIVERED")
        self.db.commit()

    def test_actionable_path_to_dispatch(self) -> None:
        execute_enterprise_action(
            self.db, letter=self.letter, action="validate", actor_name=self.coordinator.name
        )
        execute_enterprise_action(
            self.db,
            letter=self.letter,
            action="classify",
            actor_name=self.coordinator.name,
            category="Actionable",
        )
        self.assertEqual(self.letter.status, "Pending Routing Approval")

        execute_enterprise_action(
            self.db,
            letter=self.letter,
            action="approve_routing",
            actor_name=self.management.name,
            assigned_to=self.manager.name,
            department_id=self.wing.id,
            remarks="Lead wing assigned",
        )
        self.assertEqual(self.letter.status, "Routed")

        execute_enterprise_action(
            self.db,
            letter=self.letter,
            action="delegate",
            actor_name=self.manager.name,
            assigned_to=self.actionist.name,
            department_id=self.section.id,
            instructions="Prepare reply",
        )
        self.assertEqual(self.letter.status, "Action Assigned")
        items = list_action_items(self.db, self.letter.id)
        self.assertTrue(any(i["assignee"] == self.actionist.name for i in items))

        execute_enterprise_action(
            self.db,
            letter=self.letter,
            action="start_action",
            actor_name=self.actionist.name,
        )
        self.assertEqual(self.letter.status, "In Progress")

        execute_enterprise_action(
            self.db,
            letter=self.letter,
            action="draft_response",
            actor_name=self.actionist.name,
            response_body="Thank you for your letter. We confirm receipt and will proceed.",
        )
        self.assertEqual(self.letter.status, "Response Drafted")

        execute_enterprise_action(
            self.db,
            letter=self.letter,
            action="submit_for_approval",
            actor_name=self.actionist.name,
        )
        self.assertEqual(self.letter.status, "Under Approval")
        steps = list_approval_steps_for_letter(self.db, self.letter.id)
        self.assertGreaterEqual(len(steps), 1, msg=f"steps={steps}")
        pending_steps = [s for s in steps if s["status"] == "Pending"]
        self.assertTrue(pending_steps, msg=f"all steps={steps}")

        for step in sorted(pending_steps, key=lambda s: s["tierOrder"]):
            reviewer = step["reviewer"] or self.management.name
            if reviewer == self.actionist.name:
                reviewer = self.management.name
            execute_enterprise_action(
                self.db,
                letter=self.letter,
                action="approve_step",
                actor_name=reviewer,
                approval_step_id=step["id"],
                remarks="Approved",
            )

        self.assertEqual(self.letter.status, "Approved for Dispatch")

        execute_enterprise_action(
            self.db,
            letter=self.letter,
            action="dispatch",
            actor_name=self.management.name,
            dispatch_channel="External",
            dispatch_recipients="External Org",
            remarks="Dispatched via secretariat",
        )
        self.assertEqual(self.letter.status, "Closed")
        self.assertEqual(self.letter.close_reason, "DISPATCHED")
        self.assertTrue(list_dispatches(self.db, self.letter.id))
        self.db.commit()

    def test_return_for_revision_loop(self) -> None:
        self.letter.status = "Response Drafted"
        self.letter.correspondence_category = "Actionable"
        self.db.add(
            ResponseVersion(
                letter_id=self.letter.id,
                version=1,
                body_text="Draft v1",
                status="Draft",
                prepared_by=self.actionist.name,
            )
        )
        self.db.flush()
        execute_enterprise_action(
            self.db,
            letter=self.letter,
            action="submit_for_approval",
            actor_name=self.actionist.name,
        )
        steps = list_approval_steps_for_letter(self.db, self.letter.id)
        step = next(s for s in steps if s["status"] == "Pending")
        reviewer = step["reviewer"] or self.manager.name
        if reviewer == self.actionist.name:
            reviewer = self.manager.name
        execute_enterprise_action(
            self.db,
            letter=self.letter,
            action="return_for_revision",
            actor_name=reviewer,
            approval_step_id=step["id"],
            remarks="Please strengthen the second paragraph",
        )
        self.assertEqual(self.letter.status, "Returned for Revision")
        version = (
            self.db.query(ResponseVersion)
            .filter(ResponseVersion.letter_id == self.letter.id)
            .order_by(ResponseVersion.version.desc())
            .first()
        )
        self.assertEqual(version.status, "Draft")
        self.db.commit()

    def test_actionist_cannot_validate_llm_analyzed(self) -> None:
        self.letter.status = "LLM Analyzed"
        self.db.flush()
        with self.assertRaises(HTTPException) as ctx:
            execute_enterprise_action(
                self.db,
                letter=self.letter,
                action="validate",
                actor_name=self.actionist.name,
            )
        self.assertIn(ctx.exception.status_code, {403, 400})


if __name__ == "__main__":
    unittest.main()
