"""Secure date-based filesystem storage for validated audio bytes."""

from datetime import date, datetime, timezone
from pathlib import Path, PurePosixPath
from uuid import UUID

from app.config import settings
from app.utils.audio_validation import SUPPORTED_AUDIO_EXTENSIONS


class AudioStorageError(Exception):
    """Safe storage error that never exposes an absolute filesystem path."""

    code = "AUDIO_STORAGE_ERROR"
    default_message = "The audio file could not be stored safely."

    def __init__(self, message: str | None = None) -> None:
        self.message = message or self.default_message
        super().__init__(self.message)


def get_audio_storage_root() -> Path:
    """Return the resolved root configured for private audio files."""

    return (settings.storage_root / settings.audio_storage_subdirectory).resolve()


def _canonical_uuid(value: str) -> str:
    if not isinstance(value, str):
        raise AudioStorageError()
    try:
        canonical_value = str(UUID(value))
    except (ValueError, TypeError, AttributeError) as error:
        raise AudioStorageError() from error
    if value != canonical_value:
        raise AudioStorageError()
    return canonical_value


def _safe_extension(extension: str) -> str:
    if (
        not isinstance(extension, str)
        or extension not in SUPPORTED_AUDIO_EXTENSIONS
        or Path(extension).name != extension
        or "." in extension
        or "\\" in extension
    ):
        raise AudioStorageError()
    return extension


def _utc_calendar_date(created_at: datetime) -> date:
    if not isinstance(created_at, datetime):
        raise AudioStorageError()
    if created_at.tzinfo is None or created_at.utcoffset() is None:
        normalized_datetime = created_at.replace(tzinfo=timezone.utc)
    else:
        normalized_datetime = created_at.astimezone(timezone.utc)
    return normalized_datetime.date()


def _require_safe_resolved_path(candidate: Path, root: Path) -> Path:
    resolved_candidate = candidate.resolve(strict=False)
    if resolved_candidate != candidate or not resolved_candidate.is_relative_to(root):
        raise AudioStorageError()
    return candidate


def save_audio_file(
    *, contribution_id: str, extension: str, content: bytes, created_at: datetime
) -> str:
    """Store bytes exclusively and return a path relative to storage root."""

    safe_id = _canonical_uuid(contribution_id)
    safe_extension = _safe_extension(extension)
    storage_date = _utc_calendar_date(created_at)
    audio_root = get_audio_storage_root()
    date_directory = audio_root / (
        f"{storage_date.year:04d}/{storage_date.month:02d}/{storage_date.day:02d}"
    )
    _require_safe_resolved_path(date_directory, audio_root)

    try:
        date_directory.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        raise AudioStorageError() from error

    _require_safe_resolved_path(date_directory, audio_root)
    target_path = date_directory / f"{safe_id}.{safe_extension}"
    _require_safe_resolved_path(target_path, audio_root)

    try:
        with target_path.open("xb") as audio_file:
            audio_file.write(content)
    except (FileExistsError, OSError) as error:
        raise AudioStorageError() from error

    return (
        PurePosixPath(settings.audio_storage_subdirectory)
        / f"{storage_date.year:04d}"
        / f"{storage_date.month:02d}"
        / f"{storage_date.day:02d}"
        / f"{safe_id}.{safe_extension}"
    ).as_posix()


def resolve_audio_storage_path(storage_key: str) -> Path:
    """Resolve a canonical audio storage key without allowing traversal."""

    if (
        not isinstance(storage_key, str)
        or not storage_key
        or "\\" in storage_key
    ):
        raise AudioStorageError()

    key_path = PurePosixPath(storage_key)
    if key_path.is_absolute() or ".." in key_path.parts:
        raise AudioStorageError()
    if key_path.as_posix() != storage_key or len(key_path.parts) != 5:
        raise AudioStorageError()

    subdirectory, year, month, day, filename = key_path.parts
    if subdirectory != settings.audio_storage_subdirectory:
        raise AudioStorageError()

    try:
        date(int(year), int(month), int(day))
    except (ValueError, TypeError) as error:
        raise AudioStorageError() from error
    if len(year) != 4 or len(month) != 2 or len(day) != 2:
        raise AudioStorageError()

    filename_path = Path(filename)
    if filename_path.name != filename or not filename_path.suffix:
        raise AudioStorageError()
    _canonical_uuid(filename_path.stem)
    _safe_extension(filename_path.suffix.removeprefix("."))

    audio_root = get_audio_storage_root()
    target_path = audio_root.joinpath(*key_path.parts[1:])
    return _require_safe_resolved_path(target_path, audio_root)


def delete_audio_file(storage_key: str) -> None:
    """Delete one validated audio file and tolerate a missing target."""

    target_path = resolve_audio_storage_path(storage_key)
    if not target_path.exists():
        return
    if target_path.is_symlink() or not target_path.is_file():
        raise AudioStorageError()

    try:
        target_path.unlink()
    except OSError as error:
        raise AudioStorageError() from error
