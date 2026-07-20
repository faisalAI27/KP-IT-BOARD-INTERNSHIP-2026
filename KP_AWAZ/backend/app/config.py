"""Environment-based application settings."""

from pathlib import Path
from typing import Self
from urllib.parse import urlsplit

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
    environment: str = "development"
    database_url: str = DEFAULT_DATABASE_URL
    frontend_base_url: str = "http://127.0.0.1:4173"
    frontend_origins: list[str] = [
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ]
    storage_root: Path = Path("storage")
    raw_audio_storage_root: Path = BACKEND_ROOT / "data" / "audio" / "raw"
    max_audio_upload_bytes: int = Field(default=52_428_800, gt=0)
    # Legacy settings remain readable for deployments upgrading in place. New
    # contribution uploads use MAX_AUDIO_UPLOAD_BYTES for every recording mode.
    max_audio_size_mb: int = 15
    max_guided_audio_size_mb: int = Field(default=15, gt=0)
    max_open_audio_size_mb: int = Field(default=50, gt=0)
    audio_storage_subdirectory: str = "audio"
    max_import_file_size_mb: int = Field(default=5, gt=0)
    min_imported_sentence_length: int = Field(default=3, gt=0)
    max_imported_sentence_length: int = Field(default=500, gt=0)
    admin_api_key: str = ""
    supabase_url: str = ""
    supabase_publishable_key: str = ""
    supabase_secret_key: str = ""
    supabase_auth_timeout_seconds: float = Field(default=5, gt=0)
    supabase_admin_timeout_seconds: float = Field(default=3, gt=0, le=10)
    supabase_admin_users_per_page: int = Field(default=1000, gt=0, le=1000)
    supabase_admin_max_pages: int = Field(default=10, gt=0, le=100)
    account_status_rate_limit: int = Field(default=5, gt=0, le=100)
    account_status_rate_window_seconds: int = Field(default=60, gt=0, le=3600)

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

        candidates = value.split(",") if isinstance(value, str) else value
        normalized_origins: list[str] = []
        for candidate in candidates:
            origin = candidate.strip().rstrip("/")
            parsed = urlsplit(origin)
            if (
                not origin
                or origin == "*"
                or parsed.scheme not in {"http", "https"}
                or not parsed.netloc
                or parsed.path
                or parsed.query
                or parsed.fragment
                or parsed.username
                or parsed.password
            ):
                raise ValueError("FRONTEND_ORIGINS must contain explicit HTTP origins")
            origin = f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"
            if origin not in normalized_origins:
                normalized_origins.append(origin)
        return normalized_origins

    @field_validator("environment")
    @classmethod
    def normalize_environment(cls, value: str) -> str:
        """Limit behavior switches to the supported runtime environments."""

        environment = value.strip().lower()
        if environment not in {"development", "test", "production"}:
            raise ValueError("ENVIRONMENT must be development, test, or production")
        return environment

    @field_validator("frontend_base_url")
    @classmethod
    def normalize_frontend_base_url(cls, value: str) -> str:
        """Normalize the externally visible frontend URL without accepting secrets."""

        return value.strip().rstrip("/")

    @field_validator("supabase_url")
    @classmethod
    def normalize_supabase_url(cls, value: str) -> str:
        """Keep an optional Auth base URL free of whitespace and trailing slashes."""

        return value.strip().rstrip("/")

    @field_validator("supabase_publishable_key", "supabase_secret_key")
    @classmethod
    def normalize_supabase_key(cls, value: str) -> str:
        """Normalize optional development configuration without requiring it."""

        return value.strip()

    @field_validator("admin_api_key")
    @classmethod
    def normalize_admin_api_key(cls, value: str) -> str:
        """Allow startup without admin access while rejecting whitespace keys."""

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
