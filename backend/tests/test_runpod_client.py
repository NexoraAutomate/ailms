"""Unit tests for Runpod queue-based LLM client and provider wiring."""

from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException

from app.config import Settings
from app.llm_client import assert_llm_host_allowed, llm_is_configured
from app.runpod_client import extract_text_from_runpod_output, runpod_is_configured


def _settings(**overrides) -> Settings:
    base = dict(
        llm_enabled=True,
        llm_provider="runpod",
        llm_api_key="",
        llm_base_url="",
        llm_model="Qwen/Qwen3-8B",
        llm_timeout_seconds=120,
        llm_max_tokens=4096,
        llm_extra_body_json="",
        llm_allowed_hosts="api.runpod.ai",
        ai_log_document_text=False,
        runpod_api_key="rpa_test_key",
        runpod_endpoint_id="br96s8zyygjs24",
        runpod_use_async=False,
        runpod_poll_interval_seconds=0.01,
        runpod_max_wait_seconds=5,
    )
    base.update(overrides)
    return Settings(**base)


class RunpodOutputParseTest(unittest.TestCase):
    def test_openai_chat_message_content(self):
        output = {
            "choices": [{"message": {"role": "assistant", "content": "Hello there"}}]
        }
        self.assertEqual(extract_text_from_runpod_output(output), "Hello there")

    def test_choices_tokens_list(self):
        output = {"choices": [{"tokens": ["Hel", "lo"]}]}
        self.assertEqual(extract_text_from_runpod_output(output), "Hello")

    def test_list_wrapper(self):
        output = [{"choices": [{"message": {"content": "wrapped"}}]}]
        self.assertEqual(extract_text_from_runpod_output(output), "wrapped")

    def test_plain_string(self):
        self.assertEqual(extract_text_from_runpod_output("plain"), "plain")

    def test_empty_raises(self):
        with self.assertRaises(ValueError):
            extract_text_from_runpod_output({})


class RunpodConfiguredTest(unittest.TestCase):
    def test_configured_with_key_and_endpoint(self):
        self.assertTrue(runpod_is_configured(_settings()))

    def test_missing_key(self):
        self.assertFalse(runpod_is_configured(_settings(runpod_api_key="")))

    def test_llm_is_configured_runpod(self):
        with patch("app.llm_client.get_settings", return_value=_settings()):
            self.assertTrue(llm_is_configured())

    def test_llm_not_configured_without_key(self):
        with patch(
            "app.llm_client.get_settings",
            return_value=_settings(runpod_api_key=""),
        ):
            self.assertFalse(llm_is_configured())

    def test_host_allowlist_requires_runpod(self):
        # Runpod egress host is hardcoded; allowlist does not apply.
        assert_llm_host_allowed(_settings(llm_allowed_hosts="api.runpod.ai"))
        assert_llm_host_allowed(_settings(llm_allowed_hosts="127.0.0.1"))


class RunpodChatCompletionTest(unittest.IsolatedAsyncioTestCase):
    async def test_runsync_success(self):
        from app.runpod_client import chat_completion_runpod

        settings = _settings(runpod_use_async=False)
        response = MagicMock()
        response.status_code = 200
        response.json.return_value = {
            "status": "COMPLETED",
            "output": {
                "choices": [{"message": {"content": "synced reply"}}],
            },
        }
        response.text = ""

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with (
            patch("app.runpod_client.get_settings", return_value=settings),
            patch("app.runpod_client.httpx.AsyncClient", return_value=mock_client),
        ):
            text = await chat_completion_runpod(system="sys", user="usr")

        self.assertEqual(text, "synced reply")
        mock_client.post.assert_awaited()
        args, kwargs = mock_client.post.await_args
        self.assertTrue(str(args[0]).endswith("/runsync"))
        self.assertIn("messages", kwargs["json"]["input"])

    async def test_async_run_then_status(self):
        from app.runpod_client import chat_completion_runpod

        settings = _settings(runpod_use_async=True)
        submit = MagicMock()
        submit.status_code = 200
        submit.json.return_value = {"id": "job-1", "status": "IN_QUEUE"}
        submit.text = ""

        status = MagicMock()
        status.status_code = 200
        status.json.return_value = {
            "id": "job-1",
            "status": "COMPLETED",
            "output": {"choices": [{"message": {"content": "async reply"}}]},
        }
        status.text = ""

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=submit)
        mock_client.get = AsyncMock(return_value=status)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with (
            patch("app.runpod_client.get_settings", return_value=settings),
            patch("app.runpod_client.httpx.AsyncClient", return_value=mock_client),
        ):
            text = await chat_completion_runpod(system="sys", user="usr")

        self.assertEqual(text, "async reply")
        args, _ = mock_client.post.await_args
        self.assertTrue(str(args[0]).endswith("/run"))
        mock_client.get.assert_awaited()

    async def test_chat_completion_delegates_to_runpod(self):
        from app.llm_client import chat_completion

        settings = _settings()
        with (
            patch("app.llm_client.get_settings", return_value=settings),
            patch(
                "app.runpod_client.chat_completion_runpod",
                new=AsyncMock(return_value="via runpod"),
            ) as mocked,
        ):
            text = await chat_completion(system="s", user="u")
        self.assertEqual(text, "via runpod")
        mocked.assert_awaited_once()

    async def test_probe_health_ok(self):
        from app.runpod_client import probe_runpod_health

        settings = _settings()
        response = MagicMock()
        response.status_code = 200
        response.text = "{}"

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with (
            patch("app.runpod_client.get_settings", return_value=settings),
            patch("app.runpod_client.httpx.AsyncClient", return_value=mock_client),
        ):
            result = await probe_runpod_health()

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["endpointId"], "br96s8zyygjs24")

    async def test_runsync_http_error(self):
        from app.runpod_client import chat_completion_runpod

        settings = _settings()
        response = MagicMock()
        response.status_code = 401
        response.text = "unauthorized"

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with (
            patch("app.runpod_client.get_settings", return_value=settings),
            patch("app.runpod_client.httpx.AsyncClient", return_value=mock_client),
            self.assertRaises(HTTPException) as ctx,
        ):
            await chat_completion_runpod(system="s", user="u")
        self.assertEqual(ctx.exception.status_code, 503)


class AiStatusRunpodTest(unittest.TestCase):
    def test_ai_status_includes_endpoint(self):
        from app.ai_service import ai_status
        import app.config as config_mod

        settings = _settings()
        with (
            patch("app.ai_service.llm_is_configured", return_value=True),
            patch.object(config_mod, "get_settings", return_value=settings),
        ):
            status = ai_status()
        self.assertEqual(status["provider"], "runpod")
        self.assertEqual(status["endpointId"], "br96s8zyygjs24")
        self.assertIn("br96s8zyygjs24", status["baseUrl"])


if __name__ == "__main__":
    unittest.main()
