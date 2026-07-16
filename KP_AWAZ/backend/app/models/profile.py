"""Local application profile for one Supabase-authenticated user."""

from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


if TYPE_CHECKING:
    from app.models.contribution import Contribution
    from app.models.point_ledger_entry import PointLedgerEntry


def utc_now() -> datetime:
    """Return one timezone-aware UTC timestamp for profile persistence."""

    return datetime.now(timezone.utc)


class Profile(Base):
    """Preferences and synchronized identity fields for a verified user."""

    __tablename__ = "profiles"
    __table_args__ = (
        CheckConstraint(
            "length(trim(display_name)) BETWEEN 2 AND 80",
            name="ck_profile_display_name_length",
        ),
        CheckConstraint(
            "length(trim(preferred_language)) BETWEEN 1 AND 100",
            name="ck_profile_preferred_language_length",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    email: Mapped[str | None] = mapped_column(
        String(320), nullable=True, index=True
    )
    auth_provider: Mapped[str | None] = mapped_column(String(50), nullable=True)
    display_name: Mapped[str] = mapped_column(String(80), nullable=False)
    preferred_language: Mapped[str] = mapped_column(
        String(100), nullable=False, default="Pashto"
    )
    leaderboard_opt_in: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    last_login_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )

    contributions: Mapped[list["Contribution"]] = relationship(
        back_populates="profile",
        passive_deletes=True,
    )
    point_ledger_entries: Mapped[list["PointLedgerEntry"]] = relationship(
        back_populates="profile",
        passive_deletes=True,
    )
