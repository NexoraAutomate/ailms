"""Model-provider abstraction for local OpenAI-compatible runtimes (Ollama / optional vLLM)."""

from __future__ import annotations

from typing import Any, Protocol

from app.config import Settings, get_settings
from app.llm_client import (
    LlmNotConfiguredError,
    chat_completion,
    chat_json,
    llm_is_configured,
    probe_llm_health,
)


class LlmProvider(Protocol):
    """Provider contract used by extraction and health probes."""

    @property
    def provider_name(self) -> str: ...

    @property
    def model_id(self) -> str: ...

    def is_configured(self) -> bool: ...

    async def complete_text(
        self,
        *,
        system: str,
        user: str,
        temperature: float = 0.2,
        max_tokens: int | None = None,
    ) -> str: ...

    async def complete_json(
        self,
        *,
        system: str,
        user: str,
        temperature: float = 0.15,
    ) -> dict[str, Any]: ...

    async def health(self) -> dict[str, Any]: ...


class OpenAiCompatibleProvider:
    """Single HTTP client path for Ollama, OpenAI, Azure, LM Studio, and optional vLLM."""

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()

    @property
    def provider_name(self) -> str:
        return self._settings.llm_provider.strip().lower()

    @property
    def model_id(self) -> str:
        return self._settings.llm_model

    def is_configured(self) -> bool:
        return llm_is_configured()

    async def complete_text(
        self,
        *,
        system: str,
        user: str,
        temperature: float = 0.2,
        max_tokens: int | None = None,
    ) -> str:
        if not self.is_configured():
            raise LlmNotConfiguredError("LLM is not configured")
        return await chat_completion(
            system=system,
            user=user,
            temperature=temperature,
            max_tokens=max_tokens,
        )

    async def complete_json(
        self,
        *,
        system: str,
        user: str,
        temperature: float = 0.15,
    ) -> dict[str, Any]:
        if not self.is_configured():
            raise LlmNotConfiguredError("LLM is not configured")
        result = await chat_json(system=system, user=user, temperature=temperature)
        if not isinstance(result, dict):
            raise TypeError("LLM JSON response must be an object")
        return result

    async def health(self) -> dict[str, Any]:
        return await probe_llm_health()


def get_llm_provider(settings: Settings | None = None) -> OpenAiCompatibleProvider:
    """Factory — today all configured providers share the OpenAI-compatible HTTP path."""
    return OpenAiCompatibleProvider(settings=settings)
