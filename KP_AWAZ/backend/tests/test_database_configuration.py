"""Tests for stable, working-directory-independent database configuration."""

from pathlib import Path

from sqlalchemy import create_engine, make_url, text

from app.config import (
    BACKEND_ROOT,
    DEFAULT_DATABASE_URL,
    Settings,
    build_default_database_url,
)


def database_path(database_url: str) -> Path:
    """Return the absolute filesystem path from a SQLite database URL."""

    configured_path = make_url(database_url).database
    assert configured_path is not None
    return Path(configured_path).resolve()


def test_default_database_resolves_inside_backend(monkeypatch) -> None:
    """The default points to the canonical backend runtime database."""

    monkeypatch.delenv("DATABASE_URL", raising=False)

    configured = Settings(_env_file=None)

    assert configured.database_url == DEFAULT_DATABASE_URL
    assert database_path(configured.database_url) == BACKEND_ROOT / "kp_awaz.db"


def test_process_working_directory_does_not_change_default(
    monkeypatch,
    tmp_path: Path,
) -> None:
    """Changing launch directories cannot redirect the default SQLite file."""

    monkeypatch.delenv("DATABASE_URL", raising=False)
    original = Settings(_env_file=None).database_url

    monkeypatch.chdir(tmp_path)
    from_another_directory = Settings(_env_file=None).database_url

    assert from_another_directory == original
    assert database_path(from_another_directory) == BACKEND_ROOT / "kp_awaz.db"


def test_explicit_database_url_overrides_default(
    monkeypatch,
    tmp_path: Path,
) -> None:
    """Deployments and tests may still select another database explicitly."""

    override_path = tmp_path / "override.db"
    override_url = f"sqlite:///{override_path.as_posix()}"
    monkeypatch.setenv("DATABASE_URL", override_url)

    configured = Settings(_env_file=None)

    assert configured.database_url == override_url
    assert database_path(configured.database_url) == override_path


def test_stable_startup_preserves_records_and_avoids_launch_directory_database(
    monkeypatch,
    tmp_path: Path,
) -> None:
    """Repeated startup uses one isolated DB without losing existing records."""

    project_root = tmp_path / "KP_AWAZ"
    backend_root = project_root / "backend"
    launch_directory = project_root / "launch-from-here"
    backend_root.mkdir(parents=True)
    launch_directory.mkdir()
    database_url = build_default_database_url(backend_root)

    first_engine = create_engine(database_url)
    with first_engine.begin() as connection:
        connection.execute(
            text("CREATE TABLE existing_records (id INTEGER PRIMARY KEY, value TEXT)")
        )
        connection.execute(
            text("INSERT INTO existing_records (id, value) VALUES (1, 'preserved')")
        )
    first_engine.dispose()

    monkeypatch.chdir(launch_directory)
    second_engine = create_engine(build_default_database_url(backend_root))
    with second_engine.connect() as connection:
        records = connection.execute(
            text("SELECT id, value FROM existing_records")
        ).all()
    second_engine.dispose()

    assert records == [(1, "preserved")]
    assert (backend_root / "kp_awaz.db").is_file()
    assert not (project_root / "kp_awaz.db").exists()
    assert not (launch_directory / "kp_awaz.db").exists()
