"""Production configuration validation and persistent-path preparation."""

from pathlib import Path
from urllib.parse import urlsplit

from sqlalchemy.engine import make_url

from app.config import BACKEND_ROOT, Settings


class ProductionConfigurationError(RuntimeError):
    """A safe startup error naming configuration, never its value."""


def _configuration_error(name: str, problem: str = "is missing") -> None:
    raise ProductionConfigurationError(
        f"Required production configuration {problem}: {name}"
    )


def sqlite_database_path(database_url: str) -> Path:
    """Resolve a file-backed SQLite URL without connecting to the database."""

    try:
        parsed_url = make_url(database_url)
    except Exception as error:
        raise ProductionConfigurationError(
            "Required production configuration is invalid: DATABASE_URL"
        ) from error
    if (
        not parsed_url.drivername.startswith("sqlite")
        or not parsed_url.database
        or parsed_url.database == ":memory:"
    ):
        raise ProductionConfigurationError(
            "Required production configuration is invalid: DATABASE_URL"
        )
    return Path(parsed_url.database).expanduser().resolve()


def configured_raw_audio_root(configuration: Settings) -> Path:
    """Resolve the configured raw-audio root using development-compatible rules."""

    configured = configuration.raw_audio_storage_root.expanduser()
    if not configured.is_absolute():
        configured = BACKEND_ROOT / configured
    return configured.resolve()


def _is_local_hostname(hostname: str | None) -> bool:
    return hostname in {"localhost", "127.0.0.1", "::1"}


def _require_https_origin(value: str, name: str) -> str:
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or parsed.path
        or parsed.query
        or parsed.fragment
        or parsed.username
        or parsed.password
        or _is_local_hostname(parsed.hostname)
    ):
        _configuration_error(name, "is invalid")
    return f"{parsed.scheme}://{parsed.netloc}".rstrip("/")


def validate_production_configuration(configuration: Settings) -> None:
    """Fail closed when production would use an insecure or ephemeral default."""

    if configuration.environment != "production":
        return

    for name, value in (
        ("SUPABASE_URL", configuration.supabase_url),
        ("SUPABASE_PUBLISHABLE_KEY", configuration.supabase_publishable_key),
        ("SUPABASE_SECRET_KEY", configuration.supabase_secret_key),
        ("ADMIN_API_KEY", configuration.admin_api_key),
        ("FRONTEND_BASE_URL", configuration.frontend_base_url),
    ):
        if not value:
            _configuration_error(name)

    supabase_url = urlsplit(configuration.supabase_url)
    if (
        supabase_url.scheme != "https"
        or not supabase_url.netloc
        or _is_local_hostname(supabase_url.hostname)
        or supabase_url.path not in {"", "/"}
        or supabase_url.query
        or supabase_url.fragment
        or supabase_url.username
        or supabase_url.password
    ):
        _configuration_error("SUPABASE_URL", "is invalid")
    if len(configuration.admin_api_key) < 64:
        _configuration_error("ADMIN_API_KEY", "is too short")

    database_path = sqlite_database_path(configuration.database_url)
    raw_audio_root = configured_raw_audio_root(configuration)
    if not Path(make_url(configuration.database_url).database or "").is_absolute():
        _configuration_error("DATABASE_URL", "must use an absolute persistent path")
    if not configuration.raw_audio_storage_root.is_absolute():
        _configuration_error(
            "RAW_AUDIO_STORAGE_ROOT", "must use an absolute persistent path"
        )
    if database_path.is_relative_to(BACKEND_ROOT):
        _configuration_error("DATABASE_URL", "must use persistent mounted storage")
    if raw_audio_root.is_relative_to(BACKEND_ROOT):
        _configuration_error(
            "RAW_AUDIO_STORAGE_ROOT", "must use persistent mounted storage"
        )

    if not configuration.frontend_origins:
        _configuration_error("FRONTEND_ORIGINS")
    normalized_origins = {
        _require_https_origin(origin, "FRONTEND_ORIGINS")
        for origin in configuration.frontend_origins
    }
    frontend_base_origin = _require_https_origin(
        configuration.frontend_base_url, "FRONTEND_BASE_URL"
    )
    if frontend_base_origin not in normalized_origins:
        _configuration_error("FRONTEND_BASE_URL", "is not in FRONTEND_ORIGINS")


def prepare_runtime_storage(configuration: Settings) -> None:
    """Validate startup and create only the configured persistent directories."""

    validate_production_configuration(configuration)
    database_parent = sqlite_database_path(configuration.database_url).parent
    raw_audio_root = configured_raw_audio_root(configuration)
    try:
        for directory in (database_parent, raw_audio_root):
            directory.mkdir(parents=True, exist_ok=True)
            if not directory.is_dir():
                raise OSError
    except OSError as error:
        raise ProductionConfigurationError(
            "Configured persistent storage could not be prepared."
        ) from error
