"""Small idempotent compatibility updates for the runtime SQLite schema."""

from sqlalchemy import Engine, inspect
from sqlalchemy.exc import SQLAlchemyError


class SchemaCompatibilityError(RuntimeError):
    """Safe startup error raised when a required compatibility update fails."""

    def __init__(self) -> None:
        super().__init__("The database schema could not be prepared safely.")


def ensure_contribution_ownership_schema(engine: Engine) -> None:
    """Add contribution ownership and review fields to existing SQLite databases."""

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
    except SQLAlchemyError as error:
        raise SchemaCompatibilityError() from error
