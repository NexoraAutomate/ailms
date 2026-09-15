import io
import unittest
from datetime import date
from unittest.mock import MagicMock

from fastapi import UploadFile

from app.archive_service import archive_letters, assert_active_letter
from app.import_service import _normalize_header, _parse_date, _validate_row
from app.models import Letter


class Phase4FHelpersTest(unittest.TestCase):
    def test_normalize_header(self):
        self.assertEqual(_normalize_header("Letter Date"), "letterdate")

    def test_parse_date(self):
        self.assertEqual(_parse_date("2024-01-15"), date(2024, 1, 15))
        self.assertIsNone(_parse_date("not-a-date"))


class ArchiveTest(unittest.TestCase):
    def test_assert_active_letter_blocks_archived(self):
        letter = Letter(number="X", subject="S", letter_date=date.today(), received_date=date.today(), is_archived=True)
        from fastapi import HTTPException

        with self.assertRaises(HTTPException):
            assert_active_letter(letter)


if __name__ == "__main__":
    unittest.main()
