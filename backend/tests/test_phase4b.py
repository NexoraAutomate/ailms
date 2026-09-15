import unittest

from app.escalation_service import ESCALATION_LEVELS
from app.reminder_service import _rules_for_delta


class ReminderRulesTest(unittest.TestCase):
    def test_before_due_rules(self):
        self.assertEqual(len(_rules_for_delta(7)), 1)
        self.assertEqual(_rules_for_delta(7)[0].key, "before_7d")

    def test_due_today(self):
        self.assertEqual(_rules_for_delta(0)[0].key, "due_today")

    def test_overdue_rules(self):
        self.assertEqual(_rules_for_delta(-7)[0].key, "overdue_7d")


class EscalationTest(unittest.TestCase):
    def test_levels(self):
        self.assertEqual(len(ESCALATION_LEVELS), 3)


if __name__ == "__main__":
    unittest.main()
