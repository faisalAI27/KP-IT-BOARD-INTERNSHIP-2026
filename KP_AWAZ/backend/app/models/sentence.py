"""Persistent sentence model."""

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, String, Text, UniqueConstraint, event
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
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    language: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    meaning: Mapped[str | None] = mapped_column(Text, nullable=True)
    normalized_text: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    source_type: Mapped[str] = mapped_column(String(50), nullable=False)
    source_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
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
