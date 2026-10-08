from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
_ENV_FILE = _BACKEND_ROOT / ".env"

# Host allowlists applied when LLM_ALLOWED_HOSTS=auto (the default).
_PROVIDER_ALLOWED_HOSTS: dict[str, str] = {
    "ollama": "127.0.0.1,localhost",
    "vllm": "127.0.0.1,localhost",
    "openai": "api.openai.com",
    "runpod": "api.runpod.ai",
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE) if _ENV_FILE.is_file() else None,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    postgres_host: str = "127.0.0.1"
    postgres_port: int = 5432
    postgres_db: str = "ailms"
    postgres_user: str = "postgres"
    postgres_password: str = "postgres"
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    frontend_origin: str = "http://localhost:3000"
    reminder_interval_seconds: int = 3600
    document_storage_path: str = "storage"
    max_upload_bytes: int = 25 * 1024 * 1024

    # Auth (JWT). Change JWT_SECRET in production.
    jwt_secret: str = "ailms-dev-change-me-in-production-32b"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480
    # When false, API skips Bearer checks (local tests only).
    auth_required: bool = True
    default_user_password: str = "Password1"

    # Feature flag: hide AI registration API/UI when false (404 on API).
    ai_registration_enabled: bool = True
    # Background worker that drains QUEUED jobs (OCR/LLM). Default false so
    # step-4 job creation leaves jobs in QUEUED until the pipeline is ready.
    ai_registration_worker_enabled: bool = False
    ai_registration_worker_poll_seconds: float = 2.0

    # OCR (step 5). Engine: auto | paddleocr | pymupdf_text
    # auto prefers paddleocr when installed, else pymupdf_text (PDF text layer).
    ocr_engine: str = "auto"
    ocr_dpi: int = 200
    # Page cap for OCR / AI registration (spec 11 AI_REGISTRATION_MAX_PAGES).
    ocr_max_pages: int = 50
    ocr_max_image_pixels: int = 40_000_000
    ocr_paddle_lang: str = "en"

    # OCR normalization (step 6): max chars for combined LLM input text.
    llm_input_max_chars: int = 100_000
    # Structured extraction (step 7): max chars of combined text sent to the LLM.
    extraction_max_chars: int = 24_000

    # Flip only this to switch backends: ollama | runpod | vllm | openai
    llm_enabled: bool = True
    llm_provider: str = "ollama"
    llm_timeout_seconds: int = 120
    llm_max_tokens: int = 4096
    # Optional JSON object string merged into chat/completions request body (advanced).
    llm_extra_body_json: str = ""
    # Host allowlist: "auto" derives from LLM_PROVIDER; empty disables the filter;
    # otherwise a comma-separated hostname list.
    llm_allowed_hosts: str = "auto"
    # When true, DEBUG-level logs may include document/user prompt text.
    ai_log_document_text: bool = False

    # Legacy flat keys (fallback when a provider profile field is empty).
    llm_api_key: str = ""
    llm_base_url: str = ""
    llm_model: str = ""

    # Per-provider profiles — keep all filled; only LLM_PROVIDER selects which is active.
    llm_ollama_base_url: str = "http://127.0.0.1:11434/v1"
    llm_ollama_api_key: str = "ollama"
    llm_ollama_model: str = "qwen3:8b"

    llm_vllm_base_url: str = "http://127.0.0.1:8001/v1"
    llm_vllm_api_key: str = "EMPTY"
    llm_vllm_model: str = "Qwen/Qwen3-8B"

    llm_openai_base_url: str = "https://api.openai.com/v1"
    llm_openai_api_key: str = ""
    llm_openai_model: str = "gpt-4o-mini"

    llm_runpod_model: str = "Qwen/Qwen3-8B"

    # Runpod Serverless queue-based vLLM (LLM_PROVIDER=runpod).
    runpod_api_key: str = ""
    runpod_endpoint_id: str = "br96s8zyygjs24"
    # Prefer async: /run + poll /status. Cold starts for 8B models often exceed /runsync.
    runpod_use_async: bool = True
    runpod_poll_interval_seconds: float = 2.0
    # Cover cold start (model download/load) + generation; raise if jobs still time out.
    runpod_max_wait_seconds: int = 900

    @property
    def provider_key(self) -> str:
        return self.llm_provider.strip().lower()

    @property
    def active_llm_model(self) -> str:
        specific = {
            "ollama": self.llm_ollama_model,
            "vllm": self.llm_vllm_model,
            "openai": self.llm_openai_model,
            "runpod": self.llm_runpod_model,
        }.get(self.provider_key, "")
        return (specific or self.llm_model or "").strip()

    @property
    def active_llm_base_url(self) -> str:
        specific = {
            "ollama": self.llm_ollama_base_url,
            "vllm": self.llm_vllm_base_url,
            "openai": self.llm_openai_base_url,
            "runpod": "",
        }.get(self.provider_key, "")
        return (specific or self.llm_base_url or "").strip()

    @property
    def active_llm_api_key(self) -> str:
        specific = {
            "ollama": self.llm_ollama_api_key,
            "vllm": self.llm_vllm_api_key,
            "openai": self.llm_openai_api_key,
            "runpod": self.runpod_api_key,
        }.get(self.provider_key, "")
        return (specific or self.llm_api_key or "").strip()

    @property
    def active_llm_allowed_hosts(self) -> str:
        """Resolve allowlist: auto → provider default; empty → no filter; else explicit."""
        raw = (self.llm_allowed_hosts or "").strip()
        if not raw:
            return ""
        if raw.lower() == "auto":
            return _PROVIDER_ALLOWED_HOSTS.get(
                self.provider_key, "127.0.0.1,localhost"
            )
        return raw

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+psycopg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def admin_database_url(self) -> str:
        return (
            f"postgresql+psycopg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/postgres"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
