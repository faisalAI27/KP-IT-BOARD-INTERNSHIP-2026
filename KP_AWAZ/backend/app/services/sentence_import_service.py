"""Transactional orchestration for parsed TXT sentence imports."""

from collections.abc import Iterable
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import ImportBatch, Sentence
from app.schemas import ImportFileResultResponse, SentenceImportResponse
from app.services.import_file_storage import (
    ImportFileStorageError,
    delete_import_batch_directory,
    save_import_source_file,
)
from app.services.txt_import_parser import (
    BlankImportLanguageError,
    TxtFileInput,
    TxtImportError,
    parse_txt_files,
)
from app.utils.text_normalization import normalize_language_name


DATABASE_DUPLICATE_QUERY_CHUNK_SIZE = 500


class SentenceImportFailedError(Exception):
    """Safe failure returned when import orchestration cannot complete."""

    code = "SENTENCE_IMPORT_FAILED"
    default_message = "The sentence import could not be completed."

    def __init__(self, message: str | None = None) -> None:
        self.message = message or self.default_message
        super().__init__(self.message)


def _chunks(values: list[str], size: int) -> Iterable[list[str]]:
    for start in range(0, len(values), size):
        yield values[start : start + size]


def _find_existing_normalized_texts(
    database: Session, *, language: str, normalized_texts: set[str]
) -> set[str]:
    """Bulk-load database duplicates without issuing one query per sentence."""

    if not normalized_texts:
        return set()

    existing_normalized_texts: set[str] = set()
    ordered_texts = sorted(normalized_texts)
    for text_chunk in _chunks(ordered_texts, DATABASE_DUPLICATE_QUERY_CHUNK_SIZE):
        statement = select(Sentence.normalized_text).where(
            func.lower(Sentence.language) == language.lower(),
            Sentence.normalized_text.in_(text_chunk),
        )
        existing_normalized_texts.update(database.scalars(statement).all())

    return existing_normalized_texts


def _cleanup_failed_import(database: Session, batch_id: str) -> None:
    """Roll back database work and best-effort remove only this batch's files."""

    database.rollback()
    try:
        delete_import_batch_directory(batch_id)
    except ImportFileStorageError:
        # Cleanup must not replace the original import failure.
        pass


def import_txt_sentences(
    *, database: Session, language: str, files: list[TxtFileInput]
) -> SentenceImportResponse:
    """Parse, deduplicate, store, and atomically commit one import batch."""

    try:
        normalized_language = normalize_language_name(language)
    except (TypeError, ValueError) as error:
        raise BlankImportLanguageError() from error

    batch_id = str(uuid4())
    import_batch = ImportBatch(
        id=batch_id,
        language=normalized_language,
        number_of_files=len(files),
        status="processing",
    )

    try:
        database.add(import_batch)
        database.flush()

        parsed_import = parse_txt_files(files=files, language=normalized_language)
        candidate_normalized_texts = {
            candidate.normalized_text
            for parsed_file in parsed_import.files
            for candidate in parsed_file.sentences
        }
        database_duplicates = _find_existing_normalized_texts(
            database,
            language=normalized_language,
            normalized_texts=candidate_normalized_texts,
        )

        sentences_to_insert: list[Sentence] = []
        file_responses: list[ImportFileResultResponse] = []
        database_duplicate_count = 0

        for parsed_file in parsed_import.files:
            file_database_duplicates = 0
            file_imported = 0

            for candidate in parsed_file.sentences:
                if candidate.normalized_text in database_duplicates:
                    file_database_duplicates += 1
                    database_duplicate_count += 1
                    continue

                sentences_to_insert.append(
                    Sentence(
                        language=normalized_language,
                        text=candidate.text,
                        meaning=None,
                        normalized_text=candidate.normalized_text,
                        source_type="txt_import",
                        source_filename=candidate.source_filename,
                        is_active=True,
                    )
                )
                file_imported += 1

            file_responses.append(
                ImportFileResultResponse(
                    filename=parsed_file.filename,
                    total_lines=parsed_file.total_lines,
                    imported=file_imported,
                    duplicates=(
                        parsed_file.duplicate_phrases + file_database_duplicates
                    ),
                    invalid=parsed_file.invalid_lines,
                )
            )

        database.add_all(sentences_to_insert)
        database.flush()

        for uploaded_file, parsed_file in zip(
            files, parsed_import.files, strict=True
        ):
            save_import_source_file(
                batch_id=batch_id,
                safe_storage_filename=parsed_file.safe_storage_filename,
                content=uploaded_file.content,
            )

        imported_count = len(sentences_to_insert)
        duplicate_count = (
            parsed_import.duplicate_phrases + database_duplicate_count
        )
        import_batch.total_lines = parsed_import.total_lines
        import_batch.imported_phrases = imported_count
        import_batch.duplicate_phrases = duplicate_count
        import_batch.invalid_lines = parsed_import.invalid_lines
        import_batch.status = "completed"

        response = SentenceImportResponse(
            batch_id=batch_id,
            language=normalized_language,
            files_received=parsed_import.files_received,
            total_lines=parsed_import.total_lines,
            imported=imported_count,
            duplicates=duplicate_count,
            invalid=parsed_import.invalid_lines,
            files=file_responses,
        )
        database.commit()
        return response
    except TxtImportError:
        _cleanup_failed_import(database, batch_id)
        raise
    except Exception as error:
        _cleanup_failed_import(database, batch_id)
        raise SentenceImportFailedError() from error
