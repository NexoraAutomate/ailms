import unittest

from fastapi import HTTPException

from app.document_service import next_version_number
from app.storage_service import build_storage_key, resolve_storage_path


class VersionNumberTest(unittest.TestCase):
    def test_sequence(self):
        self.assertEqual(next_version_number([]), "1.0")
        self.assertEqual(next_version_number(["1.0"]), "1.1")
        self.assertEqual(next_version_number(["1.0", "1.1"]), "1.2")


class StoragePathTest(unittest.TestCase):
    def test_storage_key_safe(self):
        key = build_storage_key(letter_id=1, document_id=2, version_id=3, original_filename="report.pdf")
        self.assertTrue(key.startswith("documents/1/2/"))
        self.assertIn("report.pdf", key)

    def test_traversal_blocked(self):
        with self.assertRaises(HTTPException):
            resolve_storage_path("../outside.txt")


if __name__ == "__main__":
    unittest.main()
