"""Shared builders for isolated admin contribution review tests."""

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy.orm import Session

from app.config import settings
from app.models import Contribution, Profile
from app.services.audio_storage import save_audio_file


DEFAULT_CREATED_AT = datetime(2026, 7, 16, 10, 0, tzinfo=timezone.utc)
DEFAULT_AUDIO = b"\x1a\x45\xdf\xa3admin-review-webm"


def admin_headers() -> dict[str, str]:
    return {"X-Admin-Key": settings.admin_api_key}


def add_review_profile(
    database: Session,
    *,
    profile_id: str = "0d5dd8f5-93df-462b-b234-a16973089092",
    display_name: str = "Review Contributor",
) -> Profile:
    profile = Profile(
        id=profile_id,
        email="private@example.com",
        auth_provider="google",
        display_name=display_name,
    )
    database.add(profile)
    database.commit()
    return profile


def add_review_contribution(
    database: Session,
    *,
    contribution_id: str | None = None,
    user_id: str | None = None,
    contribution_type: str = "guided",
    review_status: str = "pending",
    reviewed_at: datetime | None = None,
    rejection_reason: str | None = None,
    created_at: datetime = DEFAULT_CREATED_AT,
    with_audio: bool = False,
    audio_storage_key: str | None = None,
    audio_content: bytes = DEFAULT_AUDIO,
    extension: str = "webm",
    mime_type: str = "audio/webm",
) -> Contribution:
    stored_id = contribution_id or str(uuid4())
    storage_key = audio_storage_key
    if storage_key is None and with_audio:
        storage_key = save_audio_file(
            contribution_id=stored_id,
            extension=extension,
            content=audio_content,
            created_at=created_at,
        )
    if storage_key is None:
        storage_key = (
            f"audio/{created_at.year:04d}/{created_at.month:02d}/"
            f"{created_at.day:02d}/{stored_id}.{extension}"
        )

    guided = contribution_type == "guided"
    contribution = Contribution(
        id=stored_id,
        user_id=user_id,
        contribution_type=contribution_type,
        contributor_name="Administrative Review Test",
        language="Pashto",
        sentence_id=None,
        sentence_text="هر غږ ارزښت لري." if guided else None,
        sentence_source="provided" if guided else None,
        topic=None if guided else "A village story",
        consent_given=True,
        audio_storage_key=storage_key,
        original_filename=f"recording.{extension}",
        mime_type=mime_type,
        file_size=len(audio_content),
        duration_seconds=7.4,
        status="queued",
        review_status=review_status,
        reviewed_at=reviewed_at,
        rejection_reason=rejection_reason,
        created_at=created_at,
        updated_at=created_at,
    )
    database.add(contribution)
    database.commit()
    return contribution
