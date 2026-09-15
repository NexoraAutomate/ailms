import unittest

from app.notification_service import infer_notification_type, navigation_hint
from app.models import Notification


class NotificationServiceTest(unittest.TestCase):
    def test_infer_type(self):
        self.assertEqual(infer_notification_type("New Assignment"), "New Assignment")
        self.assertEqual(infer_notification_type("Due Today"), "Due Today")

    def test_navigation_letter(self):
        item = Notification(
            title="Test",
            description="",
            letter_id=12,
            related_entity_type="letter",
            related_entity_id="12",
        )
        target, label = navigation_hint(item)
        self.assertEqual(target, "12")
        self.assertEqual(label, "Open letter")


if __name__ == "__main__":
    unittest.main()
