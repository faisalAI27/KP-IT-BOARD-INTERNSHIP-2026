"""Builders for isolated contribution statistics and leaderboard tests."""

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy.orm import Session

from app.models import Contribution, Profile


def add_statistics_profile(
    database: Session,
    *,
    profile_id: str,
    display_name: str,
    leaderboard_opt_in: bool,
    email: str | None = None,
    provider: str | None = "email",
    preferred_language: str = "Pashto",
) -> Profile:
    """Store one profile with explicit public-privacy preferences."""

    profile = Profile(
        id=profile_id,
        email=email or f"{profile_id[:8]}@example.com",
        auth_provider=provider,
        display_name=display_name,
        preferred_language=preferred_language,
        leaderboard_opt_in=leaderboard_opt_in,
    )
    database.add(profile)
    database.commit()
    return profile


def add_statistics_contribution(
    database: Session,
    *,
    user_id: str | None,
    review_status: str,
    contribution_id: str | None = None,
    audio_storage_key: str | None = None,
    original_filename: str = "private-recording.webm",
) -> Contribution:
    """Store one contribution without creating a real test audio file."""

    stored_id = contribution_id or str(uuid4())
    now = datetime.now(timezone.utc)
    contribution = Contribution(
        id=stored_id,
        user_id=user_id,
        contribution_type="guided",
        contributor_name="Private Contributor Metadata",
        language="Pashto",
        sentence_id=None,
        sentence_text="هر غږ ارزښت لري.",
        sentence_source="provided",
        topic=None,
        consent_given=True,
        audio_storage_key=audio_storage_key
        or f"audio/private/{stored_id}.webm",
        original_filename=original_filename,
        mime_type="audio/webm",
        file_size=128,
        duration_seconds=4.2,
        status="queued",
        review_status=review_status,
        reviewed_at=now if review_status != "pending" else None,
        rejection_reason="Needs correction" if review_status == "rejected" else None,
        created_at=now,
        updated_at=now,
    )
    database.add(contribution)
    database.commit()
    return contribution


def add_approved_contributions(
    database: Session,
    *,
    user_id: str,
    count: int,
) -> list[Contribution]:
    """Store a requested number of approved contributions for one profile."""

    return [
        add_statistics_contribution(
            database,
            user_id=user_id,
            review_status="approved",
        )
        for _ in range(count)
    ]
