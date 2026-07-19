"""Read-only aggregate inventory for private original-format recordings."""

from collections import Counter
from dataclasses import asdict, dataclass
import hashlib
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models import Contribution
from app.services.audio_storage import (
    AudioStorageError,
    get_audio_inventory_roots,
    resolve_audio_storage_path,
)
from app.utils.audio_validation import SUPPORTED_AUDIO_EXTENSIONS


class AudioInventoryError(RuntimeError):
    """Safe inventory failure without filesystem or database details."""

    def __init__(self) -> None:
        super().__init__("The raw-audio inventory could not be completed safely.")


@dataclass(frozen=True, slots=True)
class AudioInventoryReport:
    audio_records: int
    stored_files: int
    total_bytes: int
    formats: dict[str, int]
    missing_files: int
    orphan_files: int
    zero_byte_files: int
    checksummed_files: int

    def as_dict(self) -> dict[str, int | dict[str, int]]:
        return asdict(self)


def _inventory_files() -> list[Path]:
    files: dict[Path, None] = {}
    for root in get_audio_inventory_roots():
        if not root.exists() or not root.is_dir() or root.is_symlink():
            continue
        try:
            for candidate in root.rglob("*"):
                if ".staging" in candidate.parts:
                    continue
                extension = candidate.suffix.lower().removeprefix(".")
                if (
                    extension in SUPPORTED_AUDIO_EXTENSIONS
                    and candidate.is_file()
                    and not candidate.is_symlink()
                ):
                    files[candidate.resolve()] = None
        except OSError as error:
            raise AudioInventoryError() from error
    return sorted(files)


def _checksum(path: Path) -> None:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as error:
        raise AudioInventoryError() from error


def build_audio_inventory(
    *, database: Session, include_checksums: bool = False
) -> AudioInventoryReport:
    """Return aggregate storage health without mutating records or files."""

    try:
        storage_keys = list(
            database.scalars(select(Contribution.audio_storage_key)).all()
        )
    except SQLAlchemyError as error:
        database.rollback()
        raise AudioInventoryError() from error

    referenced: set[Path] = set()
    missing_files = 0
    for storage_key in storage_keys:
        try:
            path = resolve_audio_storage_path(storage_key)
        except AudioStorageError:
            missing_files += 1
            continue
        referenced.add(path.resolve())
        if path.is_symlink() or not path.is_file():
            missing_files += 1

    stored_files = _inventory_files()
    formats: Counter[str] = Counter()
    total_bytes = 0
    zero_byte_files = 0
    checksummed_files = 0
    for path in stored_files:
        try:
            size = path.stat().st_size
        except OSError as error:
            raise AudioInventoryError() from error
        total_bytes += size
        if size == 0:
            zero_byte_files += 1
        formats[path.suffix.lower().removeprefix(".") or "none"] += 1
        if include_checksums:
            _checksum(path)
            checksummed_files += 1

    return AudioInventoryReport(
        audio_records=len(storage_keys),
        stored_files=len(stored_files),
        total_bytes=total_bytes,
        formats=dict(sorted(formats.items())),
        missing_files=missing_files,
        orphan_files=sum(path not in referenced for path in stored_files),
        zero_byte_files=zero_byte_files,
        checksummed_files=checksummed_files,
    )
