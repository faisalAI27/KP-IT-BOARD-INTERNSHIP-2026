"""Tests for safe TXT display and generated storage filenames."""

from uuid import UUID

import pytest

from app.services.txt_import_parser import (
    InvalidImportFilenameError,
    InvalidTxtExtensionError,
)
from app.utils.file_safety import (
    extract_safe_display_filename,
    generate_safe_storage_filename,
    validate_txt_filename,
)


@pytest.mark.parametrize("filename", ["phrases.txt", "PASHTO.TXT"])
def test_txt_extensions_are_accepted_case_insensitively(filename: str) -> None:
    validate_txt_filename(filename)


@pytest.mark.parametrize("filename", ["phrases.csv", "phrases.txt.exe", "phrases"])
def test_non_txt_or_missing_extensions_are_rejected(filename: str) -> None:
    with pytest.raises(InvalidTxtExtensionError) as error:
        validate_txt_filename(filename)

    assert error.value.code == "INVALID_TXT_EXTENSION"


def test_empty_filename_is_rejected() -> None:
    with pytest.raises(InvalidImportFilenameError) as error:
        validate_txt_filename("")

    assert error.value.code == "INVALID_IMPORT_FILENAME"


def test_unix_traversal_is_reduced_to_display_basename() -> None:
    assert extract_safe_display_filename("../../phrases.txt") == "phrases.txt"


def test_windows_traversal_is_reduced_to_display_basename() -> None:
    assert extract_safe_display_filename(r"..\..\phrases.txt") == "phrases.txt"


def test_generated_storage_filename_is_uuid_txt() -> None:
    generated_filename = generate_safe_storage_filename("phrases.txt")

    assert generated_filename.endswith(".txt")
    assert str(UUID(generated_filename.removesuffix(".txt"))) + ".txt" == generated_filename


def test_generated_storage_filenames_are_unique() -> None:
    first_name = generate_safe_storage_filename("phrases.txt")
    second_name = generate_safe_storage_filename("phrases.txt")

    assert first_name != second_name


def test_generated_storage_filename_excludes_original_text() -> None:
    generated_filename = generate_safe_storage_filename("recognizable-name.txt")

    assert "recognizable-name" not in generated_filename
