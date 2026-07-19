"""Reviewable contributor requests to exclude owned recordings from exports."""

from datetime import datetime, timezone
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


if TYPE_CHECKING:
    from app.models.contribution import Contribution
    from app.models.profile import Profile


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class WithdrawalRequest(Base):
    """One owner-created, administrator-reviewable withdrawal request."""

    __tablename__ = "withdrawal_requests"
    __table_args__ = (
        CheckConstraint(
            "scope IN ('contribution', 'all')",
            name="ck_withdrawal_request_scope_valid",
        ),
        CheckConstraint(
            "status IN ('requested', 'approved', 'declined')",
            name="ck_withdrawal_request_status_valid",
        ),
        CheckConstraint(
            "(scope = 'contribution' AND contribution_id IS NOT NULL) OR "
            "(scope = 'all' AND contribution_id IS NULL)",
            name="ck_withdrawal_request_scope_target_valid",
        ),
        CheckConstraint(
            "reason IS NULL OR length(reason) <= 500",
            name="ck_withdrawal_request_reason_length",
        ),
        CheckConstraint(
            "resolution_reason IS NULL OR length(resolution_reason) <= 500",
            name="ck_withdrawal_resolution_reason_length",
        ),
        CheckConstraint(
            "(status = 'requested' AND resolved_at IS NULL) OR "
            "(status IN ('approved', 'declined') AND resolved_at IS NOT NULL)",
            name="ck_withdrawal_resolution_timestamp_valid",
        ),
        Index(
            "ix_withdrawal_requests_user_status_requested",
            "user_id",
            "status",
            "requested_at",
        ),
        Index(
            "ix_withdrawal_requests_status_requested",
            "status",
            "requested_at",
        ),
        Index(
            "uq_withdrawal_requested_contribution",
            "user_id",
            "contribution_id",
            unique=True,
            sqlite_where=text(
                "status = 'requested' AND scope = 'contribution'"
            ),
            postgresql_where=text(
                "status = 'requested' AND scope = 'contribution'"
            ),
        ),
        Index(
            "uq_withdrawal_requested_all",
            "user_id",
            unique=True,
            sqlite_where=text("status = 'requested' AND scope = 'all'"),
            postgresql_where=text("status = 'requested' AND scope = 'all'"),
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
    contribution_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("contributions.id"),
        nullable=True,
        index=True,
    )
    scope: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="requested", index=True
    )
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    resolution_reason: Mapped[str | None] = mapped_column(
        String(500), nullable=True
    )

    profile: Mapped["Profile"] = relationship(back_populates="withdrawal_requests")
    contribution: Mapped["Contribution | None"] = relationship(
        back_populates="withdrawal_requests"
    )
