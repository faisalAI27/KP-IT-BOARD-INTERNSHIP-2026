"""SQLite review-revision, ledger-schema, and approved backfill tests."""

from pathlib import Path
from uuid import UUID

from sqlalchemy import create_engine, inspect, text

from app.services.schema_compatibility import ensure_contribution_ownership_schema


PROFILE_ID = "0d5dd8f5-93df-462b-b234-a16973089092"
MISSING_PROFILE_ID = "93cdf86e-2d29-4b4f-a665-90b25b9d5f31"
PENDING_ID = "11111111-1111-4111-8111-111111111111"
APPROVED_ID = "22222222-2222-4222-8222-222222222222"
REJECTED_ID = "33333333-3333-4333-8333-333333333333"
LEGACY_APPROVED_ID = "44444444-4444-4444-8444-444444444444"
ORPHAN_APPROVED_ID = "55555555-5555-4555-8555-555555555555"


def create_pre_points_database(database_path: Path):
    """Create the complete pre-ledger fields needed by compatibility."""

    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    rows = [
        (PENDING_ID, PROFILE_ID, "pending", None, None),
        (APPROVED_ID, PROFILE_ID, "approved", "2026-07-15 10:00:00", None),
        (
            REJECTED_ID,
            PROFILE_ID,
            "rejected",
            "2026-07-15 11:00:00",
            "Too noisy",
        ),
        (
            LEGACY_APPROVED_ID,
            None,
            "approved",
            "2026-07-15 12:00:00",
            None,
        ),
        (
            ORPHAN_APPROVED_ID,
            MISSING_PROFILE_ID,
            "approved",
            "2026-07-15 13:00:00",
            None,
        ),
    ]
    with engine.begin() as connection:
        connection.execute(
            text("CREATE TABLE profiles (id VARCHAR(36) NOT NULL PRIMARY KEY)")
        )
        connection.execute(
            text(
                "CREATE TABLE contributions ("
                "id VARCHAR(36) NOT NULL PRIMARY KEY, "
                "user_id VARCHAR(36), "
                "review_status VARCHAR(20) NOT NULL DEFAULT 'pending', "
                "reviewed_at DATETIME, "
                "rejection_reason VARCHAR(500), "
                "audio_storage_key VARCHAR(500) NOT NULL, "
                "original_filename VARCHAR(255) NOT NULL, "
                "mime_type VARCHAR(100) NOT NULL, "
                "file_size INTEGER NOT NULL"
                ")"
            )
        )
        connection.execute(
            text("INSERT INTO profiles (id) VALUES (:id)"),
            {"id": PROFILE_ID},
        )
        for contribution_id, user_id, status, reviewed_at, reason in rows:
            connection.execute(
                text(
                    "INSERT INTO contributions ("
                    "id, user_id, review_status, reviewed_at, rejection_reason, "
                    "audio_storage_key, original_filename, mime_type, file_size"
                    ") VALUES ("
                    ":id, :user_id, :review_status, :reviewed_at, :reason, "
                    ":audio_key, 'recording.webm', 'audio/webm', 128"
                    ")"
                ),
                {
                    "id": contribution_id,
                    "user_id": user_id,
                    "review_status": status,
                    "reviewed_at": reviewed_at,
                    "reason": reason,
                    "audio_key": f"audio/private/{contribution_id}.webm",
                },
            )
    return engine


def snapshot_contributions(engine) -> list[tuple[object, ...]]:
    with engine.connect() as connection:
        return list(
            connection.execute(
                text(
                    "SELECT id, user_id, review_status, reviewed_at, "
                    "rejection_reason, audio_storage_key, original_filename, "
                    "mime_type, file_size FROM contributions ORDER BY id"
                )
            ).all()
        )


def test_compatibility_adds_review_revision_with_stable_initial_values(
    tmp_path: Path,
) -> None:
    engine = create_pre_points_database(tmp_path / "pre-points.db")

    ensure_contribution_ownership_schema(engine)

    columns = {
        column["name"]: column
        for column in inspect(engine).get_columns("contributions")
    }
    with engine.connect() as connection:
        revisions = dict(
            connection.execute(
                text("SELECT id, review_revision FROM contributions")
            ).all()
        )
    assert columns["review_revision"]["nullable"] is False
    assert revisions[PENDING_ID] == 0
    assert revisions[APPROVED_ID] == 1
    assert revisions[REJECTED_ID] == 1
    assert revisions[LEGACY_APPROVED_ID] == 1
    assert revisions[ORPHAN_APPROVED_ID] == 1
    engine.dispose()


