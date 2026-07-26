"""Merge one legacy KP AWAZ SQLite database into the configured active database."""

from __future__ import annotations

import argparse
from pathlib import Path
import sqlite3
from uuid import uuid4


MERGE_ORDER = (
    "profiles",
    "sentences",
    "contributions",
    "text_contributions",
    "point_ledger_entries",
    "withdrawal_requests",
    "import_batches",
)


def _tables(connection: sqlite3.Connection, schema: str) -> set[str]:
    rows = connection.execute(
        f"SELECT name FROM {schema}.sqlite_master "
        "WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    )
    return {str(row[0]) for row in rows}


def _columns(
    connection: sqlite3.Connection,
    schema: str,
    table: str,
) -> list[str]:
    return [
        str(row[1])
        for row in connection.execute(
            f'PRAGMA {schema}.table_info("{table}")'
        )
    ]


def _row_count(
    connection: sqlite3.Connection,
    schema: str,
    table: str,
) -> int:
    return int(
        connection.execute(
            f'SELECT count(*) FROM {schema}."{table}"'
        ).fetchone()[0]
    )


def consolidate(active_path: Path, legacy_path: Path) -> dict[str, int]:
    """Merge by primary key, preserving active rows when IDs already exist."""

    active = active_path.resolve(strict=True)
    legacy = legacy_path.resolve(strict=True)
    if active == legacy:
        raise ValueError("The active and legacy database paths must differ.")

    connection = sqlite3.connect(active)
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("ATTACH DATABASE ? AS legacy", (str(legacy),))
    inserted: dict[str, int] = {}
    try:
        violations = list(connection.execute("PRAGMA legacy.foreign_key_check"))
        if violations:
            raise RuntimeError("The legacy database contains foreign-key violations.")

        active_tables = _tables(connection, "main")
        legacy_tables = _tables(connection, "legacy")
        connection.execute("BEGIN IMMEDIATE")
        for table in MERGE_ORDER:
            if table not in active_tables or table not in legacy_tables:
                continue
            shared_columns = [
                column
                for column in _columns(connection, "main", table)
                if column in _columns(connection, "legacy", table)
            ]
            if not shared_columns:
                continue
            quoted_columns = ", ".join(f'"{column}"' for column in shared_columns)
            before = _row_count(connection, "main", table)
            connection.execute(
                f'INSERT OR IGNORE INTO main."{table}" ({quoted_columns}) '
                f'SELECT {quoted_columns} FROM legacy."{table}"'
            )
            inserted[table] = _row_count(connection, "main", table) - before

        if "transcripts" in active_tables:
            guided_rows = connection.execute(
                "SELECT id, sentence_text, language, created_at, updated_at "
                "FROM main.contributions "
                "WHERE contribution_type = 'guided' "
                "AND sentence_text IS NOT NULL "
                "AND trim(sentence_text) != '' "
                "AND NOT EXISTS ("
                "SELECT 1 FROM main.transcripts "
                "WHERE transcripts.contribution_id = contributions.id "
                "AND transcripts.transcript_type = 'prompt_reference'"
                ")"
            ).fetchall()
            for contribution_id, text, language, created_at, updated_at in guided_rows:
                connection.execute(
                    "INSERT INTO main.transcripts ("
                    "id, contribution_id, transcript_type, text, language, "
                    "source, confidence, is_verified, created_at, updated_at"
                    ") VALUES (?, ?, 'prompt_reference', ?, ?, "
                    "'sentence_snapshot', NULL, 0, ?, ?)",
                    (
                        str(uuid4()),
                        contribution_id,
                        text,
                        language,
                        created_at,
                        updated_at or created_at,
                    ),
                )
            inserted["transcripts"] = len(guided_rows)

        remaining_violations = list(connection.execute("PRAGMA foreign_key_check"))
        if remaining_violations:
            raise RuntimeError("The consolidated database failed its integrity checks.")
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.execute("DETACH DATABASE legacy")
        connection.close()
    return inserted


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--active", type=Path, required=True)
    parser.add_argument("--legacy", type=Path, required=True)
    return parser


def main() -> None:
    arguments = build_parser().parse_args()
    inserted = consolidate(arguments.active, arguments.legacy)
    for table, count in inserted.items():
        print(f"{table}: inserted {count}")


if __name__ == "__main__":
    main()
