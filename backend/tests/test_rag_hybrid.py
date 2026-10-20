"""Unit tests for hybrid RAG chunker, RRF fusion, and query router."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from app.rag.chunker import chunk_letter, chunk_text, content_hash
from app.rag.hybrid_search import rrf_fuse
from app.rag.router import RetrievalMode, extract_letter_number_hints, route_query


class ChunkerTest(unittest.TestCase):
    def test_empty_returns_no_chunks(self):
        self.assertEqual(chunk_text(""), [])
        self.assertEqual(chunk_letter(subject="", body_text=""), [])

    def test_short_text_single_chunk(self):
        chunks = chunk_text("Hello pension increase notice.", chunk_size=1200, overlap=200)
        self.assertEqual(len(chunks), 1)
        self.assertIn("pension", chunks[0])

    def test_overlap_produces_multiple_chunks(self):
        body = ("Paragraph about pensions. " * 40) + ("\n\nOther topic. " * 40)
        chunks = chunk_text(body, chunk_size=200, overlap=40)
        self.assertGreaterEqual(len(chunks), 2)

    def test_letter_includes_subject_and_number(self):
        chunks = chunk_letter(
            number="FD-1/2026",
            subject="Pension Increase",
            body_text="Details of the increase follow.",
            chunk_size=1200,
            overlap=0,
        )
        self.assertEqual(len(chunks), 1)
        self.assertIn("FD-1/2026", chunks[0])
        self.assertIn("Pension Increase", chunks[0])

    def test_content_hash_stable(self):
        self.assertEqual(content_hash("abc"), content_hash("abc"))
        self.assertNotEqual(content_hash("abc"), content_hash("abd"))


class RrfFuseTest(unittest.TestCase):
    def test_prefers_items_in_both_lists(self):
        fused = rrf_fuse([[10, 20, 30], [20, 40, 10]], k=60, limit=3)
        self.assertEqual(fused[0], 20)
        self.assertIn(10, fused)

    def test_single_list(self):
        self.assertEqual(rrf_fuse([[5, 6, 7]], limit=2), [5, 6])

    def test_empty(self):
        self.assertEqual(rrf_fuse([]), [])


class QueryRouterTest(unittest.TestCase):
    def test_natural_language_is_hybrid(self):
        self.assertEqual(
            route_query("is there any letter about pension increase?"),
            RetrievalMode.HYBRID,
        )

    def test_quoted_phrase_is_keyword(self):
        self.assertEqual(route_query('"pension increase"'), RetrievalMode.KEYWORD)

    def test_letter_number_hint_is_keyword(self):
        self.assertEqual(route_query("FD-113/2026"), RetrievalMode.KEYWORD)
        hints = extract_letter_number_hints("letter number FD-113/2026 please")
        self.assertTrue(any("113" in h or "FD" in h.upper() for h in hints))

    def test_embeddings_disabled_natural_search_keyword_path(self):
        """When hybrid is on but embeddings are off, natural_search uses keywords only."""
        import asyncio
        from unittest.mock import MagicMock

        from app.ai_service import natural_search

        letter = MagicMock()
        letter.id = 1
        letter.number = "X-1"
        letter.subject = "Pension"
        letter.sender = ""
        letter.department = ""
        letter.status = "Open"
        letter.remarks = ""
        letter.is_archived = False
        letter.body_text = "pension increase for civil servants"

        query = MagicMock()
        query.filter.return_value = query
        query.all.return_value = [letter]
        db = MagicMock()
        db.query.return_value = query

        settings = MagicMock()
        settings.rag_hybrid_enabled = True
        settings.embedding_enabled = True

        with (
            patch("app.config.get_settings", return_value=settings),
            patch("app.rag.embed_client.embeddings_are_configured", return_value=False),
            patch("app.services.current_user_name", return_value="Admin"),
            patch("app.letter_access.resolve_user_role", return_value="Administrator"),
            patch("app.letter_access.is_administrator", return_value=True),
            patch(
                "app.ai_service.serialize_letter",
                return_value=MagicMock(
                    model_dump=MagicMock(
                        return_value={"id": 1, "number": "X-1", "subject": "Pension"}
                    )
                ),
            ),
        ):
            result = asyncio.run(natural_search(db, "letter about pension"))

        self.assertEqual(result["filters"].get("Retrieval"), "keyword")
        self.assertEqual(len(result["letters"]), 1)


if __name__ == "__main__":
    unittest.main()
