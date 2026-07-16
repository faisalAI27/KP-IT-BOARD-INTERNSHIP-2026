"""Persistent model for a submitted voice contribution."""

from datetime import datetime, timezone
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    event,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.utils.text_normalization import normalize_language_name


if TYPE_CHECKING:
    from app.models.profile import Profile
    from app.models.sentence import Sentence


class Contribution(Base):
    """Audio contribution metadata with an optional sentence relationship."""

    __tablename__ = "contributions"
    __table_args__ = (
        CheckConstraint(
            "contribution_type IN ('guided', 'open_recording')",
            name="ck_contribution_type_valid",
        ),
        CheckConstraint(
            "sentence_source IS NULL OR sentence_source IN ('provided', 'custom')",
            name="ck_contribution_sentence_source_valid",
        ),
        CheckConstraint(
            "file_size > 0",
            name="ck_contribution_file_size_positive",
        ),
        CheckConstraint(
            "duration_seconds IS NULL OR duration_seconds >= 0",
            name="ck_contribution_duration_non_negative",
        ),
        CheckConstraint(
            "status IN ('queued', 'approved', 'rejected', 'needs_review')",
            name="ck_contribution_status_valid",
        ),
        CheckConstraint(
            "review_status IN ('pending', 'approved', 'rejected')",
            name="ck_contribution_review_status_valid",
        ),
        CheckConstraint(
            "rejection_reason IS NULL OR length(rejection_reason) <= 500",
            name="ck_contribution_rejection_reason_length",
        ),
        Index(
            "ix_contributions_review_status_user_id",
            "review_status",
            "user_id",
        ),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    contribution_type: Mapped[str] = mapped_column(String(30), nullable=False)
    contributor_name: Mapped[str] = mapped_column(String(100), nullable=False)
    language: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("profiles.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    sentence_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("sentences.id", ondelete="SET NULL"),
        nullable=True,
    )
    sentence_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    sentence_source: Mapped[str | None] = mapped_column(String(20), nullable=True)
    topic: Mapped[str | None] = mapped_column(String(200), nullable=True)
    consent_given: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    audio_storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(
        String(30), nullable=False, default="queued"
    )
    review_status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", index=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    rejection_reason: Mapped[str | None] = mapped_column(
        String(500), nullable=True
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

    sentence: Mapped["Sentence | None"] = relationship()
    profile: Mapped["Profile | None"] = relationship(
        back_populates="contributions",
        passive_deletes=True,
    )


@event.listens_for(Contribution, "before_insert")
@event.listens_for(Contribution, "before_update")
def normalize_contribution_language(
    _mapper: object, _connection: object, contribution: Contribution
) -> None:
    """Store contribution language names consistently with sentences."""

    contribution.language = normalize_language_name(contribution.language)
    review_status = contribution.review_status
    contribution.review_status = (
        review_status.strip().lower()
        if isinstance(review_status, str) and review_status.strip()
        else "pending"
    )
    rejection_reason = contribution.rejection_reason
    if isinstance(rejection_reason, str):
        rejection_reason = rejection_reason.strip() or None
    contribution.rejection_reason = (
        rejection_reason if contribution.review_status == "rejected" else None
    )
