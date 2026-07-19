"""Safe SQLite compatibility tests for contribution ownership and review."""

from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import OperationalError

from app.services.schema_compatibility import (
    SchemaCompatibilityError,
    ensure_contribution_ownership_schema,
)


LEGACY_CONTRIBUTION_ID = "66001d2d-b6b2-48e6-879a-664d7543c008"
OWNED_CONTRIBUTION_ID = "77001d2d-b6b2-48e6-879a-664d7543c009"
PROFILE_ID = "0d5dd8f5-93df-462b-b234-a16973089092"


def create_legacy_database(database_path: Path):
    """Create the pre-ownership schema in an isolated temporary database."""

    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE profiles ("
                "id VARCHAR(36) NOT NULL PRIMARY KEY"
                ")"
            )
        )
        connection.execute(
            text(
                "CREATE TABLE contributions ("
                "id VARCHAR(36) NOT NULL PRIMARY KEY, "
                "legacy_marker TEXT NOT NULL"
                ")"
            )
        )
        connection.execute(
            text(
                "INSERT INTO contributions (id, legacy_marker) "
                "VALUES (:id, 'preserve-me')"
            ),
            {"id": LEGACY_CONTRIBUTION_ID},
        )
    return engine


def create_pre_review_database(database_path: Path):
    """Create the ownership schema that existed immediately before review."""

    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    with engine.begin() as connection:
        connection.execute(
            text("CREATE TABLE profiles (id VARCHAR(36) NOT NULL PRIMARY KEY)")
        )
        connection.execute(
            text(
                "CREATE TABLE contributions ("
                "id VARCHAR(36) NOT NULL PRIMARY KEY, "
                "user_id VARCHAR(36), "
                "audio_storage_key VARCHAR(500) NOT NULL, "
                "FOREIGN KEY(user_id) REFERENCES profiles(id) ON DELETE SET NULL"
                ")"
            )
        )
        connection.execute(
            text("INSERT INTO profiles (id) VALUES (:id)"),
            {"id": PROFILE_ID},
        )
        connection.execute(
            text(
                "INSERT INTO contributions (id, user_id, audio_storage_key) VALUES "
                "(:legacy_id, NULL, :legacy_audio), "
                "(:owned_id, :profile_id, :owned_audio)"
            ),
            {
                "legacy_id": LEGACY_CONTRIBUTION_ID,
                "legacy_audio": f"audio/2026/07/14/{LEGACY_CONTRIBUTION_ID}.webm",
                "owned_id": OWNED_CONTRIBUTION_ID,
                "profile_id": PROFILE_ID,
                "owned_audio": f"audio/2026/07/14/{OWNED_CONTRIBUTION_ID}.webm",
            },
        )
    return engine


def test_compatibility_update_adds_nullable_owner_and_index(
    tmp_path: Path,
) -> None:
    engine = create_legacy_database(tmp_path / "legacy.db")

    ensure_contribution_ownership_schema(engine)

    columns = {column["name"]: column for column in inspect(engine).get_columns("contributions")}
    indexes = inspect(engine).get_indexes("contributions")
    assert columns["user_id"]["nullable"] is True
    assert columns["consent_policy_version"]["nullable"] is True
    assert columns["consent_timestamp"]["nullable"] is True
    assert any(index["column_names"] == ["user_id"] for index in indexes)
    assert inspect(engine).has_table("withdrawal_requests")
    withdrawal_columns = {
        column["name"]: column
        for column in inspect(engine).get_columns("withdrawal_requests")
    }
    assert withdrawal_columns["contribution_id"]["nullable"] is True
    assert withdrawal_columns["resolved_at"]["nullable"] is True
    engine.dispose()


