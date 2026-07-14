"""Pure validation and parsing service for future TXT sentence imports."""

from dataclasses import dataclass

from app.config import settings
from app.utils.text_normalization import (
    clean_sentence_text,
    normalize_language_name,
    normalize_sentence_text,
)


class TxtImportError(Exception):
    """Base error containing safe details for future API responses."""

    code = "TXT_IMPORT_ERROR"
    default_message = "The TXT import could not be processed."

    def __init__(self, message: str | None = None) -> None:
        self.message = message or self.default_message
        super().__init__(self.message)


class InvalidTxtExtensionError(TxtImportError):
    """Raised when an uploaded filename does not end in .txt."""

    code = "INVALID_TXT_EXTENSION"
    default_message = "Import files must use the .txt extension."


class ImportFileTooLargeError(TxtImportError):
    """Raised when content exceeds the configured byte limit."""

    code = "IMPORT_FILE_TOO_LARGE"
    default_message = "The import file exceeds the configured size limit."


class InvalidUtf8Error(TxtImportError):
    """Raised when file bytes cannot be decoded strictly as UTF-8."""

    code = "INVALID_UTF8_FILE"
    default_message = "The import file must contain valid UTF-8 text."


class InvalidImportFilenameError(TxtImportError):
    """Raised when no safe display filename can be extracted."""

    code = "INVALID_IMPORT_FILENAME"
    default_message = "A valid import filename is required."


class NoImportFilesError(TxtImportError):
    """Raised when a multi-file operation receives no files."""

    code = "NO_IMPORT_FILES"
    default_message = "At least one TXT import file is required."


class BlankImportLanguageError(TxtImportError):
    """Raised when the import language is empty or whitespace-only."""

    code = "BLANK_IMPORT_LANGUAGE"
    default_message = "An import language is required."


@dataclass(frozen=True, slots=True)
class TxtFileInput:
    """In-memory filename and bytes supplied to the pure parser."""

    filename: str
    content: bytes


@dataclass(frozen=True, slots=True)
class ParsedSentenceCandidate:
    """One valid, unique sentence ready for a later persistence phase."""

    text: str
    normalized_text: str
    language: str
    source_filename: str
    line_number: int


@dataclass(frozen=True, slots=True)
class ParsedTxtFileResult:
    """Parsing counts and candidates for one TXT file."""

    filename: str
    safe_storage_filename: str
    total_lines: int
    candidate_phrases: int
    duplicate_phrases: int
    invalid_lines: int
    sentences: list[ParsedSentenceCandidate]


@dataclass(frozen=True, slots=True)
class ParsedTxtImportResult:
    """Aggregate result for one independent multi-file parsing operation."""

    language: str
    files_received: int
    total_lines: int
    candidate_phrases: int
    duplicate_phrases: int
    invalid_lines: int
    files: list[ParsedTxtFileResult]


def parse_txt_file(
    *,
    filename: str,
    content: bytes,
    language: str,
    seen_normalized_texts: set[str],
) -> ParsedTxtFileResult:
    """Validate and parse one in-memory TXT file without database or disk I/O."""

    from app.utils.file_safety import (
        extract_safe_display_filename,
        generate_safe_storage_filename,
        validate_txt_filename,
    )

    display_filename = extract_safe_display_filename(filename)
    validate_txt_filename(display_filename)

    maximum_size_bytes = int(settings.max_import_file_size_mb * 1024 * 1024)
    if len(content) > maximum_size_bytes:
        raise ImportFileTooLargeError()

    try:
        decoded_content = content.decode("utf-8-sig", errors="strict")
    except UnicodeDecodeError as error:
        raise InvalidUtf8Error() from error

    normalized_language = normalize_language_name(language)
    physical_lines = decoded_content.splitlines()
    parsed_sentences: list[ParsedSentenceCandidate] = []
    duplicate_phrases = 0
    invalid_lines = 0

    for line_number, line in enumerate(physical_lines, start=1):
        if line_number == 1:
            line = line.removeprefix("\ufeff")

        cleaned_text = clean_sentence_text(line)
        if not cleaned_text:
            continue

        if not (
            settings.min_imported_sentence_length
            <= len(cleaned_text)
            <= settings.max_imported_sentence_length
        ):
            invalid_lines += 1
            continue

        normalized_text = normalize_sentence_text(cleaned_text)
        if normalized_text in seen_normalized_texts:
            duplicate_phrases += 1
            continue

        seen_normalized_texts.add(normalized_text)
        parsed_sentences.append(
            ParsedSentenceCandidate(
                text=cleaned_text,
                normalized_text=normalized_text,
                language=normalized_language,
                source_filename=display_filename,
                line_number=line_number,
            )
        )

    return ParsedTxtFileResult(
        filename=display_filename,
        safe_storage_filename=generate_safe_storage_filename(display_filename),
        total_lines=len(physical_lines),
        candidate_phrases=len(parsed_sentences),
        duplicate_phrases=duplicate_phrases,
        invalid_lines=invalid_lines,
        sentences=parsed_sentences,
    )


def parse_txt_files(
    *, files: list[TxtFileInput], language: str
) -> ParsedTxtImportResult:
    """Parse ordered TXT inputs with duplicate state scoped to this call."""

    if not files:
        raise NoImportFilesError()

    try:
        normalized_language = normalize_language_name(language)
    except (TypeError, ValueError) as error:
        raise BlankImportLanguageError() from error

    seen_normalized_texts: set[str] = set()
    parsed_files = [
        parse_txt_file(
            filename=file.filename,
            content=file.content,
            language=normalized_language,
            seen_normalized_texts=seen_normalized_texts,
        )
        for file in files
    ]

    return ParsedTxtImportResult(
        language=normalized_language,
        files_received=len(parsed_files),
        total_lines=sum(file.total_lines for file in parsed_files),
        candidate_phrases=sum(file.candidate_phrases for file in parsed_files),
        duplicate_phrases=sum(file.duplicate_phrases for file in parsed_files),
        invalid_lines=sum(file.invalid_lines for file in parsed_files),
        files=parsed_files,
    )
