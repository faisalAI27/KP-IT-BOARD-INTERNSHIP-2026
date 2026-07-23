"""Protected contribution approval and rejection endpoint tests."""

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models import Contribution
from app.services.admin_contribution_review_service import (
    ContributionReviewPersistenceError,
    InvalidRejectionReasonError,
    apply_contribution_review,
)
from app.services.audio_storage import resolve_audio_storage_path
from tests.admin_contribution_review_helpers import (
    add_review_contribution,
    add_review_profile,
    admin_headers,
)


BASE_ENDPOINT = "/api/admin/contributions"


def review_url(contribution_id: str) -> str:
    return f"{BASE_ENDPOINT}/{contribution_id}/review"


def patch_review(
    client: TestClient,
    contribution_id: str,
    payload: dict[str, object],
):
    return client.patch(
        review_url(contribution_id),
        headers=admin_headers(),
        json=payload,
    )


def test_missing_admin_key_is_rejected(
    client: TestClient,
    db_session: Session,
) -> None:
    contribution = add_review_contribution(db_session)

    response = client.patch(review_url(contribution.id), json={"status": "approved"})

    assert response.status_code == 401


def test_invalid_admin_key_is_rejected(
    client: TestClient,
    db_session: Session,
) -> None:
    contribution = add_review_contribution(db_session)

    response = client.patch(
        review_url(contribution.id),
        headers={"X-Admin-Key": "wrong-key"},
        json={"status": "approved"},
    )

    assert response.status_code == 403


def test_pending_contribution_can_be_approved(
    client: TestClient,
    db_session: Session,
) -> None:
    contribution = add_review_contribution(db_session)

    response = patch_review(client, contribution.id, {"status": "approved"})
    db_session.expire_all()
    stored = db_session.get(Contribution, contribution.id)

    assert response.status_code == 200
    assert response.json()["reviewStatus"] == "approved"
    assert response.json()["reviewedAt"].endswith("Z")
    assert response.json()["rejectionReason"] is None
    assert stored is not None
    assert stored.review_status == "approved"
    assert stored.reviewed_at is not None


def test_pending_contribution_can_be_rejected_with_trimmed_reason(
    client: TestClient,
    db_session: Session,
) -> None:
    contribution = add_review_contribution(db_session)

    response = patch_review(
        client,
        contribution.id,
        {"status": "rejected", "rejectionReason": "  Audio is too noisy.  "},
    )
    db_session.expire_all()
    stored = db_session.get(Contribution, contribution.id)

    assert response.status_code == 200
    assert response.json()["reviewStatus"] == "rejected"
    assert response.json()["rejectionReason"] == "Audio is too noisy."
    assert stored is not None
    assert stored.rejection_reason == "Audio is too noisy."


def test_rejection_requires_reason(
    client: TestClient,
    db_session: Session,
) -> None:
    contribution = add_review_contribution(db_session)

    response = patch_review(client, contribution.id, {"status": "rejected"})

    assert response.status_code == 400
    assert response.json()["code"] == "REJECTION_REASON_REQUIRED"


@pytest.mark.parametrize("reason", ["", "   "])
def test_blank_rejection_reason_is_rejected(
    reason: str,
    client: TestClient,
    db_session: Session,
) -> None:
    contribution = add_review_contribution(db_session)

    response = patch_review(
        client,
        contribution.id,
        {"status": "rejected", "rejectionReason": reason},
    )

    assert response.status_code == 400
    assert response.json()["code"] == "REJECTION_REASON_REQUIRED"


def test_long_rejection_reason_is_rejected(
    client: TestClient,
    db_session: Session,
) -> None:
    contribution = add_review_contribution(db_session)

    response = patch_review(
        client,
        contribution.id,
        {"status": "rejected", "rejectionReason": "x" * 501},
    )

    assert response.status_code == 422


def test_approval_clears_old_rejection_reason(
    client: TestClient,
    db_session: Session,
) -> None:
    contribution = add_review_contribution(
        db_session,
        review_status="rejected",
        reviewed_at=datetime(2026, 7, 15, tzinfo=timezone.utc),
        rejection_reason="Old reason",
    )

    response = patch_review(
        client,
        contribution.id,
        {"status": "approved", "rejectionReason": "must be ignored"},
    )

    assert response.status_code == 200
    assert response.json()["reviewStatus"] == "approved"
    assert response.json()["rejectionReason"] is None


def test_rejected_can_become_approved_and_timestamp_updates(
    client: TestClient,
    db_session: Session,
) -> None:
    old_timestamp = datetime(2020, 1, 1, tzinfo=timezone.utc)
    contribution = add_review_contribution(
        db_session,
        review_status="rejected",
        reviewed_at=old_timestamp,
        rejection_reason="Old reason",
    )

    response = patch_review(client, contribution.id, {"status": "approved"})

    assert response.status_code == 200
    assert response.json()["reviewStatus"] == "approved"
    assert response.json()["reviewedAt"] != old_timestamp.isoformat()


