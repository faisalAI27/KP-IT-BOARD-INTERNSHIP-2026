"""Protected phrase import, management, statistics, and export services."""

from __future__ import annotations

import csv
import io
import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from sqlalchemy import case, func, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Contribution, Sentence
from app.utils.file_safety import extract_safe_display_filename
from app.utils.text_normalization import (
    clean_sentence_text,
    normalize_language_name,
    normalize_sentence_text,
)


DEFAULT_PHRASE_LANGUAGE = "Pashto"
SUPPORTED_IMPORT_EXTENSIONS = frozenset({".csv", ".json", ".txt"})
TRUE_ACTIVE_VALUES = frozenset({"true", "1", "yes", "on"})
FALSE_ACTIVE_VALUES = frozenset({"false", "0", "no", "off"})
EXPORT_FIELDS = (
    "phrase_reference",
    "text",
    "language",
    "category",
    "dialect",
    "source",
    "difficulty",
    "active",
    "created_at",
)


class PhraseServiceError(RuntimeError):
    code = "PHRASE_SERVICE_ERROR"
    default_message = "The phrase request could not be completed."
    http_status = 400

    def __init__(self, message: str | None = None) -> None:
        self.message = message or self.default_message
        super().__init__(self.message)


class PhraseImportError(PhraseServiceError):
    code = "PHRASE_IMPORT_FAILED"
    default_message = "The phrase file could not be imported. Check its format and try again."


class EmptyPhraseFileError(PhraseServiceError):
    code = "EMPTY_PHRASE_FILE"
    default_message = "The selected file does not contain any usable phrases."


class PhraseFileTooLargeError(PhraseServiceError):
    code = "PHRASE_FILE_TOO_LARGE"
    default_message = "The phrase file exceeds the configured size limit."
    http_status = 413


class PhraseQueryError(PhraseServiceError):
    code = "PHRASE_QUERY_FAILED"
    default_message = "The phrase collection could not be loaded. Please try again."
    http_status = 500


class PhraseUpdateError(PhraseServiceError):
    code = "PHRASE_UPDATE_FAILED"
    default_message = "The phrase could not be updated. Please try again."
    http_status = 500


class PhraseNotFoundError(PhraseServiceError):
    code = "PHRASE_NOT_FOUND"
    default_message = "The requested phrase was not found."
    http_status = 404


class DuplicatePhraseError(PhraseServiceError):
    code = "DUPLICATE_PHRASE"
    default_message = "A phrase with the same text and language already exists."
    http_status = 409


class InvalidPhraseError(PhraseServiceError):
    code = "INVALID_PHRASE"
    default_message = "The phrase contains invalid or unsupported values."


class PhraseExportError(PhraseServiceError):
    code = "PHRASE_EXPORT_FAILED"
    default_message = "The phrase collection could not be exported. Please try again."
    http_status = 500


@dataclass(frozen=True, slots=True)
class PhraseCandidate:
    text: str
    normalized_text: str
    language: str
    category: str | None
    dialect: str | None
    source: str | None
    difficulty: str | None
    active: bool


@dataclass(frozen=True, slots=True)
class PhraseImportSummary:
    received: int
    created: int
    duplicates: int
    invalid: int


@dataclass(frozen=True, slots=True)
class PhraseAdminRecord:
    phrase: Sentence
    recordings_submitted: int
    pending_count: int
    approved_count: int
    rejected_count: int


@dataclass(frozen=True, slots=True)
class PhraseExportDocument:
    content: bytes
    media_type: str
    filename: str


def _optional_text(value: object, *, maximum_length: int) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError
    cleaned = value.strip()
    if not cleaned:
        return None
    if len(cleaned) > maximum_length:
        raise ValueError
    return cleaned


def _active_value(value: object) -> bool:
    if value is None or value == "":
        return True
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and not isinstance(value, bool) and value in {0, 1}:
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if not normalized:
            return True
        if normalized in TRUE_ACTIVE_VALUES:
            return True
        if normalized in FALSE_ACTIVE_VALUES:
            return False
    raise ValueError


def _candidate_from_mapping(values: dict[str, object]) -> PhraseCandidate:
    text_value = values.get("text")
    if not isinstance(text_value, str):
        raise ValueError
    text = clean_sentence_text(text_value)
    if not (
        settings.min_imported_sentence_length
        <= len(text)
        <= settings.max_imported_sentence_length
    ):
        raise ValueError

    language_value = values.get("language")
    if language_value is None or (
        isinstance(language_value, str) and not language_value.strip()
    ):
        language_value = DEFAULT_PHRASE_LANGUAGE
    if not isinstance(language_value, str):
        raise ValueError
    language = normalize_language_name(language_value)
    if len(language) > 100:
        raise ValueError

    return PhraseCandidate(
        text=text,
        normalized_text=normalize_sentence_text(text),
        language=language,
        category=_optional_text(values.get("category"), maximum_length=100),
        dialect=_optional_text(values.get("dialect"), maximum_length=100),
        source=_optional_text(values.get("source"), maximum_length=255),
        difficulty=_optional_text(values.get("difficulty"), maximum_length=50),
        active=_active_value(values.get("active")),
    )


