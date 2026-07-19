"""Private original-format storage for legacy and newly uploaded recordings."""

from dataclasses import dataclass
from datetime import date, datetime, timezone
import hashlib
import os
from pathlib import Path, PurePosixPath
from typing import Protocol
from uuid import UUID, uuid4

from app.config import BACKEND_ROOT, settings
from app.utils.audio_validation import (
    SUPPORTED_AUDIO_EXTENSIONS,
    AudioFileTooLargeError,
    AudioValidationError,
    ValidatedAudio,
    validate_audio_upload,
    validate_audio_upload_metadata,
)


RAW_STORAGE_KEY_PREFIX = "raw"
RAW_STORAGE_FORMAT_VERSION = "raw-v1"
UPLOAD_READ_CHUNK_SIZE = 64 * 1024


class AsyncUpload(Protocol):
    """Minimal interface supplied by FastAPI's UploadFile."""

    filename: str | None
    content_type: str | None

    async def read(self, size: int = -1) -> bytes: ...


class AudioStorageError(Exception):
    """Safe storage error that never exposes an absolute filesystem path."""

    code = "AUDIO_STORAGE_ERROR"
    default_message = "The recording could not be stored. Please try again."

    def __init__(self, message: str | None = None) -> None:
        self.message = message or self.default_message
        super().__init__(self.message)


@dataclass(frozen=True, slots=True)
class StoredAudio:
    """Integrity metadata for one finalized original recording."""

    storage_key: str
    generated_filename: str
    checksum_sha256: str
    file_size: int
    storage_format_version: str = RAW_STORAGE_FORMAT_VERSION


@dataclass(frozen=True, slots=True)
class StagedAudioUpload:
    """One bounded upload held privately until metadata validation succeeds."""

    path: Path
    validated_audio: ValidatedAudio
    checksum_sha256: str


def _configured_path(path: Path) -> Path:
    return (path if path.is_absolute() else BACKEND_ROOT / path).resolve()


def get_audio_storage_root() -> Path:
    """Return the legacy audio root so existing database paths still resolve."""

    storage_root = _configured_path(settings.storage_root)
    return (storage_root / settings.audio_storage_subdirectory).resolve()


def get_raw_audio_storage_root() -> Path:
    """Return the configurable persistent root used for all new recordings."""

    return _configured_path(settings.raw_audio_storage_root)


def get_audio_inventory_roots() -> tuple[Path, ...]:
    """Return distinct legacy/new roots for a read-only storage audit."""

    roots = (get_audio_storage_root(), get_raw_audio_storage_root())
    return tuple(dict.fromkeys(roots))


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


def _sha256_file(path: Path) -> str:
    checksum = hashlib.sha256()
    try:
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                checksum.update(chunk)
    except OSError as error:
        raise AudioStorageError() from error
    return checksum.hexdigest()


def _staging_root() -> Path:
    raw_root = get_raw_audio_storage_root()
    staging_root = raw_root / ".staging"
    _require_safe_resolved_path(staging_root, raw_root)
    try:
        staging_root.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        raise AudioStorageError() from error
    return _require_safe_resolved_path(staging_root, raw_root)


def _new_staging_path() -> Path:
    staging_root = _staging_root()
    candidate = staging_root / f"upload_{uuid4().hex}.tmp"
    return _require_safe_resolved_path(candidate, staging_root)


def _generated_filename(extension: str) -> str:
    return f"contribution_{uuid4().hex}.{_safe_extension(extension)}"


def _raw_target(created_at: datetime, extension: str) -> tuple[Path, str, str]:
    storage_date = _utc_calendar_date(created_at)
    raw_root = get_raw_audio_storage_root()
    month_directory = raw_root / f"{storage_date.year:04d}" / f"{storage_date.month:02d}"
    _require_safe_resolved_path(month_directory, raw_root)
    try:
        month_directory.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        raise AudioStorageError() from error
    _require_safe_resolved_path(month_directory, raw_root)
    filename = _generated_filename(extension)
    target = _require_safe_resolved_path(month_directory / filename, raw_root)
    storage_key = (
        PurePosixPath(RAW_STORAGE_KEY_PREFIX)
        / f"{storage_date.year:04d}"
        / f"{storage_date.month:02d}"
        / filename
    ).as_posix()
    return target, storage_key, filename


