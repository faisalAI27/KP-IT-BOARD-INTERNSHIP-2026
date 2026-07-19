"""Isolated builders for withdrawal and export-eligibility tests."""

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy.orm import Session

from app.consent import CONSENT_POLICY_VERSION
from app.models import Contribution, Profile, WithdrawalRequest


DEFAULT_OWNER_ID = "0d5dd8f5-93df-462b-b234-a16973089092"
OTHER_OWNER_ID = "93cdf86e-2d29-4b4f-a665-90b25b9d5f31"
DEFAULT_CREATED_AT = datetime(2026, 7, 18, 9, 0, tzinfo=timezone.utc)


def add_withdrawal_profile(
    database: Session,
    *,
    user_id: str = DEFAULT_OWNER_ID,
    display_name: str = "Safe Contributor",
) -> Profile:
    profile = Profile(
        id=user_id,
        email=f"{user_id[:8]}@example.com",
        auth_provider="email",
        display_name=display_name,
    )
    database.add(profile)
    database.commit()
    return profile


def add_withdrawal_contribution(
    database: Session,
    *,
    user_id: str = DEFAULT_OWNER_ID,
    contribution_id: str | None = None,
    created_at: datetime = DEFAULT_CREATED_AT,
    review_status: str = "approved",
    structured_consent: bool = True,
) -> Contribution:
    stored_id = contribution_id or str(uuid4())
    contribution = Contribution(
        id=stored_id,
        user_id=user_id,
        contribution_type="guided",
        contributor_name="Withdrawal Test",
        language="Pashto",
        sentence_text="هر غږ ارزښت لري.",
        sentence_source="provided",
        consent_given=True,
        consent_policy_version=(
            CONSENT_POLICY_VERSION if structured_consent else None
        ),
        consent_timestamp=created_at if structured_consent else None,
        audio_storage_key=f"audio/private/{stored_id}.webm",
        original_filename="recording.webm",
        mime_type="audio/webm",
        file_size=128,
        status="queued",
        review_status=review_status,
        reviewed_at=created_at if review_status == "approved" else None,
        created_at=created_at,
        updated_at=created_at,
    )
    database.add(contribution)
    database.commit()
    return contribution


def add_withdrawal_request(
    database: Session,
    *,
    user_id: str = DEFAULT_OWNER_ID,
    contribution_id: str | None = None,
    scope: str = "contribution",
    status: str = "requested",
    requested_at: datetime = DEFAULT_CREATED_AT,
    reason: str | None = None,
    resolution_reason: str | None = None,
) -> WithdrawalRequest:
    resolved_at = requested_at if status in {"approved", "declined"} else None
    request = WithdrawalRequest(
        user_id=user_id,
        contribution_id=contribution_id if scope == "contribution" else None,
        scope=scope,
        status=status,
        reason=reason,
        requested_at=requested_at,
        resolved_at=resolved_at,
        resolution_reason=resolution_reason,
    )
    database.add(request)
    database.commit()
    return request