def test_compatibility_update_preserves_rows_and_leaves_legacy_owner_null(
    tmp_path: Path,
) -> None:
    engine = create_legacy_database(tmp_path / "legacy.db")

    ensure_contribution_ownership_schema(engine)

    with engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT id, legacy_marker, user_id, consent_policy_version, "
                "consent_timestamp "
                "FROM contributions WHERE id = :id"
            ),
            {"id": LEGACY_CONTRIBUTION_ID},
        ).one()
    assert row == (LEGACY_CONTRIBUTION_ID, "preserve-me", None, None, None)
    engine.dispose()


def test_compatibility_update_is_idempotent(tmp_path: Path) -> None:
    engine = create_legacy_database(tmp_path / "legacy.db")

    ensure_contribution_ownership_schema(engine)
    ensure_contribution_ownership_schema(engine)

    columns = [
        column["name"] for column in inspect(engine).get_columns("contributions")
    ]
    user_indexes = [
        index
        for index in inspect(engine).get_indexes("contributions")
        if index["column_names"] == ["user_id"]
    ]
    assert columns.count("user_id") == 1
    assert len(user_indexes) == 1
    engine.dispose()


def test_compatibility_update_does_not_recreate_contributions_table(
    tmp_path: Path,
) -> None:
    engine = create_legacy_database(tmp_path / "legacy.db")
    with engine.connect() as connection:
        original_root_page = connection.execute(
            text(
                "SELECT rootpage FROM sqlite_master "
                "WHERE type = 'table' AND name = 'contributions'"
            )
        ).scalar_one()

    ensure_contribution_ownership_schema(engine)

    with engine.connect() as connection:
        migrated_root_page = connection.execute(
            text(
                "SELECT rootpage FROM sqlite_master "
                "WHERE type = 'table' AND name = 'contributions'"
            )
        ).scalar_one()
    assert migrated_root_page == original_root_page
    engine.dispose()


def test_compatibility_update_is_independent_of_working_directory(
    monkeypatch,
    tmp_path: Path,
) -> None:
    backend_directory = tmp_path / "backend"
    launch_directory = tmp_path / "launch"
    backend_directory.mkdir()
    launch_directory.mkdir()
    database_path = backend_directory / "kp_awaz.db"
    engine = create_legacy_database(database_path)

    monkeypatch.chdir(launch_directory)
    ensure_contribution_ownership_schema(engine)

    assert "user_id" in {
        column["name"] for column in inspect(engine).get_columns("contributions")
    }
    assert not (launch_directory / "kp_awaz.db").exists()
    engine.dispose()


def test_compatibility_failure_is_safe() -> None:
    class BrokenEngine:
        dialect = SimpleNamespace(name="sqlite")

        def begin(self):
            raise OperationalError("BEGIN", {}, RuntimeError("private detail"))

    with pytest.raises(
        SchemaCompatibilityError,
        match="database schema could not be prepared safely",
    ) as captured:
        ensure_contribution_ownership_schema(BrokenEngine())  # type: ignore[arg-type]

    assert "private detail" not in str(captured.value)


def test_review_compatibility_adds_all_fields_and_index(tmp_path: Path) -> None:
    engine = create_pre_review_database(tmp_path / "pre-review.db")

    ensure_contribution_ownership_schema(engine)

    columns = {
        column["name"]: column
        for column in inspect(engine).get_columns("contributions")
    }
    indexes = inspect(engine).get_indexes("contributions")
    assert columns["review_status"]["nullable"] is False
    assert columns["reviewed_at"]["nullable"] is True
    assert columns["rejection_reason"]["nullable"] is True
    assert any(index["column_names"] == ["review_status"] for index in indexes)
    assert any(
        index["column_names"] == ["review_status", "user_id"]
        for index in indexes
    )
    engine.dispose()