def _finalize_staged_file(
    *,
    staged_path: Path,
    extension: str,
    created_at: datetime,
    expected_size: int,
    expected_checksum: str,
) -> StoredAudio:
    staging_root = _staging_root()
    _require_safe_resolved_path(staged_path, staging_root)
    if staged_path.is_symlink() or not staged_path.is_file():
        raise AudioStorageError()
    try:
        if staged_path.stat().st_size != expected_size:
            raise AudioStorageError()
    except OSError as error:
        raise AudioStorageError() from error

    target, storage_key, filename = _raw_target(created_at, extension)
    linked = False
    try:
        os.link(staged_path, target)
        linked = True
        staged_path.unlink()
    except (FileExistsError, OSError) as error:
        try:
            if linked and target.exists() and target.is_file() and not target.is_symlink():
                target.unlink()
        except OSError:
            pass
        raise AudioStorageError() from error

    try:
        stored_checksum = _sha256_file(target)
        if stored_checksum != expected_checksum or target.stat().st_size != expected_size:
            raise AudioStorageError()
    except (AudioStorageError, OSError) as error:
        try:
            target.unlink(missing_ok=True)
        except OSError:
            pass
        raise AudioStorageError() from error

    return StoredAudio(
        storage_key=storage_key,
        generated_filename=filename,
        checksum_sha256=stored_checksum,
        file_size=expected_size,
    )


def store_audio_file(
    *, contribution_id: str, extension: str, content: bytes, created_at: datetime
) -> StoredAudio:
    """Atomically store exact bytes under a random server-generated filename."""

    _canonical_uuid(contribution_id)
    safe_extension = _safe_extension(extension)
    if not isinstance(content, bytes) or not content:
        raise AudioStorageError()
    staging_path = _new_staging_path()
    checksum = hashlib.sha256(content).hexdigest()
    try:
        with staging_path.open("xb") as destination:
            destination.write(content)
            destination.flush()
            os.fsync(destination.fileno())
        return _finalize_staged_file(
            staged_path=staging_path,
            extension=safe_extension,
            created_at=created_at,
            expected_size=len(content),
            expected_checksum=checksum,
        )
    except AudioStorageError:
        cleanup_staged_audio_path(staging_path)
        raise
    except OSError as error:
        cleanup_staged_audio_path(staging_path)
        raise AudioStorageError() from error


def save_audio_file(
    *, contribution_id: str, extension: str, content: bytes, created_at: datetime
) -> str:
    """Backward-compatible wrapper returning only the new relative storage key."""

    return store_audio_file(
        contribution_id=contribution_id,
        extension=extension,
        content=content,
        created_at=created_at,
    ).storage_key


async def stage_audio_upload(
    *, upload: AsyncUpload, max_size_bytes: int
) -> StagedAudioUpload:
    """Stream one bounded upload to private staging while hashing exact bytes."""

    staging_path = _new_staging_path()
    checksum = hashlib.sha256()
    signature = bytearray()
    total_bytes = 0
    try:
        with staging_path.open("xb") as destination:
            while True:
                chunk = await upload.read(UPLOAD_READ_CHUNK_SIZE)
                if not chunk:
                    break
                total_bytes += len(chunk)
                if total_bytes > max_size_bytes:
                    raise AudioFileTooLargeError()
                if len(signature) < 64:
                    signature.extend(chunk[: 64 - len(signature)])
                checksum.update(chunk)
                destination.write(chunk)
            destination.flush()
            os.fsync(destination.fileno())
        validated_audio = validate_audio_upload_metadata(
            filename=upload.filename or "recording",
            mime_type=upload.content_type or "",
            file_size=total_bytes,
            signature_bytes=bytes(signature),
            max_size_bytes=max_size_bytes,
        )
        return StagedAudioUpload(
            path=staging_path,
            validated_audio=validated_audio,
            checksum_sha256=checksum.hexdigest(),
        )
    except (AudioValidationError, AudioStorageError):
        cleanup_staged_audio_path(staging_path)
        raise
    except (OSError, TypeError, ValueError) as error:
        cleanup_staged_audio_path(staging_path)
        raise AudioStorageError() from error


