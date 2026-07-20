"""Create a verified backup of configured SQLite and private audio storage."""

import argparse
import json
from pathlib import Path

from app.config import settings
from app.services.audio_storage import (
    get_audio_storage_root,
    get_raw_audio_storage_root,
)
from app.services.backup_service import BackupError, create_storage_backup
from app.services.runtime_configuration import sqlite_database_path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Back up KP AWAZ SQLite and audio after pausing writes/uploads."
    )
    parser.add_argument("--output", type=Path, required=True)
    return parser


def main() -> int:
    arguments = build_parser().parse_args()
    try:
        manifest = create_storage_backup(
            database_path=sqlite_database_path(settings.database_url),
            audio_roots={
                "raw": get_raw_audio_storage_root(),
                "legacy": get_audio_storage_root(),
            },
            output=arguments.output,
        )
    except BackupError as error:
        print(json.dumps({"status": "failed", "message": str(error)}))
        return 2
    print(json.dumps({"status": "created", "manifest": manifest}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
