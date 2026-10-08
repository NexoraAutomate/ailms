"""Unit tests for LLM provider abstraction (master plan step 1)."""

from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from app.ai.llm_provider import OpenAiCompatibleProvider, get_llm_provider
from app.config import Settings
from app.llm_client import llm_is_configured


def _settings(**overrides) -> Settings:
    base = dict(
        llm_enabled=True,
        llm_provider="ollama",
        llm_api_key="",
        llm_base_url="",
        llm_model="",
        llm_timeout_seconds=120,
        llm_max_tokens=4096,
        llm_extra_body_json="",
        llm_allowed_hosts="127.0.0.1,localhost",
        ai_log_document_text=False,
        llm_ollama_base_url="http://127.0.0.1:11434/v1",
        llm_ollama_api_key="",
        llm_ollama_model="qwen2.5:7b",
        llm_vllm_base_url="http://127.0.0.1:8001/v1",
        llm_vllm_api_key="",
        llm_vllm_model="Qwen/Qwen3-8B",
        llm_openai_base_url="https://api.openai.com/v1",
        llm_openai_api_key="",
        llm_openai_model="gpt-4o-mini",
        llm_runpod_model="Qwen/Qwen3-8B",
        runpod_api_key="",
        runpod_endpoint_id="br96s8zyygjs24",
        runpod_use_async=False,
        runpod_poll_interval_seconds=1.5,
        runpod_max_wait_seconds=300,
    )
    base.update(overrides)
    return Settings(**base)


class LlmProviderConfigTest(unittest.TestCase):
    def test_ollama_configured_without_api_key(self):
        """Local Ollama needs base URL only — no cloud API key."""
        with patch("app.llm_client.get_settings", return_value=_settings()):
            self.assertTrue(llm_is_configured())

    def test_vllm_configured_without_api_key(self):
        with patch(
            "app.llm_client.get_settings",
            return_value=_settings(llm_provider="vllm"),
        ):
            self.assertTrue(llm_is_configured())

    def test_openai_requires_api_key(self):
        with patch(
            "app.llm_client.get_settings",
            return_value=_settings(llm_provider="openai", llm_openai_api_key=""),
        ):
            self.assertFalse(llm_is_configured())

    def test_runpod_requires_api_key_and_endpoint(self):
        with patch(
            "app.llm_client.get_settings",
            return_value=_settings(
                llm_provider="runpod",
                runpod_api_key="rpa_x",
                runpod_endpoint_id="br96s8zyygjs24",
            ),
        ):
            self.assertTrue(llm_is_configured())

        with patch(
            "app.llm_client.get_settings",
            return_value=_settings(
                llm_provider="runpod",
                runpod_api_key="",
                runpod_endpoint_id="br96s8zyygjs24",
            ),
        ):
            self.assertFalse(llm_is_configured())

    def test_disabled_not_configured(self):
        with patch(
            "app.llm_client.get_settings",
            return_value=_settings(llm_enabled=False),
        ):
            self.assertFalse(llm_is_configured())

    def test_ollama_requires_base_url(self):
        with patch(
            "app.llm_client.get_settings",
            return_value=_settings(llm_ollama_base_url=""),
        ):
            self.assertFalse(llm_is_configured())


class LlmProviderProfileSwitchTest(unittest.TestCase):
    def test_switching_provider_changes_active_model_and_url(self):
        ollama = _settings(llm_provider="ollama")
        runpod = _settings(llm_provider="runpod", runpod_api_key="rpa_x")
        openai = _settings(llm_provider="openai", llm_openai_api_key="sk-test")

        self.assertEqual(ollama.active_llm_model, "qwen2.5:7b")
        self.assertEqual(ollama.active_llm_base_url, "http://127.0.0.1:11434/v1")

        self.assertEqual(runpod.active_llm_model, "Qwen/Qwen3-8B")
        self.assertEqual(runpod.active_llm_base_url, "")

        self.assertEqual(openai.active_llm_model, "gpt-4o-mini")
        self.assertEqual(openai.active_llm_base_url, "https://api.openai.com/v1")
        self.assertEqual(openai.active_llm_api_key, "sk-test")

    def test_auto_allowlist_follows_provider(self):
        self.assertEqual(
            _settings(llm_provider="ollama", llm_allowed_hosts="auto").active_llm_allowed_hosts,
            "127.0.0.1,localhost",
        )
        self.assertEqual(
            _settings(llm_provider="openai", llm_allowed_hosts="auto").active_llm_allowed_hosts,
            "api.openai.com",
        )
        self.assertEqual(
            _settings(llm_provider="runpod", llm_allowed_hosts="auto").active_llm_allowed_hosts,
            "api.runpod.ai",
        )


class LlmProviderFactoryTest(unittest.TestCase):
    def test_factory_returns_openai_compatible(self):
        provider = get_llm_provider(_settings())
        self.assertIsInstance(provider, OpenAiCompatibleProvider)
        self.assertEqual(provider.provider_name, "ollama")
        self.assertEqual(provider.model_id, "qwen2.5:7b")

    def test_provider_is_configured_delegates(self):
        settings = _settings()
        provider = OpenAiCompatibleProvider(settings=settings)
        with patch("app.ai.llm_provider.llm_is_configured", return_value=True):
            self.assertTrue(provider.is_configured())


class LlmProviderHealthTest(unittest.IsolatedAsyncioTestCase):
    async def test_health_ok_shape(self):
        provider = OpenAiCompatibleProvider(_settings())
        fake = {
            "status": "ok",
            "provider": "ollama",
            "model": "qwen2.5:7b",
            "latencyMs": 12,
        }
        with patch("app.ai.llm_provider.probe_llm_health", new=AsyncMock(return_value=fake)):
            result = await provider.health()
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["provider"], "ollama")
        self.assertIn("latencyMs", result)

    async def test_complete_json_returns_dict(self):
        provider = OpenAiCompatibleProvider(_settings())
        with (
            patch("app.ai.llm_provider.llm_is_configured", return_value=True),
            patch("app.ai.llm_provider.chat_json", new=AsyncMock(return_value={"ok": True})),
        ):
            result = await provider.complete_json(system="sys", user="usr")
        self.assertEqual(result, {"ok": True})


class LlmAuthHeaderTest(unittest.TestCase):
    def test_local_provider_sends_dummy_key_when_empty(self):
        from app.llm_client import _auth_header_value

        with patch("app.llm_client.get_settings", return_value=_settings(llm_ollama_api_key="")):
            self.assertEqual(_auth_header_value(), "ollama")

        with patch(
            "app.llm_client.get_settings",
            return_value=_settings(llm_provider="vllm", llm_vllm_api_key=""),
        ):
            self.assertEqual(_auth_header_value(), "EMPTY")


class LlmHostAllowlistTest(unittest.TestCase):
    def test_default_allows_loopback(self):
        from app.llm_client import assert_llm_host_allowed

        assert_llm_host_allowed(_settings())

    def test_rejects_non_allowlisted_host(self):
        from app.llm_client import LlmHostNotAllowedError, assert_llm_host_allowed

        with self.assertRaises(LlmHostNotAllowedError):
            assert_llm_host_allowed(
                _settings(llm_ollama_base_url="https://api.openai.com/v1")
            )

    def test_empty_allowlist_disables_filter(self):
        from app.llm_client import assert_llm_host_allowed

        assert_llm_host_allowed(
            _settings(
                llm_ollama_base_url="https://api.openai.com/v1",
                llm_allowed_hosts="",
            )
        )


if __name__ == "__main__":
    unittest.main()
