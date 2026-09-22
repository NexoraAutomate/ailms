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
        llm_base_url="http://127.0.0.1:11434/v1",
        llm_model="qwen2.5:7b",
        llm_timeout_seconds=120,
        llm_max_tokens=4096,
        llm_extra_body_json="",
        ai_log_document_text=False,
    )
    base.update(overrides)
    return Settings(**base)


class LlmProviderConfigTest(unittest.TestCase):
    def test_ollama_configured_without_api_key(self):
        """Local Ollama needs base URL only — no cloud API key."""
        with patch("app.llm_client.get_settings", return_value=_settings(llm_api_key="")):
            self.assertTrue(llm_is_configured())

    def test_vllm_configured_without_api_key(self):
        with patch(
            "app.llm_client.get_settings",
            return_value=_settings(
                llm_provider="vllm",
                llm_api_key="",
                llm_base_url="http://127.0.0.1:8001/v1",
                llm_model="Qwen/Qwen3-8B",
            ),
        ):
            self.assertTrue(llm_is_configured())

    def test_openai_requires_api_key(self):
        with patch(
            "app.llm_client.get_settings",
            return_value=_settings(
                llm_provider="openai",
                llm_api_key="",
                llm_base_url="https://api.openai.com/v1",
                llm_model="gpt-4o-mini",
            ),
        ):
            self.assertFalse(llm_is_configured())

    def test_disabled_not_configured(self):
        with patch(
            "app.llm_client.get_settings",
            return_value=_settings(llm_enabled=False, llm_api_key="ollama"),
        ):
            self.assertFalse(llm_is_configured())

    def test_ollama_requires_base_url(self):
        with patch(
            "app.llm_client.get_settings",
            return_value=_settings(llm_base_url=""),
        ):
            self.assertFalse(llm_is_configured())


class LlmProviderFactoryTest(unittest.TestCase):
    def test_factory_returns_openai_compatible(self):
        provider = get_llm_provider(_settings())
        self.assertIsInstance(provider, OpenAiCompatibleProvider)
        self.assertEqual(provider.provider_name, "ollama")
        self.assertEqual(provider.model_id, "qwen2.5:7b")

    def test_provider_is_configured_delegates(self):
        settings = _settings(llm_api_key="")
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

        with patch("app.llm_client.get_settings", return_value=_settings(llm_api_key="")):
            self.assertEqual(_auth_header_value(), "ollama")

        with patch(
            "app.llm_client.get_settings",
            return_value=_settings(llm_provider="vllm", llm_api_key=""),
        ):
            self.assertEqual(_auth_header_value(), "EMPTY")


if __name__ == "__main__":
    unittest.main()
