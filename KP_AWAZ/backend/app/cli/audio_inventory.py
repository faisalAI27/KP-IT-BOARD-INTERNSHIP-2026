"""Print a privacy-safe, read-only original-audio storage inventory."""

import argparse
import json

from app.database import SessionLocal
from app.services.audio_inventory_service import (
    AudioInventoryError,
    build_audio_inventory,
)


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Audit KP AWAZ raw and legacy audio storage without modifying it."
    )
    parser.add_argument(
        "--include-checksums",
        action="store_true",
        help="Stream every stored file through SHA-256 without printing individual hashes.",
    )
    return parser.parse_args()


def main() -> int:
    arguments = _arguments()
    try:
        with SessionLocal() as database:
            report = build_audio_inventory(
                database=database,
                include_checksums=arguments.include_checksums,
            )
    except AudioInventoryError as error:
        print(json.dumps({"error": str(error)}))
        return 1
    print(json.dumps(report.as_dict(), ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
