"""Reusable builders for isolated point-ledger tests."""

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy.orm import Session

from app.models import Contribution, PointLedgerEntry, Profile
from tests.leaderboard_helpers import (
    add_statistics_contribution,
    add_statistics_profile,
)


def add_points_profile(
    database: Session,
    *,
    profile_id: str,
    display_name: str = "Points Contributor",
    leaderboard_opt_in: bool = True,
) -> Profile:
    return add_statistics_profile(
        database,
        profile_id=profile_id,
        display_name=display_name,
        leaderboard_opt_in=leaderboard_opt_in,
    )


def add_points_contribution(
    database: Session,
    *,
    user_id: str | None,
    review_status: str = "pending",
    review_revision: int = 0,
    contribution_id: str | None = None,
    audio_storage_key: str | None = None,
) -> Contribution:
    contribution = add_statistics_contribution(
        database,
        user_id=user_id,
        review_status=review_status,
        contribution_id=contribution_id,
        audio_storage_key=audio_storage_key,
    )
    contribution.review_revision = review_revision
    database.commit()
    return contribution


def add_point_entry(
    database: Session,
    *,
    user_id: str,
    contribution_id: str,
    review_revision: int,
    entry_type: str,
    points_delta: int,
    entry_id: str | None = None,
    created_at: datetime | None = None,
) -> PointLedgerEntry:
    entry = PointLedgerEntry(
        id=entry_id or str(uuid4()),
        user_id=user_id,
        contribution_id=contribution_id,
        review_revision=review_revision,
        entry_type=entry_type,
        points_delta=points_delta,
        created_at=created_at or datetime.now(timezone.utc),
    )
    database.add(entry)
    database.commit()
    return entry
