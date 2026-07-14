"""Secure filesystem operations for accepted TXT import source files."""

import shutil
from pathlib import Path
from uuid import UUID

from app.config import settings


class ImportFileStorageError(Exception):
    """Safe storage failure that does not expose filesystem details."""

    code = "IMPORT_FILE_STORAGE_ERROR"
    default_message = "The import source file could not be stored safely."

    def __init__(self, message: str | None = None) -> None:
        self.message = message or self.default_message
        super().__init__(self.message)


def get_import_storage_root() -> Path:
    """Return the resolved configured root for import batch directories."""

    return (settings.storage_root / "imports").resolve()


def _require_canonical_uuid(value: str) -> str:
    """Accept only one canonical UUID path component."""

    if not isinstance(value, str):
        raise ImportFileStorageError()

    try:
        canonical_value = str(UUID(value))
    except (ValueError, TypeError, AttributeError) as error:
        raise ImportFileStorageError() from error

    if value != canonical_value:
        raise ImportFileStorageError()
    return canonical_value


def _safe_batch_directory_path(batch_id: str) -> Path:
    """Resolve and validate one batch directory beneath the import root."""

    canonical_batch_id = _require_canonical_uuid(batch_id)
    import_root = get_import_storage_root()
    batch_directory = import_root / canonical_batch_id
    resolved_directory = batch_directory.resolve(strict=False)

    if resolved_directory.parent != import_root or resolved_directory != batch_directory:
        raise ImportFileStorageError()
    return batch_directory


def _safe_storage_filename(safe_storage_filename: str) -> str:
    """Require the parser's canonical UUID-based TXT filename."""

    if not isinstance(safe_storage_filename, str):
        raise ImportFileStorageError()

    filename_path = Path(safe_storage_filename)
    if (
        filename_path.is_absolute()
        or filename_path.name != safe_storage_filename
        or filename_path.suffix != ".txt"
    ):
        raise ImportFileStorageError()

    _require_canonical_uuid(filename_path.stem)
    return safe_storage_filename


def create_import_batch_directory(batch_id: str) -> Path:
    """Create and return one secure import batch directory."""

    import_root = get_import_storage_root()
    batch_directory = _safe_batch_directory_path(batch_id)

    try:
        import_root.mkdir(parents=True, exist_ok=True)
        batch_directory.mkdir(exist_ok=True)
    except OSError as error:
        raise ImportFileStorageError() from error

    if batch_directory.is_symlink() or batch_directory.resolve() != batch_directory:
        raise ImportFileStorageError()
    return batch_directory


def save_import_source_file(
    *, batch_id: str, safe_storage_filename: str, content: bytes
) -> str:
    """Write bytes once and return a non-absolute internal storage key."""

    validated_filename = _safe_storage_filename(safe_storage_filename)
    batch_directory = create_import_batch_directory(batch_id)
    candidate_path = batch_directory / validated_filename
    target_path = candidate_path.resolve(strict=False)

    if target_path.parent != batch_directory or target_path != candidate_path:
        raise ImportFileStorageError()

    try:
        with target_path.open("xb") as source_file:
            source_file.write(content)
    except (FileExistsError, OSError) as error:
        raise ImportFileStorageError() from error

    return (Path("imports") / batch_id / validated_filename).as_posix()


def delete_import_batch_directory(batch_id: str) -> None:
    """Remove only the validated batch directory; tolerate a missing batch."""

    batch_directory = _safe_batch_directory_path(batch_id)
    if not batch_directory.exists():
        return
    if batch_directory.is_symlink() or not batch_directory.is_dir():
        raise ImportFileStorageError()

    try:
        shutil.rmtree(batch_directory)
    except OSError as error:
        raise ImportFileStorageError() from error
