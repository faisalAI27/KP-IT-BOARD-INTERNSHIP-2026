"""Persistent metadata for one sentence import operation."""

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import CheckConstraint, DateTime, Integer, String, event
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.utils.text_normalization import normalize_language_name


class ImportBatch(Base):
    """Summary and processing state for a future group of imported files."""

    __tablename__ = "import_batches"
    __table_args__ = (
        CheckConstraint(
            "number_of_files >= 0",
            name="ck_import_batch_number_of_files_non_negative",
        ),
        CheckConstraint(
            "total_lines >= 0",
            name="ck_import_batch_total_lines_non_negative",
        ),
        CheckConstraint(
            "imported_phrases >= 0",
            name="ck_import_batch_imported_phrases_non_negative",
        ),
        CheckConstraint(
            "duplicate_phrases >= 0",
            name="ck_import_batch_duplicate_phrases_non_negative",
        ),
        CheckConstraint(
            "invalid_lines >= 0",
            name="ck_import_batch_invalid_lines_non_negative",
        ),
        CheckConstraint(
            "status IN ('processing', 'completed', 'failed')",
            name="ck_import_batch_status_valid",
        ),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    language: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    number_of_files: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    total_lines: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    imported_phrases: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    duplicate_phrases: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    invalid_lines: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="processing"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )


@event.listens_for(ImportBatch, "before_insert")
@event.listens_for(ImportBatch, "before_update")
def normalize_import_batch_language(
    _mapper: object, _connection: object, import_batch: ImportBatch
) -> None:
    """Store language names in the same normalized form as sentences."""

    import_batch.language = normalize_language_name(import_batch.language)