def _decode_utf8(content: bytes) -> str:
    try:
        return content.decode("utf-8-sig", errors="strict")
    except UnicodeDecodeError as error:
        raise PhraseImportError() from error


def _parse_text(content: str) -> tuple[int, list[PhraseCandidate], int]:
    candidates: list[PhraseCandidate] = []
    invalid = 0
    received = 0
    for line in content.splitlines():
        if not line.strip():
            continue
        received += 1
        try:
            candidates.append(_candidate_from_mapping({"text": line}))
        except (TypeError, ValueError):
            invalid += 1
    return received, candidates, invalid


def _normalized_csv_row(row: dict[object, object]) -> dict[str, object]:
    return {
        str(key).strip().lower(): value
        for key, value in row.items()
        if isinstance(key, str)
    }


def _parse_csv(content: str) -> tuple[int, list[PhraseCandidate], int]:
    try:
        reader = csv.DictReader(io.StringIO(content, newline=""))
        fieldnames = {
            field.strip().lower()
            for field in (reader.fieldnames or [])
            if isinstance(field, str)
        }
        if "text" not in fieldnames:
            raise PhraseImportError()
        rows = list(reader)
    except (csv.Error, UnicodeError) as error:
        raise PhraseImportError() from error

    candidates: list[PhraseCandidate] = []
    invalid = 0
    received = 0
    for row in rows:
        normalized_row = _normalized_csv_row(row)
        if not any(
            isinstance(value, str) and value.strip()
            for value in normalized_row.values()
        ):
            continue
        received += 1
        try:
            candidates.append(_candidate_from_mapping(normalized_row))
        except (TypeError, ValueError):
            invalid += 1
    return received, candidates, invalid


def _parse_json(content: str) -> tuple[int, list[PhraseCandidate], int]:
    try:
        payload = json.loads(content)
    except (json.JSONDecodeError, UnicodeError) as error:
        raise PhraseImportError() from error
    if not isinstance(payload, list):
        raise PhraseImportError()

    candidates: list[PhraseCandidate] = []
    invalid = 0
    for item in payload:
        if not isinstance(item, dict):
            invalid += 1
            continue
        normalized_item = {
            str(key).strip().lower(): value
            for key, value in item.items()
            if isinstance(key, str)
        }
        try:
            candidates.append(_candidate_from_mapping(normalized_item))
        except (TypeError, ValueError):
            invalid += 1
    return len(payload), candidates, invalid


def _existing_duplicate_keys(
    database: Session,
    candidates: list[PhraseCandidate],
) -> set[tuple[str, str]]:
    by_language: dict[str, set[str]] = defaultdict(set)
    for candidate in candidates:
        by_language[candidate.language].add(candidate.normalized_text)

    existing: set[tuple[str, str]] = set()
    for language, normalized_texts in by_language.items():
        rows = database.execute(
            select(Sentence.language, Sentence.normalized_text).where(
                func.lower(Sentence.language) == language.lower(),
                Sentence.normalized_text.in_(normalized_texts),
            )
        ).all()
        existing.update((stored_language.lower(), text) for stored_language, text in rows)
    return existing


