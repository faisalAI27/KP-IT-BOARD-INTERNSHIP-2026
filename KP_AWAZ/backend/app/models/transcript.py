"""Versioned text associated with one voice recording."""

from datetime import datetime, timezone
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


if TYPE_CHECKING:
    from app.models.contribution import Contribution


class Transcript(Base):
    """Prompt references and future manual or ASR transcripts."""

    __tablename__ = "transcripts"
    __table_args__ = (
        CheckConstraint(
            "transcript_type IN "
            "('prompt_reference', 'manual', 'asr_generated', 'reviewed')",
            name="ck_transcript_type",
        ),
        CheckConstraint(
            "confidence IS NULL OR confidence BETWEEN 0 AND 1",
            name="ck_transcript_confidence",
        ),
        UniqueConstraint(
            "contribution_id",
            "transcript_type",
            name="uq_transcript_contribution_type",
        ),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    contribution_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("contributions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    transcript_type: Mapped[str] = mapped_column(String(30), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    language: Mapped[str] = mapped_column(String(100), nullable=False)
    source: Mapped[str] = mapped_column(String(50), nullable=False)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_verified: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
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
        onupdate=lambda: datetime.now(timezone.utc),
    )

    contribution: Mapped["Contribution"] = relationship(
        back_populates="transcripts"
    )
