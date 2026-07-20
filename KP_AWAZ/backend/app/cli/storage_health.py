"""Print privacy-safe, read-only aggregate persistence health."""

import argparse
import json

from app.config import settings
from app.database import SessionLocal
from app.services.runtime_configuration import sqlite_database_path
from app.services.storage_health_service import StorageHealthError, build_storage_health


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Inspect KP AWAZ storage without repair.")
    parser.add_argument("--include-checksums", action="store_true")
    return parser


def main() -> int:
    arguments = build_parser().parse_args()
    try:
        with SessionLocal() as database:
            report = build_storage_health(
                database=database,
                database_path=sqlite_database_path(settings.database_url),
                include_checksums=arguments.include_checksums,
            )
    except StorageHealthError as error:
        print(json.dumps({"status": "failed", "message": str(error)}))
        return 2
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
