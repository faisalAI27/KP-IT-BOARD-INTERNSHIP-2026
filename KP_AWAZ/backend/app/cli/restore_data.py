"""Verify and restore a backup only to explicit, unused destinations."""

import argparse
import json
from pathlib import Path

from app.services.backup_service import BackupError, restore_storage_backup


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Restore a verified KP AWAZ backup while the service is stopped."
    )
    parser.add_argument("--backup", type=Path, required=True)
    parser.add_argument("--database-destination", type=Path, required=True)
    parser.add_argument("--raw-audio-destination", type=Path, required=True)
    parser.add_argument("--legacy-audio-destination", type=Path, required=True)
    parser.add_argument("--confirm-restore", action="store_true")
    return parser


def main() -> int:
    arguments = build_parser().parse_args()
    try:
        report = restore_storage_backup(
            backup=arguments.backup,
            database_destination=arguments.database_destination,
            raw_audio_destination=arguments.raw_audio_destination,
            legacy_audio_destination=arguments.legacy_audio_destination,
            confirmed=arguments.confirm_restore,
        )
    except BackupError as error:
        print(json.dumps({"status": "failed", "message": str(error)}))
        return 2
    print(json.dumps({"status": "restored", "verification": report}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
