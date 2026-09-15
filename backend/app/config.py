from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

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
