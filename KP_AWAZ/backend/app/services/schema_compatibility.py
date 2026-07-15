"""Small idempotent compatibility updates for the runtime SQLite schema."""

from sqlalchemy import Engine, inspect
from sqlalchemy.exc import SQLAlchemyError


class SchemaCompatibilityError(RuntimeError):
    """Safe startup error raised when a required compatibility update fails."""

    def __init__(self) -> None:
        super().__init__("The database schema could not be prepared safely.")


def ensure_contribution_ownership_schema(engine: Engine) -> None:
    """Add nullable contribution ownership to existing SQLite databases."""

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

            indexes = inspect(connection).get_indexes("contributions")
            has_user_id_index = any(
                index.get("column_names") == ["user_id"] for index in indexes
            )
            if not has_user_id_index:
                connection.exec_driver_sql(
                    "CREATE INDEX IF NOT EXISTS ix_contributions_user_id "
                    "ON contributions (user_id)"
                )
    except SQLAlchemyError as error:
        raise SchemaCompatibilityError() from error
