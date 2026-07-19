"""Persistent sentence model."""

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    event,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.utils.text_normalization import (
    clean_sentence_text,
    normalize_language_name,
    normalize_sentence_text,
)


class Sentence(Base):
    """A language sentence that can be offered as a recording prompt."""

    __tablename__ = "sentences"
    __table_args__ = (
        UniqueConstraint(
            "language",
            "normalized_text",
            name="uq_sentence_language_normalized_text",
        ),
        CheckConstraint(
            "times_assigned >= 0",
            name="ck_sentence_times_assigned_nonnegative",
        ),
        Index(
            "ix_sentences_language_active_usage",
            "language",
            "is_active",
            "times_assigned",
        ),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    language: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    meaning: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    dialect: Mapped[str | None] = mapped_column(String(100), nullable=True)
    source: Mapped[str | None] = mapped_column(String(255), nullable=True)
    difficulty: Mapped[str | None] = mapped_column(String(50), nullable=True)
    normalized_text: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    source_type: Mapped[str] = mapped_column(String(50), nullable=False)
    source_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    times_assigned: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )


@event.listens_for(Sentence, "before_insert")
@event.listens_for(Sentence, "before_update")
def prepare_sentence_for_storage(
    _mapper: object, _connection: object, sentence: Sentence
) -> None:
    """Apply storage invariants before every sentence insert or update."""

    sentence.language = normalize_language_name(sentence.language)
    sentence.text = clean_sentence_text(sentence.text)
    sentence.normalized_text = normalize_sentence_text(sentence.text)
    for field_name in ("category", "dialect", "source", "difficulty"):
        value = getattr(sentence, field_name)
        setattr(
            sentence,
            field_name,
            value.strip() or None if isinstance(value, str) else None,
        )
