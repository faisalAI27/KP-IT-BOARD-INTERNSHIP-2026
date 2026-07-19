"""Small idempotent compatibility updates for the runtime SQLite schema."""

from sqlalchemy import Engine, inspect
from sqlalchemy.exc import SQLAlchemyError

from app.models import PointLedgerEntry
from app.services.points_ledger_service import (
    backfill_approved_contribution_points_connection,
)


class SchemaCompatibilityError(RuntimeError):
    """Safe startup error raised when a required compatibility update fails."""

    def __init__(self) -> None:
        super().__init__("The database schema could not be prepared safely.")


def ensure_contribution_ownership_schema(engine: Engine) -> None:
    """Add required contribution fields without rewriting existing SQLite rows."""

    if engine.dialect.name != "sqlite":
        return

    try:
        with engine.begin() as connection:
            schema = inspect(connection)
            if not schema.has_table("contributions"):
                return

            column_names = {
                column["name"] for column in schema.get_columns("contributions")
            }
            if "user_id" not in column_names:
                connection.exec_driver_sql(
                    "ALTER TABLE contributions "
                    "ADD COLUMN user_id VARCHAR(36) "
                    "REFERENCES profiles(id) ON DELETE SET NULL"
                )
            if "review_status" not in column_names:
                connection.exec_driver_sql(
                    "ALTER TABLE contributions "
                    "ADD COLUMN review_status VARCHAR(20) "
                    "NOT NULL DEFAULT 'pending'"
                )
            if "reviewed_at" not in column_names:
                connection.exec_driver_sql(
                    "ALTER TABLE contributions ADD COLUMN reviewed_at DATETIME"
                )
            if "rejection_reason" not in column_names:
                connection.exec_driver_sql(
                    "ALTER TABLE contributions "
                    "ADD COLUMN rejection_reason VARCHAR(500)"
                )
            if "review_revision" not in column_names:
                connection.exec_driver_sql(
                    "ALTER TABLE contributions "
                    "ADD COLUMN review_revision INTEGER NOT NULL DEFAULT 0"
                )
            if "consent_policy_version" not in column_names:
                connection.exec_driver_sql(
                    "ALTER TABLE contributions "
                    "ADD COLUMN consent_policy_version VARCHAR(20)"
                )
            if "consent_timestamp" not in column_names:
                connection.exec_driver_sql(
                    "ALTER TABLE contributions "
                    "ADD COLUMN consent_timestamp DATETIME"
                )

            connection.exec_driver_sql(
                "UPDATE contributions SET review_status = 'pending' "
                "WHERE review_status IS NULL OR trim(review_status) = ''"
            )
            connection.exec_driver_sql(
                "UPDATE contributions SET review_status = lower(trim(review_status)) "
                "WHERE lower(trim(review_status)) "
                "IN ('pending', 'approved', 'rejected') "
                "AND review_status != lower(trim(review_status))"
            )
            connection.exec_driver_sql(
                "UPDATE contributions SET review_revision = CASE "
                "WHEN review_status IN ('approved', 'rejected') THEN 1 ELSE 0 END "
                "WHERE review_revision IS NULL"
            )
            connection.exec_driver_sql(
                "UPDATE contributions SET review_revision = 1 "
                "WHERE review_status IN ('approved', 'rejected') "
                "AND review_revision = 0"
            )

            indexes = inspect(connection).get_indexes("contributions")
            has_user_id_index = any(
                index.get("column_names") == ["user_id"] for index in indexes
            )
            if not has_user_id_index:
                connection.exec_driver_sql(
                    "CREATE INDEX IF NOT EXISTS ix_contributions_user_id "
                    "ON contributions (user_id)"
                )
            indexes = inspect(connection).get_indexes("contributions")
            has_review_status_index = any(
                index.get("column_names") == ["review_status"] for index in indexes
            )
            if not has_review_status_index:
                connection.exec_driver_sql(
                    "CREATE INDEX IF NOT EXISTS ix_contributions_review_status "
                    "ON contributions (review_status)"
                )
            indexes = inspect(connection).get_indexes("contributions")
            has_review_owner_index = any(
                index.get("column_names") == ["review_status", "user_id"]
                for index in indexes
            )
            if not has_review_owner_index:
                connection.exec_driver_sql(
                    "CREATE INDEX IF NOT EXISTS "
                    "ix_contributions_review_status_user_id "
                    "ON contributions (review_status, user_id)"
                )

            PointLedgerEntry.__table__.create(
                bind=connection,
                checkfirst=True,
            )
            ledger_indexes = inspect(connection).get_indexes(
                "point_ledger_entries"
            )
            if not any(
                index.get("column_names") == ["user_id"]
                for index in ledger_indexes
            ):
                connection.exec_driver_sql(
                    "CREATE INDEX IF NOT EXISTS ix_point_ledger_entries_user_id "
                    "ON point_ledger_entries (user_id)"
                )
            if not any(
                index.get("column_names") == ["contribution_id"]
                for index in ledger_indexes
            ):
                connection.exec_driver_sql(
                    "CREATE INDEX IF NOT EXISTS "
                    "ix_point_ledger_entries_contribution_id "
                    "ON point_ledger_entries (contribution_id)"
                )
            if not any(
                index.get("column_names") == ["user_id", "created_at", "id"]
                for index in ledger_indexes
            ):
                connection.exec_driver_sql(
                    "CREATE INDEX IF NOT EXISTS ix_point_ledger_user_created_id "
                    "ON point_ledger_entries (user_id, created_at, id)"
                )

            ledger_schema = inspect(connection)
            unique_constraints = ledger_schema.get_unique_constraints(
                "point_ledger_entries"
            )
            ledger_indexes = ledger_schema.get_indexes("point_ledger_entries")
            has_revision_uniqueness = any(
                constraint.get("column_names")
                == ["contribution_id", "review_revision"]
                for constraint in unique_constraints
            ) or any(
                index.get("unique")
                and index.get("column_names")
                == ["contribution_id", "review_revision"]
                for index in ledger_indexes
            )
            if not has_revision_uniqueness:
                connection.exec_driver_sql(
                    "CREATE UNIQUE INDEX IF NOT EXISTS "
                    "uq_point_ledger_contribution_revision "
                    "ON point_ledger_entries "
                    "(contribution_id, review_revision)"
                )

            backfill_approved_contribution_points_connection(connection)
    except SQLAlchemyError as error:
        raise SchemaCompatibilityError() from error
