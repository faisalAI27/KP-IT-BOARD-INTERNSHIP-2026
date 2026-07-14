"""Transactional service tests for database and source-file imports."""

from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

import app.services.sentence_import_service as import_service_module
from app.models import ImportBatch, Sentence
from app.services.import_file_storage import (
    ImportFileStorageError,
    create_import_batch_directory,
)
from app.services.sentence_import_service import (
    SentenceImportFailedError,
    import_txt_sentences,
)
from app.services.txt_import_parser import TxtFileInput
from app.utils.text_normalization import normalize_sentence_text


def txt_file(content: str, filename: str = "phrases.txt") -> TxtFileInput:
    return TxtFileInput(filename=filename, content=content.encode("utf-8"))


def add_existing_sentence(
    database: Session, *, text: str, language: str = "Pashto"
) -> Sentence:
    sentence = Sentence(
        language=language,
        text=text,
        meaning=None,
        normalized_text=normalize_sentence_text(text),
        source_type="custom",
        source_filename=None,
        is_active=True,
    )
    database.add(sentence)
    database.commit()
    return sentence


def sentence_count(database: Session) -> int:
    return database.scalar(select(func.count()).select_from(Sentence)) or 0


def batch_count(database: Session) -> int:
    return database.scalar(select(func.count()).select_from(ImportBatch)) or 0


def test_import_one_file_creates_batch_sentences_and_source(
    db_session: Session, test_storage_root: Path
) -> None:
    result = import_txt_sentences(
        database=db_session,
        language="Pashto",
        files=[txt_file("لومړۍ جمله\nدويمه جمله")],
    )

    batch = db_session.get(ImportBatch, result.batch_id)
    stored_files = list((test_storage_root / "imports" / result.batch_id).iterdir())

    assert batch is not None
    assert batch.status == "completed"
    assert sentence_count(db_session) == 2
    assert result.imported == 2
    assert result.duplicates == 0
    assert result.invalid == 0
    assert len(stored_files) == 1
    assert stored_files[0].read_bytes() == "لومړۍ جمله\nدويمه جمله".encode("utf-8")


def test_import_multiple_files_and_per_file_totals(
    db_session: Session, test_storage_root: Path
) -> None:
    result = import_txt_sentences(
        database=db_session,
        language="Pashto",
        files=[
            txt_file("لومړۍ جمله\nدويمه جمله", "first.txt"),
            txt_file("درېيمه جمله\nڅلورمه جمله", "second.txt"),
        ],
    )

    assert result.files_received == 2
    assert result.total_lines == 4
    assert result.imported == 4
    assert [file.imported for file in result.files] == [2, 2]
    assert sentence_count(db_session) == 4
    assert len(list((test_storage_root / "imports" / result.batch_id).iterdir())) == 2


def test_parser_duplicate_in_one_file(db_session: Session) -> None:
    result = import_txt_sentences(
        database=db_session,
        language="Pashto",
        files=[txt_file("هر غږ ارزښت لري.\nهر غږ ارزښت لري.")],
    )

    assert result.imported == 1
    assert result.duplicates == 1
    assert result.files[0].duplicates == 1
    assert sentence_count(db_session) == 1


def test_duplicate_across_files_is_counted_for_second_file(
    db_session: Session,
) -> None:
    result = import_txt_sentences(
        database=db_session,
        language="Pashto",
        files=[
            txt_file("هر غږ ارزښت لري.", "first.txt"),
            txt_file("هر غږ ارزښت لري.", "second.txt"),
        ],
    )

    assert [file.duplicates for file in result.files] == [0, 1]
    assert [file.imported for file in result.files] == [1, 0]
    assert result.duplicates == 1


def test_existing_database_duplicate_is_skipped(db_session: Session) -> None:
    add_existing_sentence(db_session, text="هر غږ ارزښت لري.")

    result = import_txt_sentences(
        database=db_session,
        language="Pashto",
        files=[txt_file("هر غږ ارزښت لري.")],
    )

    assert sentence_count(db_session) == 1
    assert result.imported == 0
    assert result.duplicates == 1
    assert result.files[0].duplicates == 1


def test_existing_duplicate_matches_whitespace_differences(
    db_session: Session,
) -> None:
    add_existing_sentence(db_session, text="زما ژبه زما پېژندنه ده.")

    result = import_txt_sentences(
        database=db_session,
        language="Pashto",
        files=[txt_file("  زما   ژبه\tزما پېژندنه ده.  ")],
    )

    assert result.imported == 0
    assert result.duplicates == 1
    assert sentence_count(db_session) == 1


@pytest.mark.parametrize("import_language", ["pashto", "PASHTO"])
def test_existing_duplicate_matches_language_case(
    import_language: str, db_session: Session
) -> None:
    add_existing_sentence(db_session, text="هر غږ ارزښت لري.")

    result = import_txt_sentences(
        database=db_session,
        language=import_language,
        files=[txt_file("هر غږ ارزښت لري.")],
    )

    assert result.language == "Pashto"
    assert result.duplicates == 1
    assert sentence_count(db_session) == 1


def test_invalid_lines_are_counted_while_valid_lines_import(
    db_session: Session,
) -> None:
    result = import_txt_sentences(
        database=db_session,
        language="Pashto",
        files=[txt_file("ab\nهر غږ ارزښت لري.")],
    )

    assert result.total_lines == 2
    assert result.imported == 1
    assert result.invalid == 1