def test_approved_can_become_rejected_and_timestamp_updates(
    client: TestClient,
    db_session: Session,
) -> None:
    old_timestamp = datetime(2020, 1, 1, tzinfo=timezone.utc)
    contribution = add_review_contribution(
        db_session,
        review_status="approved",
        reviewed_at=old_timestamp,
    )

    response = patch_review(
        client,
        contribution.id,
        {"status": "rejected", "rejectionReason": "Wrong sentence"},
    )

    assert response.status_code == 200
    assert response.json()["reviewStatus"] == "rejected"
    assert response.json()["reviewedAt"] != old_timestamp.isoformat()
    assert response.json()["rejectionReason"] == "Wrong sentence"


def test_same_decision_is_idempotent_and_keeps_timestamp(
    client: TestClient,
    db_session: Session,
) -> None:
    reviewed_at = datetime(2026, 7, 15, 8, 0, tzinfo=timezone.utc)
    contribution = add_review_contribution(
        db_session,
        review_status="approved",
        reviewed_at=reviewed_at,
    )

    response = patch_review(client, contribution.id, {"status": "approved"})

    assert response.status_code == 200
    assert response.json()["reviewedAt"] == "2026-07-15T08:00:00Z"


def test_review_preserves_ownership_audio_and_all_submission_metadata(
    client: TestClient,
    db_session: Session,
) -> None:
    profile = add_review_profile(db_session)
    contribution = add_review_contribution(
        db_session,
        user_id=profile.id,
        with_audio=True,
    )
    original = (
        contribution.user_id,
        contribution.audio_storage_key,
        contribution.original_filename,
        contribution.mime_type,
        contribution.file_size,
        contribution.contribution_type,
        contribution.sentence_text,
    )
    audio_path = resolve_audio_storage_path(contribution.audio_storage_key)
    original_audio = audio_path.read_bytes()

    response = patch_review(
        client,
        contribution.id,
        {"status": "rejected", "rejectionReason": "Too noisy"},
    )
    db_session.expire_all()
    stored = db_session.get(Contribution, contribution.id)

    assert response.status_code == 200
    assert stored is not None
    assert (
        stored.user_id,
        stored.audio_storage_key,
        stored.original_filename,
        stored.mime_type,
        stored.file_size,
        stored.contribution_type,
        stored.sentence_text,
    ) == original
    assert audio_path.read_bytes() == original_audio


def test_missing_contribution_returns_404(client: TestClient) -> None:
    response = patch_review(client, str(uuid4()), {"status": "approved"})

    assert response.status_code == 404
    assert response.json()["code"] == "CONTRIBUTION_NOT_FOUND"


def test_pending_status_cannot_be_submitted(
    client: TestClient,
    db_session: Session,
) -> None:
    contribution = add_review_contribution(db_session)

    response = patch_review(client, contribution.id, {"status": "pending"})

    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_REVIEW_STATUS"


@pytest.mark.parametrize(
    "field",
    ["reviewedAt", "reviewerId", "userId", "audioPath", "adminKey"],
)
def test_unknown_or_server_controlled_fields_are_rejected(
    field: str,
    client: TestClient,
    db_session: Session,
) -> None:
    contribution = add_review_contribution(db_session)

    response = patch_review(
        client,
        contribution.id,
        {"status": "approved", field: "client-controlled-value"},
    )

    assert response.status_code == 422
    assert "client-controlled-value" not in response.text


def test_database_failure_rolls_back_and_uses_safe_error(
    monkeypatch: pytest.MonkeyPatch,
    db_session: Session,
) -> None:
    contribution = add_review_contribution(db_session)

    def fail_commit() -> None:
        raise SQLAlchemyError("private SQL detail")

    monkeypatch.setattr(db_session, "commit", fail_commit)
    with pytest.raises(ContributionReviewPersistenceError) as captured:
        apply_contribution_review(
            database=db_session,
            contribution_id=contribution.id,
            review_status="approved",
            rejection_reason=None,
        )

    assert "private SQL detail" not in str(captured.value)
    stored = db_session.get(Contribution, contribution.id)
    assert stored is not None
    assert stored.review_status == "pending"
    assert stored.reviewed_at is None


def test_service_rejects_overlong_reason_with_safe_error(
    db_session: Session,
) -> None:
    contribution = add_review_contribution(db_session)

    with pytest.raises(InvalidRejectionReasonError) as captured:
        apply_contribution_review(
            database=db_session,
            contribution_id=contribution.id,
            review_status="rejected",
            rejection_reason="private" * 100,
        )

    assert "private" not in str(captured.value)
