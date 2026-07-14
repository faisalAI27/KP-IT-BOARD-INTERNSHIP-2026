"""Pure-service tests for TXT validation, parsing, and response schemas."""

import codecs

import pytest
from pydantic import ValidationError

from app.config import Settings, settings
from app.schemas import ImportFileResultResponse, SentenceImportResponse
from app.services.txt_import_parser import (
    BlankImportLanguageError,
    ImportFileTooLargeError,
    InvalidTxtExtensionError,
    InvalidUtf8Error,
    NoImportFilesError,
    TxtFileInput,
    parse_txt_files,
)


def txt_file(content: str, filename: str = "phrases.txt") -> TxtFileInput:
    """Build one UTF-8 parser input."""

    return TxtFileInput(filename=filename, content=content.encode("utf-8"))


def test_one_valid_file() -> None:
    result = parse_txt_files(
        files=[txt_file("زما ژبه زما پېژندنه ده.\nهر غږ ارزښت لري.")],
        language="Pashto",
    )

    assert result.files_received == 1
    assert result.total_lines == 2
    assert result.candidate_phrases == 2
    assert result.duplicate_phrases == 0
    assert result.invalid_lines == 0


def test_multiple_valid_files_preserve_order_and_totals() -> None:
    result = parse_txt_files(
        files=[
            txt_file("لومړۍ جمله\nدويمه جمله", "first.txt"),
            txt_file("درېيمه جمله", "second.txt"),
        ],
        language="Pashto",
    )

    assert [file.filename for file in result.files] == ["first.txt", "second.txt"]
    assert result.files_received == 2
    assert result.total_lines == 3
    assert result.candidate_phrases == 3
    assert sum(len(file.sentences) for file in result.files) == 3


def test_blank_lines_count_but_are_not_candidates_or_invalid() -> None:
    result = parse_txt_files(
        files=[txt_file("لومړۍ جمله\n\n   \nدويمه جمله")],
        language="Pashto",
    )

    assert result.total_lines == 4
    assert result.candidate_phrases == 2
    assert result.invalid_lines == 0
    assert result.duplicate_phrases == 0


def test_surrounding_whitespace_is_removed() -> None:
    result = parse_txt_files(
        files=[txt_file("   هر غږ ارزښت لري.  ")],
        language="Pashto",
    )

    assert result.files[0].sentences[0].text == "هر غږ ارزښت لري."


def test_repeated_internal_whitespace_creates_duplicate() -> None:
    result = parse_txt_files(
        files=[txt_file("زما ژبه زما پېژندنه ده.\nزما   ژبه\tزما پېژندنه ده.")],
        language="Pashto",
    )

    assert result.candidate_phrases == 1
    assert result.duplicate_phrases == 1


def test_duplicate_in_one_file_is_counted() -> None:
    result = parse_txt_files(
        files=[txt_file("هر غږ ارزښت لري.\nهر غږ ارزښت لري.")],
        language="Pashto",
    )

    assert result.files[0].candidate_phrases == 1
    assert result.files[0].duplicate_phrases == 1


def test_duplicate_across_files_is_counted_in_second_file() -> None:
    result = parse_txt_files(
        files=[
            txt_file("هر غږ ارزښت لري.", "first.txt"),
            txt_file("هر غږ ارزښت لري.", "second.txt"),
        ],
        language="Pashto",
    )

    assert result.files[0].candidate_phrases == 1
    assert result.files[1].candidate_phrases == 0
    assert result.files[1].duplicate_phrases == 1
    assert result.duplicate_phrases == 1


def test_pashto_text_is_preserved_exactly() -> None:
    sentence = "پښتو زموږ د تاریخ یوه مهمه برخه ده."
    result = parse_txt_files(files=[txt_file(sentence)], language="pashto")

    candidate = result.files[0].sentences[0]
    assert candidate.text == sentence
    assert candidate.language == "Pashto"


def test_punctuation_is_preserved() -> None:
    sentence = "ایا هر غږ ارزښت لري؟ هو، لري!"
    result = parse_txt_files(files=[txt_file(sentence)], language="Pashto")

    assert result.files[0].sentences[0].text == sentence


def test_diacritics_are_preserved() -> None:
    sentence = "مُحَمَّد زموږ ملګری دی."
    result = parse_txt_files(files=[txt_file(sentence)], language="Pashto")

    assert result.files[0].sentences[0].text == sentence


def test_utf8_bom_is_removed_from_text_and_normalization() -> None:
    sentence = "زما ژبه زما پېژندنه ده."
    result = parse_txt_files(
        files=[
            TxtFileInput(
                filename="bom.txt",
                content=codecs.BOM_UTF8 + sentence.encode("utf-8"),
            )
        ],
        language="Pashto",
    )

    candidate = result.files[0].sentences[0]
    assert candidate.text == sentence
    assert candidate.normalized_text == sentence
    assert "\ufeff" not in candidate.text


def test_invalid_utf8_raises_safe_dedicated_error() -> None:
    invalid_file = TxtFileInput(filename="invalid.txt", content=b"\xff\xfe")

    with pytest.raises(InvalidUtf8Error) as error:
        parse_txt_files(files=[invalid_file], language="Pashto")

    assert error.value.code == "INVALID_UTF8_FILE"
    assert str(error.value) == "The import file must contain valid UTF-8 text."


