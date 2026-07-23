"""Targeted production configuration and persistent-storage tests."""

from pathlib import Path

import pytest

from app.config import Settings
from app.services.runtime_configuration import (
    ProductionConfigurationError,
    prepare_runtime_storage,
    validate_production_configuration,
)


def production_settings(tmp_path: Path, **overrides: object) -> Settings:
    values: dict[str, object] = {
        "environment": "production",
        "database_url": f"sqlite:///{tmp_path / 'database' / 'kp_awaz.db'}",
        "raw_audio_storage_root": tmp_path / "audio" / "raw",
        "frontend_base_url": "https://kpawaz.example.com",
        "frontend_origins": ["https://kpawaz.example.com"],
        "admin_api_key": "a" * 64,
        "supabase_url": "https://project.example.supabase.co",
        "supabase_publishable_key": "public-browser-key",
        "supabase_secret_key": "server-only-key",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


@pytest.mark.parametrize(
    ("field", "environment_name"),
    [
        ("supabase_url", "SUPABASE_URL"),
        ("supabase_publishable_key", "SUPABASE_PUBLISHABLE_KEY"),
        ("supabase_secret_key", "SUPABASE_SECRET_KEY"),
        ("admin_api_key", "ADMIN_API_KEY"),
        ("frontend_base_url", "FRONTEND_BASE_URL"),
    ],
)
def test_production_rejects_missing_required_values(
    tmp_path: Path, field: str, environment_name: str
) -> None:
    configuration = production_settings(tmp_path, **{field: ""})

    with pytest.raises(ProductionConfigurationError) as captured:
        validate_production_configuration(configuration)

    assert environment_name in str(captured.value)
    assert "server-only-key" not in str(captured.value)


def test_production_rejects_source_tree_storage(tmp_path: Path) -> None:
    configuration = production_settings(
        tmp_path,
        database_url="sqlite:///relative.db",
    )

    with pytest.raises(ProductionConfigurationError, match="DATABASE_URL"):
        validate_production_configuration(configuration)


def test_production_rejects_localhost_and_mismatched_origins(tmp_path: Path) -> None:
    localhost = production_settings(
        tmp_path,
        frontend_base_url="http://localhost:4173",
        frontend_origins=["http://localhost:4173"],
    )
    mismatch = production_settings(
        tmp_path,
        frontend_origins=["https://other.example.com"],
    )

    with pytest.raises(ProductionConfigurationError, match="FRONTEND_ORIGINS"):
        validate_production_configuration(localhost)
    with pytest.raises(ProductionConfigurationError, match="FRONTEND_BASE_URL"):
        validate_production_configuration(mismatch)


def test_production_rejects_local_supabase_url(tmp_path: Path) -> None:
    configuration = production_settings(
        tmp_path,
        supabase_url="https://localhost:54321",
    )

    with pytest.raises(ProductionConfigurationError, match="SUPABASE_URL"):
        validate_production_configuration(configuration)


def test_production_prepares_persistent_directories(tmp_path: Path) -> None:
    configuration = production_settings(tmp_path)

    prepare_runtime_storage(configuration)

    assert (tmp_path / "database").is_dir()
    assert (tmp_path / "audio" / "raw").is_dir()


def test_development_retains_local_defaults() -> None:
    configuration = Settings(_env_file=None, environment="development")

    validate_production_configuration(configuration)

    assert configuration.environment == "development"
    assert all(origin != "*" for origin in configuration.frontend_origins)
