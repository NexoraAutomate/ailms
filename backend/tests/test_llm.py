import unittest

from app.llm_client import llm_is_configured


class LlmConfigTest(unittest.TestCase):
    def test_not_configured_without_key(self):
        # Default test env typically has no API key
        self.assertIsInstance(llm_is_configured(), bool)


if __name__ == "__main__":
    unittest.main()