def test_invalid_extension_raises_dedicated_error() -> None:
    with pytest.raises(InvalidTxtExtensionError) as error:
        parse_txt_files(files=[txt_file("valid phrase", "phrases.csv")], language="Pashto")

    assert error.value.code == "INVALID_TXT_EXTENSION"


def test_file_exactly_at_size_limit_is_accepted(monkeypatch: pytest.MonkeyPatch) -> None:
    one_byte_in_megabytes = 1 / (1024 * 1024)
    monkeypatch.setattr(settings, "max_import_file_size_mb", one_byte_in_megabytes)

    result = parse_txt_files(
        files=[TxtFileInput(filename="exact.txt", content=b"a")],
        language="Pashto",
    )

    assert result.total_lines == 1
    assert result.invalid_lines == 1


def test_file_larger_than_size_limit_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    one_byte_in_megabytes = 1 / (1024 * 1024)
    monkeypatch.setattr(settings, "max_import_file_size_mb", one_byte_in_megabytes)

    with pytest.raises(ImportFileTooLargeError) as error:
        parse_txt_files(
            files=[TxtFileInput(filename="large.txt", content=b"aa")],
            language="Pashto",
        )

    assert error.value.code == "IMPORT_FILE_TOO_LARGE"


def test_short_nonblank_line_is_invalid() -> None:
    result = parse_txt_files(files=[txt_file("ab")], language="Pashto")

    assert result.candidate_phrases == 0
    assert result.invalid_lines == 1


def test_long_line_is_invalid() -> None:
    result = parse_txt_files(files=[txt_file("x" * 501)], language="Pashto")

    assert result.candidate_phrases == 0
    assert result.invalid_lines == 1


def test_file_with_only_invalid_lines_returns_counts() -> None:
    result = parse_txt_files(
        files=[txt_file(f"a\n{'x' * 501}")],
        language="Pashto",
    )

    assert result.total_lines == 2
    assert result.candidate_phrases == 0
    assert result.invalid_lines == 2


def test_empty_file_returns_zero_counts() -> None:
    result = parse_txt_files(files=[txt_file("")], language="Pashto")

    assert result.total_lines == 0
    assert result.candidate_phrases == 0
    assert result.duplicate_phrases == 0
    assert result.invalid_lines == 0


def test_no_files_raises_dedicated_error() -> None:
    with pytest.raises(NoImportFilesError) as error:
        parse_txt_files(files=[], language="Pashto")

    assert error.value.code == "NO_IMPORT_FILES"


def test_blank_language_raises_dedicated_error() -> None:
    with pytest.raises(BlankImportLanguageError) as error:
        parse_txt_files(files=[txt_file("valid phrase")], language="   ")

    assert error.value.code == "BLANK_IMPORT_LANGUAGE"


def test_repeated_calls_have_independent_duplicate_state() -> None:
    files = [txt_file("هر غږ ارزښت لري.")]

    first_result = parse_txt_files(files=files, language="Pashto")
    second_result = parse_txt_files(files=files, language="Pashto")

    assert first_result.candidate_phrases == 1
    assert second_result.candidate_phrases == 1
    assert first_result.duplicate_phrases == 0
    assert second_result.duplicate_phrases == 0


def test_candidates_contain_one_based_physical_line_numbers() -> None:
    result = parse_txt_files(
        files=[txt_file("لومړۍ جمله\n\nx\nڅلورمه جمله")],
        language="Pashto",
    )

    assert [candidate.line_number for candidate in result.files[0].sentences] == [1, 4]


def test_source_filename_uses_safe_display_basename() -> None:
    result = parse_txt_files(
        files=[txt_file("هر غږ ارزښت لري.", "../../phrases.txt")],
        language="Pashto",
    )

    assert result.files[0].filename == "phrases.txt"
    assert result.files[0].sentences[0].source_filename == "phrases.txt"


def test_sentence_import_response_serializes_with_camel_case_aliases() -> None:
    response = SentenceImportResponse(
        batch_id="batch-id",
        language="Pashto",
        files_received=1,
        total_lines=2,
        imported=2,
        duplicates=0,
        invalid=0,
        files=[
            ImportFileResultResponse(
                filename="phrases.txt",
                total_lines=2,
                imported=2,
                duplicates=0,
                invalid=0,
            )
        ],
    )

    serialized = response.model_dump(by_alias=True)

    assert serialized == {
        "batchId": "batch-id",
        "language": "Pashto",
        "filesReceived": 1,
        "totalLines": 2,
        "imported": 2,
        "duplicates": 0,
        "invalid": 0,
        "files": [
            {
                "filename": "phrases.txt",
                "totalLines": 2,
                "imported": 2,
                "duplicates": 0,
                "invalid": 0,
            }
        ],
    }
    assert "batch_id" not in serialized
    assert "files_received" not in serialized
    assert "total_lines" not in serialized


@pytest.mark.parametrize(
    "setting_name",
    [
        "max_import_file_size_mb",
        "min_imported_sentence_length",
        "max_imported_sentence_length",
    ],
)
def test_import_settings_must_be_positive(setting_name: str) -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **{setting_name: 0})


def test_minimum_import_length_cannot_exceed_maximum() -> None:
    with pytest.raises(ValidationError, match="must not be greater"):
        Settings(
            _env_file=None,
            min_imported_sentence_length=10,
            max_imported_sentence_length=5,
        )