def test_blank_lines_are_ignored_not_invalid(db_session: Session) -> None:
    result = import_txt_sentences(
        database=db_session,
        language="Pashto",
        files=[txt_file("هر غږ ارزښت لري.\n\n   ")],
    )

    assert result.total_lines == 3
    assert result.imported == 1
    assert result.invalid == 0


def test_empty_file_completes_with_zero_counts(
    db_session: Session, test_storage_root: Path
) -> None:
    result = import_txt_sentences(
        database=db_session,
        language="Pashto",
        files=[txt_file("")],
    )

    batch = db_session.get(ImportBatch, result.batch_id)
    assert batch is not None and batch.status == "completed"
    assert (result.total_lines, result.imported, result.duplicates, result.invalid) == (0, 0, 0, 0)
    assert len(list((test_storage_root / "imports" / result.batch_id).iterdir())) == 1


def test_completely_invalid_file_completes(db_session: Session) -> None:
    result = import_txt_sentences(
        database=db_session,
        language="Pashto",
        files=[txt_file(f"a\n{'x' * 501}")],
    )

    assert result.imported == 0
    assert result.duplicates == 0
    assert result.invalid == 2
    assert db_session.get(ImportBatch, result.batch_id).status == "completed"  # type: ignore[union-attr]


def test_all_database_duplicates_complete_without_new_rows(
    db_session: Session,
) -> None:
    add_existing_sentence(db_session, text="لومړۍ جمله")
    add_existing_sentence(db_session, text="دويمه جمله")

    result = import_txt_sentences(
        database=db_session,
        language="Pashto",
        files=[txt_file("لومړۍ جمله\nدويمه جمله")],
    )

    assert result.imported == 0
    assert result.duplicates == 2
    assert sentence_count(db_session) == 2


def test_inserted_sentence_source_metadata_uses_display_filename(
    db_session: Session,
) -> None:
    result = import_txt_sentences(
        database=db_session,
        language="Pashto",
        files=[txt_file("هر غږ ارزښت لري.", "../../safe-name.txt")],
    )
    sentence = db_session.scalar(select(Sentence))

    assert result.files[0].filename == "safe-name.txt"
    assert sentence is not None
    assert sentence.source_type == "txt_import"
    assert sentence.source_filename == "safe-name.txt"


def test_pashto_punctuation_and_diacritics_are_preserved(
    db_session: Session,
) -> None:
    text = "مُحَمَّد وایي: هر غږ ارزښت لري!"

    import_txt_sentences(
        database=db_session,
        language="Pashto",
        files=[txt_file(text)],
    )
    sentence = db_session.scalar(select(Sentence))

    assert sentence is not None
    assert sentence.text == text


def test_storage_failure_rolls_back_database_and_cleans_batch(
    monkeypatch: pytest.MonkeyPatch,
    db_session: Session,
    test_storage_root: Path,
) -> None:
    def fail_storage(
        *, batch_id: str, safe_storage_filename: str, content: bytes
    ) -> str:
        create_import_batch_directory(batch_id)
        raise ImportFileStorageError()

    monkeypatch.setattr(import_service_module, "save_import_source_file", fail_storage)

    with pytest.raises(SentenceImportFailedError):
        import_txt_sentences(
            database=db_session,
            language="Pashto",
            files=[txt_file("هر غږ ارزښت لري.")],
        )

    assert sentence_count(db_session) == 0
    assert batch_count(db_session) == 0
    assert list((test_storage_root / "imports").glob("*")) == []


def test_database_failure_after_storage_rolls_back_and_cleans_files(
    monkeypatch: pytest.MonkeyPatch,
    db_session: Session,
    test_storage_root: Path,
) -> None:
    monkeypatch.setattr(
        db_session,
        "commit",
        lambda: (_ for _ in ()).throw(RuntimeError("simulated database failure")),
    )

    with pytest.raises(SentenceImportFailedError):
        import_txt_sentences(
            database=db_session,
            language="Pashto",
            files=[txt_file("هر غږ ارزښت لري.")],
        )

    assert sentence_count(db_session) == 0
    assert batch_count(db_session) == 0
    assert list((test_storage_root / "imports").glob("*")) == []


def test_import_batch_counters_equal_response(db_session: Session) -> None:
    result = import_txt_sentences(
        database=db_session,
        language="Pashto",
        files=[txt_file("لومړۍ جمله\nلومړۍ جمله\nab")],
    )
    batch = db_session.get(ImportBatch, result.batch_id)

    assert batch is not None
    assert batch.number_of_files == result.files_received
    assert batch.total_lines == result.total_lines
    assert batch.imported_phrases == result.imported
    assert batch.duplicate_phrases == result.duplicates
    assert batch.invalid_lines == result.invalid


def test_two_import_batches_keep_files_isolated(
    db_session: Session, test_storage_root: Path
) -> None:
    first_result = import_txt_sentences(
        database=db_session,
        language="Pashto",
        files=[txt_file("لومړۍ جمله")],
    )
    second_result = import_txt_sentences(
        database=db_session,
        language="Pashto",
        files=[txt_file("دويمه جمله")],
    )

    assert first_result.batch_id != second_result.batch_id
    assert (test_storage_root / "imports" / first_result.batch_id).is_dir()
    assert (test_storage_root / "imports" / second_result.batch_id).is_dir()
    assert len(list((test_storage_root / "imports" / first_result.batch_id).iterdir())) == 1
    assert len(list((test_storage_root / "imports" / second_result.batch_id).iterdir())) == 1
