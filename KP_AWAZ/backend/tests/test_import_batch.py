"""Database tests for import batch metadata and constraints."""

from datetime import timedelta
from uuid import UUID

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import ImportBatch


COUNTER_FIELDS = (
    "number_of_files",
    "total_lines",
    "imported_phrases",
    "duplicate_phrases",
    "invalid_lines",
)


def store_batch(database: Session, **values: object) -> ImportBatch:
    """Persist one import batch with sensible test defaults."""

    language = values.pop("language", "Pashto")
    import_batch = ImportBatch(language=language, **values)
    database.add(import_batch)
    database.commit()
    return import_batch


def test_create_import_batch(db_session: Session) -> None:
    import_batch = store_batch(
        db_session,
        status="processing",
        number_of_files=2,
        total_lines=50,
        imported_phrases=40,
        duplicate_phrases=7,
        invalid_lines=3,
    )

    stored_batch = db_session.get(ImportBatch, import_batch.id)

    assert stored_batch is not None
    assert stored_batch.language == "Pashto"
    assert stored_batch.status == "processing"
    assert stored_batch.number_of_files == 2
    assert stored_batch.total_lines == 50
    assert stored_batch.imported_phrases == 40
    assert stored_batch.duplicate_phrases == 7
    assert stored_batch.invalid_lines == 3


def test_counters_default_to_zero(db_session: Session) -> None:
    import_batch = store_batch(db_session)

    assert all(getattr(import_batch, field) == 0 for field in COUNTER_FIELDS)


def test_status_defaults_to_processing(db_session: Session) -> None:
    import_batch = store_batch(db_session)

    assert import_batch.status == "processing"


def test_id_is_a_valid_uuid_string(db_session: Session) -> None:
    import_batch = store_batch(db_session)

    assert str(UUID(import_batch.id)) == import_batch.id


def test_created_at_is_populated_with_utc_timestamp(db_session: Session) -> None:
    import_batch = store_batch(db_session)

    assert import_batch.created_at is not None
    assert import_batch.created_at.utcoffset() == timedelta(0)


@pytest.mark.parametrize("batch_status", ["completed", "failed"])
def test_supported_terminal_statuses(
    batch_status: str, db_session: Session
) -> None:
    import_batch = store_batch(db_session, status=batch_status)

    assert import_batch.status == batch_status


def test_invalid_status_fails_database_constraint(db_session: Session) -> None:
    db_session.add(ImportBatch(language="Pashto", status="unsupported"))

    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()

    assert db_session.scalar(select(func.count()).select_from(ImportBatch)) == 0


@pytest.mark.parametrize("counter_field", COUNTER_FIELDS)
def test_negative_counter_fails_database_constraint(
    counter_field: str, db_session: Session
) -> None:
    db_session.add(ImportBatch(language="Pashto", **{counter_field: -1}))

    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()

    assert db_session.scalar(select(func.count()).select_from(ImportBatch)) == 0


def test_language_uses_sentence_normalization(db_session: Session) -> None:
    import_batch = store_batch(db_session, language="  pASHTO  ")

    assert import_batch.language == "Pashto"