def commit_staged_audio_file(
    *,
    contribution_id: str,
    staged_audio: StagedAudioUpload,
    created_at: datetime,
) -> StoredAudio:
    """Move one validated staged upload into its permanent raw location."""

    _canonical_uuid(contribution_id)
    return _finalize_staged_file(
        staged_path=staged_audio.path,
        extension=staged_audio.validated_audio.extension,
        created_at=created_at,
        expected_size=staged_audio.validated_audio.file_size,
        expected_checksum=staged_audio.checksum_sha256,
    )


def cleanup_staged_audio_path(path: Path) -> None:
    """Remove only one canonical staging file and tolerate prior finalization."""

    try:
        staging_root = _staging_root()
        _require_safe_resolved_path(path, staging_root)
        if path.exists() and path.is_file() and not path.is_symlink():
            path.unlink()
    except (AudioStorageError, OSError):
        return


def cleanup_staged_audio(staged_audio: StagedAudioUpload | None) -> None:
    if staged_audio is not None:
        cleanup_staged_audio_path(staged_audio.path)


def _resolve_raw_storage_key(key_path: PurePosixPath) -> Path:
    if len(key_path.parts) != 4:
        raise AudioStorageError()
    prefix, year, month, filename = key_path.parts
    if prefix != RAW_STORAGE_KEY_PREFIX:
        raise AudioStorageError()
    try:
        date(int(year), int(month), 1)
    except (ValueError, TypeError) as error:
        raise AudioStorageError() from error
    if len(year) != 4 or len(month) != 2:
        raise AudioStorageError()
    filename_path = Path(filename)
    if (
        filename_path.name != filename
        or not filename.startswith("contribution_")
        or len(filename_path.stem.removeprefix("contribution_")) != 32
    ):
        raise AudioStorageError()
    try:
        int(filename_path.stem.removeprefix("contribution_"), 16)
    except ValueError as error:
        raise AudioStorageError() from error
    _safe_extension(filename_path.suffix.removeprefix("."))
    root = get_raw_audio_storage_root()
    return _require_safe_resolved_path(root.joinpath(*key_path.parts[1:]), root)


def _resolve_legacy_storage_key(key_path: PurePosixPath) -> Path:
    if len(key_path.parts) != 5:
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
    root = get_audio_storage_root()
    return _require_safe_resolved_path(root.joinpath(*key_path.parts[1:]), root)


def resolve_audio_storage_path(storage_key: str) -> Path:
    """Resolve new raw or legacy keys without allowing traversal."""

    if not isinstance(storage_key, str) or not storage_key or "\\" in storage_key:
        raise AudioStorageError()
    key_path = PurePosixPath(storage_key)
    if (
        key_path.is_absolute()
        or ".." in key_path.parts
        or key_path.as_posix() != storage_key
    ):
        raise AudioStorageError()
    if key_path.parts[0] == RAW_STORAGE_KEY_PREFIX:
        return _resolve_raw_storage_key(key_path)
    return _resolve_legacy_storage_key(key_path)


def delete_audio_file(storage_key: str) -> None:
    """Delete one explicitly requested safe file and tolerate a missing target."""

    target_path = resolve_audio_storage_path(storage_key)
    if not target_path.exists():
        return
    if target_path.is_symlink() or not target_path.is_file():
        raise AudioStorageError()
    try:
        target_path.unlink()
    except OSError as error:
        raise AudioStorageError() from error