def test_review_compatibility_preserves_rows_ownership_and_audio(
    tmp_path: Path,
) -> None:
    engine = create_pre_review_database(tmp_path / "pre-review.db")

    ensure_contribution_ownership_schema(engine)

    with engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT id, user_id, audio_storage_key, review_status, "
                "reviewed_at, rejection_reason FROM contributions ORDER BY id"
            )
        ).all()
    assert rows == [
        (
            LEGACY_CONTRIBUTION_ID,
            None,
            f"audio/2026/07/14/{LEGACY_CONTRIBUTION_ID}.webm",
            "pending",
            None,
            None,
        ),
        (
            OWNED_CONTRIBUTION_ID,
            PROFILE_ID,
            f"audio/2026/07/14/{OWNED_CONTRIBUTION_ID}.webm",
            "pending",
            None,
            None,
        ),
    ]
    engine.dispose()


def test_review_compatibility_sets_null_and_blank_statuses_to_pending(
    tmp_path: Path,
) -> None:
    engine = create_pre_review_database(tmp_path / "pre-review.db")
    with engine.begin() as connection:
        connection.exec_driver_sql(
            "ALTER TABLE contributions ADD COLUMN review_status VARCHAR(20)"
        )
        connection.execute(
            text(
                "UPDATE contributions SET review_status = CASE "
                "WHEN id = :legacy_id THEN NULL ELSE '   ' END"
            ),
            {"legacy_id": LEGACY_CONTRIBUTION_ID},
        )

    ensure_contribution_ownership_schema(engine)

    with engine.connect() as connection:
        statuses = connection.execute(
            text("SELECT review_status FROM contributions ORDER BY id")
        ).scalars().all()
    assert statuses == ["pending", "pending"]
    engine.dispose()


def test_review_compatibility_is_idempotent(tmp_path: Path) -> None:
    engine = create_pre_review_database(tmp_path / "pre-review.db")

    ensure_contribution_ownership_schema(engine)
    ensure_contribution_ownership_schema(engine)

    columns = [
        column["name"] for column in inspect(engine).get_columns("contributions")
    ]
    review_indexes = [
        index
        for index in inspect(engine).get_indexes("contributions")
        if index["column_names"] == ["review_status"]
    ]
    aggregate_indexes = [
        index
        for index in inspect(engine).get_indexes("contributions")
        if index["column_names"] == ["review_status", "user_id"]
    ]
    assert columns.count("review_status") == 1
    assert columns.count("reviewed_at") == 1
    assert columns.count("rejection_reason") == 1
    assert len(review_indexes) == 1
    assert len(aggregate_indexes) == 1
    engine.dispose()


def test_complete_review_schema_and_decision_are_not_reset(
    tmp_path: Path,
) -> None:
    engine = create_pre_review_database(tmp_path / "complete.db")
    ensure_contribution_ownership_schema(engine)
    with engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE contributions SET review_status = 'rejected', "
                "reviewed_at = '2026-07-16 12:00:00', "
                "rejection_reason = 'Too noisy' WHERE id = :id"
            ),
            {"id": LEGACY_CONTRIBUTION_ID},
        )

    ensure_contribution_ownership_schema(engine)

    with engine.connect() as connection:
        decision = connection.execute(
            text(
                "SELECT review_status, reviewed_at, rejection_reason "
                "FROM contributions WHERE id = :id"
            ),
            {"id": LEGACY_CONTRIBUTION_ID},
        ).one()
    assert decision == ("rejected", "2026-07-16 12:00:00", "Too noisy")
    engine.dispose()


def test_review_compatibility_is_independent_of_working_directory(
    monkeypatch,
    tmp_path: Path,
) -> None:
    database_directory = tmp_path / "database"
    launch_directory = tmp_path / "launch"
    database_directory.mkdir()
    launch_directory.mkdir()
    engine = create_pre_review_database(database_directory / "kp_awaz.db")

    monkeypatch.chdir(launch_directory)
    ensure_contribution_ownership_schema(engine)

    columns = {
        column["name"] for column in inspect(engine).get_columns("contributions")
    }
    assert {"review_status", "reviewed_at", "rejection_reason"} <= columns
    assert not (launch_directory / "kp_awaz.db").exists()
    engine.dispose()
