"""Persistent model for contributor-submitted written text."""

from datetime import datetime, timezone
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.utils.text_normalization import normalize_language_name


if TYPE_CHECKING:
    from app.models.profile import Profile


class TextContribution(Base):
    """One pending manual sentence or uploaded text file."""

    __tablename__ = "text_contributions"
    __table_args__ = (
        CheckConstraint(
            "submission_method IN ('manual', 'file')",
            name="ck_text_contribution_submission_method",
        ),
        CheckConstraint(
            "text_type IN ('sentence', 'proverb', 'phrase', 'story_line', 'file_batch')",
            name="ck_text_contribution_type",
        ),
        CheckConstraint(
            "status IN ('queued', 'approved', 'rejected')",
            name="ck_text_contribution_status",
        ),
        CheckConstraint(
            "length(trim(text_content)) >= 1",
            name="ck_text_contribution_content",
        ),
        CheckConstraint(
            "rejection_reason IS NULL OR length(rejection_reason) <= 500",
            name="ck_text_contribution_rejection_reason_length",
        ),
        Index(
            "ix_text_contributions_user_status",
            "user_id",
            "status",
        ),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("profiles.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    contributor_name: Mapped[str] = mapped_column(String(100), nullable=False)
    language: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    submission_method: Mapped[str] = mapped_column(String(20), nullable=False)
    text_type: Mapped[str] = mapped_column(String(30), nullable=False)
    text_content: Mapped[str] = mapped_column(Text, nullable=False)
    original_filename: Mapped[str | None] = mapped_column(
        String(255), nullable=True
    )
    mime_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="queued", index=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    rejection_reason: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    profile: Mapped["Profile | None"] = relationship()

    def normalize_for_storage(self) -> None:
        """Apply the small set of storage invariants before persistence."""

        self.language = normalize_language_name(self.language)
        self.contributor_name = self.contributor_name.strip()
        self.text_content = self.text_content.strip()
