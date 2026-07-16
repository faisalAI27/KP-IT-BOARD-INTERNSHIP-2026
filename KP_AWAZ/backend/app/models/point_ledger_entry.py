"""Immutable point effects produced by contribution review transitions."""

from datetime import datetime, timezone
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    event,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


if TYPE_CHECKING:
    from app.models.contribution import Contribution
    from app.models.profile import Profile


POINT_ENTRY_TYPES = frozenset(
    {"approval_award", "approval_reversal", "approved_backfill"}
)


def utc_now() -> datetime:
    """Return one timezone-aware UTC ledger timestamp."""

    return datetime.now(timezone.utc)


class PointLedgerImmutabilityError(RuntimeError):
    """Prevent application ORM code from changing a persisted ledger event."""

    def __init__(self) -> None:
        super().__init__("Point ledger entries are append-only.")


class PointLedgerEntry(Base):
    """One append-only point award, reversal, or migration backfill."""

    __tablename__ = "point_ledger_entries"
    __table_args__ = (
        CheckConstraint(
            "review_revision >= 0",
            name="ck_point_ledger_review_revision_nonnegative",
        ),
        CheckConstraint(
            "entry_type IN "
            "('approval_award', 'approval_reversal', 'approved_backfill')",
            name="ck_point_ledger_entry_type_valid",
        ),
        CheckConstraint(
            "(entry_type = 'approval_reversal' AND points_delta = -1) OR "
            "(entry_type IN ('approval_award', 'approved_backfill') "
            "AND points_delta = 1)",
            name="ck_point_ledger_entry_delta_valid",
        ),
        CheckConstraint(
            "description IS NULL OR length(description) <= 255",
            name="ck_point_ledger_description_length",
        ),
        UniqueConstraint(
            "contribution_id",
            "review_revision",
            name="uq_point_ledger_contribution_revision",
        ),
        Index(
            "ix_point_ledger_user_created_id",
            "user_id",
            "created_at",
            "id",
        ),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("profiles.id"),
        nullable=False,
        index=True,
    )
    contribution_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("contributions.id"),
        nullable=False,
        index=True,
    )
    review_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    entry_type: Mapped[str] = mapped_column(String(30), nullable=False)
    points_delta: Mapped[int] = mapped_column(Integer, nullable=False)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
    )

    profile: Mapped["Profile"] = relationship(
        back_populates="point_ledger_entries",
        passive_deletes=True,
    )
    contribution: Mapped["Contribution"] = relationship(
        back_populates="point_ledger_entries",
        passive_deletes=True,
    )


@event.listens_for(PointLedgerEntry, "before_insert")
def normalize_point_ledger_entry(
    _mapper: object,
    _connection: object,
    entry: PointLedgerEntry,
) -> None:
    """Normalize internal event types without accepting external values."""

    if isinstance(entry.entry_type, str):
        entry.entry_type = entry.entry_type.strip().lower()
    if isinstance(entry.description, str):
        entry.description = entry.description.strip() or None


@event.listens_for(PointLedgerEntry, "before_update")
@event.listens_for(PointLedgerEntry, "before_delete")
def prevent_point_ledger_mutation(
    _mapper: object,
    _connection: object,
    _entry: PointLedgerEntry,
) -> None:
    """Reject ORM update and delete operations after ledger insertion."""

    raise PointLedgerImmutabilityError()
