"""Read-only aggregate database, phrase, and audio storage health."""

from dataclasses import asdict, dataclass
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models import Sentence
from app.services.audio_inventory_service import (
    AudioInventoryError,
    build_audio_inventory,
)
from app.services.backup_service import BackupError, sqlite_integrity


class StorageHealthError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("Storage health could not be inspected safely.")


@dataclass(frozen=True, slots=True)
class PhraseCounts:
    total: int
    active: int
    inactive: int


def build_storage_health(
    *, database: Session, database_path: Path, include_checksums: bool = False
) -> dict[str, object]:
    """Return aggregate health without exposing paths, phrases, or identities."""

    try:
        integrity = sqlite_integrity(database_path)
        total = int(database.scalar(select(func.count()).select_from(Sentence)) or 0)
        active = int(
            database.scalar(
                select(func.count())
                .select_from(Sentence)
                .where(Sentence.is_active.is_(True))
            )
            or 0
        )
        audio = build_audio_inventory(
            database=database, include_checksums=include_checksums
        )
    except (BackupError, AudioInventoryError, SQLAlchemyError) as error:
        database.rollback()
        raise StorageHealthError() from error
    phrases = PhraseCounts(total=total, active=active, inactive=total - active)
    return {
        "sqlite_integrity": integrity,
        "phrases": asdict(phrases),
        "audio": audio.as_dict(),
        "read_only": True,
    }
