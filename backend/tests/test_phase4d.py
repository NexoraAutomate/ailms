import unittest

from app.correspondence_service import RELATIONSHIP_TYPES


class CorrespondenceTypesTest(unittest.TestCase):
    def test_relationship_types(self):
        self.assertIn("Reply", RELATIONSHIP_TYPES)
        self.assertIn("Supersedes", RELATIONSHIP_TYPES)
        self.assertEqual(len(RELATIONSHIP_TYPES), 10)


if __name__ == "__main__":
    unittest.main()
