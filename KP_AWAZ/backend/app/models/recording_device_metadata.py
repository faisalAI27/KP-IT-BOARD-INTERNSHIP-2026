"""Privacy-minimized browser and capture metadata for one recording."""

from datetime import datetime, timezone
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


if TYPE_CHECKING:
    from app.models.contribution import Contribution


class RecordingDeviceMetadata(Base):
    """Coarse device context without stable identifiers or raw user-agent data."""

    __tablename__ = "recording_device_metadata"
    __table_args__ = (
        CheckConstraint(
            "metadata_version = 1",
            name="ck_recording_device_metadata_version",
        ),
        CheckConstraint(
            "device_category IN ('desktop', 'mobile', 'tablet', 'unknown')",
            name="ck_recording_device_category",
        ),
        CheckConstraint(
            "sample_rate_hz IS NULL OR "
            "sample_rate_hz BETWEEN 8000 AND 384000",
            name="ck_recording_device_sample_rate",
        ),
        CheckConstraint(
            "channel_count IS NULL OR channel_count BETWEEN 1 AND 32",
            name="ck_recording_device_channel_count",
        ),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    contribution_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("contributions.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    metadata_version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1
    )
    device_category: Mapped[str] = mapped_column(
        String(20), nullable=False, default="unknown"
    )
    platform_family: Mapped[str] = mapped_column(
        String(30), nullable=False, default="Unknown"
    )
    browser_family: Mapped[str] = mapped_column(
        String(30), nullable=False, default="Unknown"
    )
    capture_api: Mapped[str] = mapped_column(
        String(30), nullable=False, default="MediaRecorder"
    )
    sample_rate_hz: Mapped[int | None] = mapped_column(Integer, nullable=True)
    channel_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    echo_cancellation: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    noise_suppression: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    auto_gain_control: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    contribution: Mapped["Contribution"] = relationship(
        back_populates="device_metadata"
    )
