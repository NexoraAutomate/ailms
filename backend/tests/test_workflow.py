import unittest

from app.workflow_service import TRANSITION_RULES, validate_transition


class WorkflowRulesTest(unittest.TestCase):
    def test_known_actions_registered(self):
        self.assertIn("assign", TRANSITION_RULES)
        self.assertIn("submit_for_approval", TRANSITION_RULES)
        self.assertIn("archive", TRANSITION_RULES)


if __name__ == "__main__":
    unittest.main()
