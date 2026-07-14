"""Environment-based application settings."""

from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    """Configuration shared across the backend application."""

    app_name: str = "KP AWAZ API"
    api_prefix: str = "/api"
    database_url: str = "sqlite:///./kp_awaz.db"
    frontend_origins: list[str] = [
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ]
    storage_root: Path = Path("storage")
    max_audio_size_mb: int = 15
    admin_api_key: str = "dev-change-this-key"

    model_config = SettingsConfigDict(
        env_file=BACKEND_ROOT / ".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
        enable_decoding=False,
    )

    @field_validator("frontend_origins", mode="before")
    @classmethod
    def parse_frontend_origins(cls, value: str | list[str]) -> list[str]:
        """Convert a comma-separated environment value into a clean list."""

        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value


settings = Settings()