def test_compatibility_creates_complete_ledger_table_indexes_and_uniqueness(
    tmp_path: Path,
) -> None:
    engine = create_pre_points_database(tmp_path / "pre-points.db")

    ensure_contribution_ownership_schema(engine)

    inspector = inspect(engine)
    columns = {column["name"] for column in inspector.get_columns("point_ledger_entries")}
    indexes = inspector.get_indexes("point_ledger_entries")
    constraints = inspector.get_unique_constraints("point_ledger_entries")
    assert columns == {
        "id",
        "user_id",
        "contribution_id",
        "review_revision",
        "entry_type",
        "points_delta",
        "description",
        "created_at",
    }
    assert any(index["column_names"] == ["user_id"] for index in indexes)
    assert any(index["column_names"] == ["contribution_id"] for index in indexes)
    assert any(
        index["column_names"] == ["user_id", "created_at", "id"]
        for index in indexes
    )
    assert any(
        constraint["column_names"] == ["contribution_id", "review_revision"]
        for constraint in constraints
    )
    engine.dispose()


def test_compatibility_preserves_profiles_contributions_reviews_owners_and_audio(
    tmp_path: Path,
) -> None:
    engine = create_pre_points_database(tmp_path / "pre-points.db")
    before = snapshot_contributions(engine)

    ensure_contribution_ownership_schema(engine)

    after = snapshot_contributions(engine)
    with engine.connect() as connection:
        profiles = connection.execute(text("SELECT id FROM profiles")).scalars().all()
    assert after == before
    assert profiles == [PROFILE_ID]
    engine.dispose()


def test_backfill_creates_only_one_approved_owned_entry(tmp_path: Path) -> None:
    engine = create_pre_points_database(tmp_path / "pre-points.db")

    ensure_contribution_ownership_schema(engine)

    with engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT id, user_id, contribution_id, review_revision, "
                "entry_type, points_delta FROM point_ledger_entries"
            )
        ).all()
    assert len(rows) == 1
    row = rows[0]
    assert str(UUID(row.id)) == row.id
    assert row.user_id == PROFILE_ID
    assert row.contribution_id == APPROVED_ID
    assert row.review_revision == 1
    assert row.entry_type == "approved_backfill"
    assert row.points_delta == 1
    engine.dispose()


def test_backfill_excludes_pending_rejected_legacy_and_orphaned_rows(
    tmp_path: Path,
) -> None:
    engine = create_pre_points_database(tmp_path / "pre-points.db")

    ensure_contribution_ownership_schema(engine)

    with engine.connect() as connection:
        contribution_ids = set(
            connection.execute(
                text("SELECT contribution_id FROM point_ledger_entries")
            ).scalars()
        )
    assert PENDING_ID not in contribution_ids
    assert REJECTED_ID not in contribution_ids
    assert LEGACY_APPROVED_ID not in contribution_ids
    assert ORPHAN_APPROVED_ID not in contribution_ids
    engine.dispose()


def test_compatibility_and_backfill_are_idempotent(tmp_path: Path) -> None:
    engine = create_pre_points_database(tmp_path / "pre-points.db")

    ensure_contribution_ownership_schema(engine)
    ensure_contribution_ownership_schema(engine)
    ensure_contribution_ownership_schema(engine)

    inspector = inspect(engine)
    columns = [
        column["name"] for column in inspector.get_columns("contributions")
    ]
    with engine.connect() as connection:
        entry_count = connection.execute(
            text("SELECT COUNT(*) FROM point_ledger_entries")
        ).scalar_one()
    assert columns.count("review_revision") == 1
    assert entry_count == 1
    engine.dispose()


def test_compatibility_does_not_recreate_contributions_table(
    tmp_path: Path,
) -> None:
    engine = create_pre_points_database(tmp_path / "pre-points.db")
    with engine.connect() as connection:
        before_root_page = connection.execute(
            text(
                "SELECT rootpage FROM sqlite_master "
                "WHERE type='table' AND name='contributions'"
            )
        ).scalar_one()

    ensure_contribution_ownership_schema(engine)

    with engine.connect() as connection:
        after_root_page = connection.execute(
            text(
                "SELECT rootpage FROM sqlite_master "
                "WHERE type='table' AND name='contributions'"
            )
        ).scalar_one()
    assert after_root_page == before_root_page
    engine.dispose()
