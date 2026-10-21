"""Streaming chat-completion deltas (OpenAI-compatible SSE)."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from app.config import Settings
from app.llm_client import chat_completion_stream, delta_from_sse_line


def _settings() -> Settings:
    return Settings(
        llm_enabled=True,
        llm_provider="openai",
        llm_openai_api_key="sk-test",
        llm_openai_model="gpt-4o-mini",
        llm_openai_base_url="https://api.openai.com/v1",
        llm_allowed_hosts="",
        llm_timeout_seconds=30,
        llm_extra_body_json="",
    )


class SseDeltaParseTest(unittest.TestCase):
    def test_content_delta(self):
        line = 'data: {"choices":[{"delta":{"content":"Hello"}}]}'
        self.assertEqual(delta_from_sse_line(line), "Hello")

    def test_whitespace_delta_is_kept(self):
        line = 'data: {"choices":[{"delta":{"content":" "}}]}'
        self.assertEqual(delta_from_sse_line(line), " ")

    def test_done_and_role_chunks_are_ignored(self):
        self.assertIsNone(delta_from_sse_line("data: [DONE]"))
        self.assertIsNone(delta_from_sse_line('data: {"choices":[{"delta":{"role":"assistant"}}]}'))
        self.assertIsNone(delta_from_sse_line(""))
        self.assertIsNone(delta_from_sse_line(": keep-alive"))


class _FakeStream:
    def __init__(self, lines: list[str], status: int = 200):
        self.status_code = status
        self._lines = lines

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def aiter_lines(self):
        for line in self._lines:
            yield line

    async def aread(self):
        return b""


class _FakeClient:
    def __init__(self, stream):
        self._stream = stream
        self.calls = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    def stream(self, *_args, **_kwargs):
        self.calls += 1
        return self._stream


class ChatCompletionStreamTest(unittest.IsolatedAsyncioTestCase):
    async def test_yields_text_deltas_in_order(self):
        lines = [
            'data: {"choices":[{"delta":{"role":"assistant"}}]}',
            'data: {"choices":[{"delta":{"content":"Three"}}]}',
            'data: {"choices":[{"delta":{"content":" letters"}}]}',
            "data: [DONE]",
        ]
        client = _FakeClient(_FakeStream(lines))
        with (
            patch("app.llm_client.get_settings", return_value=_settings()),
            patch("app.llm_client.httpx.AsyncClient", return_value=client),
        ):
            parts = [
                delta
                async for delta in chat_completion_stream(system="s", user="u", temperature=0.3)
            ]
        self.assertEqual("".join(parts), "Three letters")
        self.assertEqual(client.calls, 1)