def import_phrase_file(
    *,
    database: Session,
    filename: str,
    content: bytes,
) -> PhraseImportSummary:
    """Parse one supported file and atomically add only new sentence rows."""

    try:
        display_filename = extract_safe_display_filename(filename)
    except Exception as error:
        raise PhraseImportError() from error
    extension = Path(display_filename).suffix.lower()
    if extension not in SUPPORTED_IMPORT_EXTENSIONS:
        raise PhraseImportError()
    maximum_size = int(settings.max_import_file_size_mb * 1024 * 1024)
    if len(content) > maximum_size:
        raise PhraseFileTooLargeError()
    if not content:
        raise EmptyPhraseFileError()

    decoded = _decode_utf8(content)
    if not decoded.strip():
        raise EmptyPhraseFileError()
    if extension == ".txt":
        received, candidates, invalid = _parse_text(decoded)
    elif extension == ".csv":
        received, candidates, invalid = _parse_csv(decoded)
    else:
        received, candidates, invalid = _parse_json(decoded)
    if received == 0:
        raise EmptyPhraseFileError()

    try:
        existing = _existing_duplicate_keys(database, candidates)
        seen: set[tuple[str, str]] = set()
        sentences: list[Sentence] = []
        duplicates = 0
        source_type = f"{extension.removeprefix('.')}_phrase_import"
        for candidate in candidates:
            key = (candidate.language.lower(), candidate.normalized_text)
            if key in existing or key in seen:
                duplicates += 1
                continue
            seen.add(key)
            sentences.append(
                Sentence(
                    language=candidate.language,
                    text=candidate.text,
                    meaning=None,
                    category=candidate.category,
                    dialect=candidate.dialect,
                    source=candidate.source,
                    difficulty=candidate.difficulty,
                    normalized_text=candidate.normalized_text,
                    source_type=source_type,
                    source_filename=display_filename,
                    is_active=candidate.active,
                    times_assigned=0,
                )
            )
        database.add_all(sentences)
        database.commit()
        return PhraseImportSummary(
            received=received,
            created=len(sentences),
            duplicates=duplicates,
            invalid=invalid,
        )
    except PhraseServiceError:
        database.rollback()
        raise
    except (IntegrityError, SQLAlchemyError, ValueError) as error:
        database.rollback()
        raise PhraseImportError() from error


def _usage_subquery():
    return (
        select(
            Contribution.sentence_id.label("sentence_id"),
            func.count(Contribution.id).label("recordings_submitted"),
            func.sum(case((Contribution.review_status == "pending", 1), else_=0)).label(
                "pending_count"
            ),
            func.sum(case((Contribution.review_status == "approved", 1), else_=0)).label(
                "approved_count"
            ),
            func.sum(case((Contribution.review_status == "rejected", 1), else_=0)).label(
                "rejected_count"
            ),
        )
        .where(Contribution.sentence_id.is_not(None))
        .group_by(Contribution.sentence_id)
        .subquery()
    )


def _phrase_filters(
    *,
    search: str | None,
    language: str | None,
    active: bool | None,
) -> list[object]:
    filters: list[object] = []
    if search is not None and search.strip():
        filters.append(Sentence.text.contains(search.strip()))
    if language is not None and language.strip():
        normalized_language = normalize_language_name(language)
        filters.append(func.lower(Sentence.language) == normalized_language.lower())
    if active is not None:
        filters.append(Sentence.is_active.is_(active))
    return filters


def list_admin_phrases(
    *,
    database: Session,
    limit: int,
    offset: int,
    search: str | None = None,
    language: str | None = None,
    active: bool | None = None,
    order: str = "newest",
) -> tuple[list[PhraseAdminRecord], int, str]:
    normalized_order = order.strip().lower() if isinstance(order, str) else ""
    if normalized_order not in {"newest", "oldest"}:
        raise InvalidPhraseError("Phrase order must be newest or oldest.")
    try:
        filters = _phrase_filters(search=search, language=language, active=active)
        usage = _usage_subquery()
        ordering = (
            (Sentence.created_at.desc(), Sentence.id.desc())
            if normalized_order == "newest"
            else (Sentence.created_at.asc(), Sentence.id.asc())
        )
        statement = (
            select(
                Sentence,
                func.coalesce(usage.c.recordings_submitted, 0),
                func.coalesce(usage.c.pending_count, 0),
                func.coalesce(usage.c.approved_count, 0),
                func.coalesce(usage.c.rejected_count, 0),
            )
            .outerjoin(usage, usage.c.sentence_id == Sentence.id)
            .where(*filters)
            .order_by(*ordering)
            .limit(limit)
            .offset(offset)
        )
        rows = database.execute(statement).all()
        total = database.scalar(
            select(func.count()).select_from(Sentence).where(*filters)
        ) or 0
    except (SQLAlchemyError, TypeError, ValueError) as error:
        database.rollback()
        raise PhraseQueryError() from error
    return (
        [
            PhraseAdminRecord(
                phrase=row[0],
                recordings_submitted=int(row[1]),
                pending_count=int(row[2]),
                approved_count=int(row[3]),
                rejected_count=int(row[4]),
            )
            for row in rows
        ],
        int(total),
        normalized_order,
    )


def _canonical_phrase_id(phrase_id: str) -> str:
    try:
        return str(UUID(phrase_id.strip()))
    except (AttributeError, TypeError, ValueError) as error:
        raise PhraseNotFoundError() from error


