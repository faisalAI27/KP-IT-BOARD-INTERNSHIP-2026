"""Command-line entry point for privacy-safe approved dataset preparation."""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.config import settings
from app.services.dataset_exporter import (
    DEFAULT_EXPORT_SEED,
    DatasetExporterError,
    export_approved_dataset,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Prepare a private, approved KP AWAZ dataset without modifying "
            "source records or audio."
        )
    )
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--audio-mode",
        choices=("original",),
        default="original",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--include-checksums", action="store_true")
    parser.add_argument("--seed", type=int, default=DEFAULT_EXPORT_SEED)
    return parser


def _sqlite_database_path(database_url: str) -> Path | None:
    url = make_url(database_url)
    if not url.drivername.startswith("sqlite") or not url.database:
        return None
    if url.database == ":memory:":
        return None
    return Path(url.database).expanduser().resolve()


def _create_read_only_engine():
    connect_args = (
        {"check_same_thread": False}
        if settings.database_url.startswith("sqlite")
        else {}
    )
    engine = create_engine(settings.database_url, connect_args=connect_args)
    if engine.dialect.name == "sqlite":
        @event.listens_for(engine, "connect")
        def set_sqlite_query_only(dbapi_connection, _connection_record) -> None:
            cursor = dbapi_connection.cursor()
            try:
                cursor.execute("PRAGMA query_only = ON")
            finally:
                cursor.close()
    return engine


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    database_path = _sqlite_database_path(settings.database_url)
    engine = _create_read_only_engine()
    try:
        with Session(engine, autoflush=False, expire_on_commit=False) as database:
            report = export_approved_dataset(
                database=database,
                output=args.output,
                audio_mode=args.audio_mode,
                dry_run=args.dry_run,
                overwrite=args.overwrite,
                include_checksums=args.include_checksums,
                seed=args.seed,
                database_path=database_path,
            )
    except DatasetExporterError as error:
        print(f"Export failed: {error}", file=sys.stderr)
        return 2
    finally:
        engine.dispose()

    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    if args.dry_run:
        print("Dry run complete. No dataset directory was created.")
    else:
        print(f"Dataset created at: {args.output.expanduser().resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
