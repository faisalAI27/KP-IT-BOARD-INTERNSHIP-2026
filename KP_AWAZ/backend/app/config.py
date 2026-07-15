"""Environment-based application settings."""

from pathlib import Path
from typing import Self

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_ROOT = Path(__file__).resolve().parent.parent


def build_default_database_url(backend_root: Path = BACKEND_ROOT) -> str:
    """Return a SQLite URL anchored to the backend instead of the process CWD."""

    database_path = (backend_root / "kp_awaz.db").resolve()
    return f"sqlite:///{database_path.as_posix()}"


DEFAULT_DATABASE_URL = build_default_database_url()


class Settings(BaseSettings):
    """Configuration shared across the backend application."""

    app_name: str = "KP AWAZ API"
    api_prefix: str = "/api"
    database_url: str = DEFAULT_DATABASE_URL
    frontend_origins: list[str] = [
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ]
    storage_root: Path = Path("storage")
    max_audio_size_mb: int = 15
    max_guided_audio_size_mb: int = Field(default=15, gt=0)
    max_open_audio_size_mb: int = Field(default=50, gt=0)
    audio_storage_subdirectory: str = "audio"
    max_import_file_size_mb: int = Field(default=5, gt=0)
    min_imported_sentence_length: int = Field(default=3, gt=0)
    max_imported_sentence_length: int = Field(default=500, gt=0)
    admin_api_key: str = "dev-change-this-key"
    supabase_url: str = ""
    supabase_publishable_key: str = ""
    supabase_auth_timeout_seconds: float = Field(default=5, gt=0)

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

    @field_validator("supabase_url")
    @classmethod
    def normalize_supabase_url(cls, value: str) -> str:
        """Keep an optional Auth base URL free of whitespace and trailing slashes."""

        return value.strip().rstrip("/")

    @field_validator("supabase_publishable_key")
    @classmethod
    def normalize_supabase_publishable_key(cls, value: str) -> str:
        """Normalize optional development configuration without requiring it."""

        return value.strip()

    @field_validator("audio_storage_subdirectory")
    @classmethod
    def validate_audio_storage_subdirectory(cls, value: str) -> str:
        """Require one safe relative directory name beneath storage root."""

        cleaned_value = value.strip()
        directory = Path(cleaned_value)
        if (
            not cleaned_value
            or directory.is_absolute()
            or len(directory.parts) != 1
            or cleaned_value in {".", ".."}
            or "\\" in cleaned_value
        ):
            raise ValueError("AUDIO_STORAGE_SUBDIRECTORY must be a directory name")
        return cleaned_value

    @model_validator(mode="after")
    def validate_imported_sentence_length_range(self) -> Self:
        """Ensure the configured import length range is usable."""

        if self.min_imported_sentence_length > self.max_imported_sentence_length:
            raise ValueError(
                "MIN_IMPORTED_SENTENCE_LENGTH must not be greater than "
                "MAX_IMPORTED_SENTENCE_LENGTH"
            )
        return self


settings = Settings()
