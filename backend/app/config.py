from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
_ENV_FILE = _BACKEND_ROOT / ".env"


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
    ocr_max_pages: int = 50
    ocr_max_image_pixels: int = 40_000_000
    ocr_paddle_lang: str = "en"

    llm_enabled: bool = True
    llm_provider: str = "ollama"
    llm_api_key: str = "ollama"
    llm_base_url: str = "http://127.0.0.1:11434/v1"
    llm_model: str = "qwen3:8b"
    llm_timeout_seconds: int = 120
    llm_max_tokens: int = 4096
    # Optional JSON object string merged into chat/completions request body (advanced).
    llm_extra_body_json: str = ""
    # When true, DEBUG-level logs may include document/user prompt text.
    ai_log_document_text: bool = False

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