def _record_for_phrase(database: Session, phrase_id: str) -> PhraseAdminRecord:
    usage = _usage_subquery()
    row = database.execute(
        select(
            Sentence,
            func.coalesce(usage.c.recordings_submitted, 0),
            func.coalesce(usage.c.pending_count, 0),
            func.coalesce(usage.c.approved_count, 0),
            func.coalesce(usage.c.rejected_count, 0),
        )
        .outerjoin(usage, usage.c.sentence_id == Sentence.id)
        .where(Sentence.id == phrase_id)
    ).one_or_none()
    if row is None:
        raise PhraseNotFoundError()
    return PhraseAdminRecord(
        phrase=row[0],
        recordings_submitted=int(row[1]),
        pending_count=int(row[2]),
        approved_count=int(row[3]),
        rejected_count=int(row[4]),
    )


def update_phrase(
    *,
    database: Session,
    phrase_id: str,
    updates: dict[str, object],
) -> PhraseAdminRecord:
    canonical_id = _canonical_phrase_id(phrase_id)
    phrase = database.get(Sentence, canonical_id)
    if phrase is None:
        raise PhraseNotFoundError()
    try:
        next_text = phrase.text
        if "text" in updates:
            supplied_text = updates["text"]
            if not isinstance(supplied_text, str):
                raise InvalidPhraseError()
            next_text = clean_sentence_text(supplied_text)
            if not (
                settings.min_imported_sentence_length
                <= len(next_text)
                <= settings.max_imported_sentence_length
            ):
                raise InvalidPhraseError()

        next_language = phrase.language
        if "language" in updates:
            supplied_language = updates["language"]
            if not isinstance(supplied_language, str):
                raise InvalidPhraseError()
            next_language = normalize_language_name(supplied_language)
            if len(next_language) > 100:
                raise InvalidPhraseError()

        next_normalized_text = normalize_sentence_text(next_text)
        duplicate_id = database.scalar(
            select(Sentence.id).where(
                Sentence.id != phrase.id,
                func.lower(Sentence.language) == next_language.lower(),
                Sentence.normalized_text == next_normalized_text,
            )
        )
        if duplicate_id is not None:
            raise DuplicatePhraseError()

        phrase.text = next_text
        phrase.language = next_language
        phrase.normalized_text = next_normalized_text
        for field_name, maximum_length in (
            ("category", 100),
            ("dialect", 100),
            ("source", 255),
            ("difficulty", 50),
        ):
            if field_name in updates:
                setattr(
                    phrase,
                    field_name,
                    _optional_text(updates[field_name], maximum_length=maximum_length),
                )
        if "active" in updates:
            if not isinstance(updates["active"], bool):
                raise InvalidPhraseError()
            phrase.is_active = updates["active"]
        phrase.updated_at = datetime.now(timezone.utc)
        database.commit()
        database.refresh(phrase)
        return _record_for_phrase(database, canonical_id)
    except PhraseServiceError:
        database.rollback()
        raise
    except IntegrityError as error:
        database.rollback()
        raise DuplicatePhraseError() from error
    except (SQLAlchemyError, TypeError, ValueError) as error:
        database.rollback()
        raise PhraseUpdateError() from error


def _utc_iso(value: datetime) -> str:
    if value.tzinfo is None or value.utcoffset() is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat().replace("+00:00", "Z")


def export_phrase_collection(
    *,
    database: Session,
    export_format: str,
    active_only: bool,
) -> PhraseExportDocument:
    normalized_format = export_format.strip().lower()
    if normalized_format not in {"csv", "json"}:
        raise PhraseExportError()
    try:
        statement = select(Sentence)
        if active_only:
            statement = statement.where(Sentence.is_active.is_(True))
        phrases = list(
            database.scalars(
                statement.order_by(Sentence.created_at.asc(), Sentence.id.asc())
            ).all()
        )
        rows = [
            {
                "phrase_reference": phrase.id,
                "text": phrase.text,
                "language": phrase.language,
                "category": phrase.category,
                "dialect": phrase.dialect,
                "source": phrase.source,
                "difficulty": phrase.difficulty,
                "active": phrase.is_active,
                "created_at": _utc_iso(phrase.created_at),
            }
            for phrase in phrases
        ]
        date_stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
        filename = f"kp_awaz_pashto_phrases_{date_stamp}.{normalized_format}"
        if normalized_format == "json":
            content = (
                json.dumps(rows, ensure_ascii=False, indent=2) + "\n"
            ).encode("utf-8")
            return PhraseExportDocument(content, "application/json", filename)

        destination = io.StringIO(newline="")
        writer = csv.DictWriter(
            destination,
            fieldnames=EXPORT_FIELDS,
            lineterminator="\n",
        )
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {
                    **row,
                    "active": "true" if row["active"] else "false",
                }
            )
        return PhraseExportDocument(
            destination.getvalue().encode("utf-8"),
            "text/csv",
            filename,
        )
    except PhraseServiceError:
        raise
    except (SQLAlchemyError, csv.Error, OSError, TypeError, ValueError) as error:
        database.rollback()
        raise PhraseExportError() from error
