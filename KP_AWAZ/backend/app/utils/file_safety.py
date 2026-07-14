"""Filename validation and safe generated names for future import storage."""

from pathlib import Path
from uuid import uuid4

from app.services.txt_import_parser import (
    InvalidImportFilenameError,
    InvalidTxtExtensionError,
)


def extract_safe_display_filename(filename: str) -> str:
    """Return a basename suitable for metadata, never for storage paths."""

    if not isinstance(filename, str) or not filename.strip():
        raise InvalidImportFilenameError()

    normalized_separators = filename.strip().replace("\\", "/")
    display_filename = normalized_separators.rsplit("/", maxsplit=1)[-1].strip()
    if (
        not display_filename
        or display_filename in {".", ".."}
        or "\x00" in display_filename
    ):
        raise InvalidImportFilenameError()

    return display_filename


def validate_txt_filename(filename: str) -> None:
    """Require a safe display filename whose final extension is .txt."""

    display_filename = extract_safe_display_filename(filename)
    if Path(display_filename).suffix.lower() != ".txt":
        raise InvalidTxtExtensionError()


def generate_safe_storage_filename(original_filename: str) -> str:
    """Generate an unrelated UUID filename with a validated TXT extension."""

    validate_txt_filename(original_filename)
    return f"{uuid4()}.txt"
