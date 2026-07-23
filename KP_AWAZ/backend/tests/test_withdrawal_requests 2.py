"""Ownership, privacy, persistence, and admin withdrawal workflow tests."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session
from fastapi.testclient import TestClient

from app.models import Contribution, WithdrawalRequest
from tests.conftest import (
    TEST_AUTHORIZATION,
    TEST_USER_ID,
    authenticate_test_user,
)
from tests.withdrawal_helpers import (
    OTHER_OWNER_ID,
    add_withdrawal_contribution,
    add_withdrawal_profile,
)
from tests.admin_contribution_review_helpers import admin_headers


OWNER_ENDPOINT = "/api/withdrawals/me"
ADMIN_ENDPOINT = "/api/admin/withdrawals"


def request_withdrawal(
    client: TestClient,
    payload: dict[str, object],
    *,
    headers: dict[str, str] | None = None,
):
    return client.post(
        OWNER_ENDPOINT,
        headers=TEST_AUTHORIZATION if headers is None else headers,
        json=payload,
    )


def prepare_owner(database: Session, user_id: str = TEST_USER_ID) -> Contribution:
    add_withdrawal_profile(database, user_id=user_id)
    return add_withdrawal_contribution(database, user_id=user_id)


def test_withdrawal_endpoints_require_authentication(client: TestClient) -> None:
    assert client.get(OWNER_ENDPOINT).status_code == 401
    response = request_withdrawal(
        client,
        {"scope": "all", "reason": "Please exclude my recordings."},
        headers={},
    )
    assert response.status_code == 401


def test_owner_can_request_one_contribution_without_deleting_source(
    client: TestClient,
    db_session: Session,
) -> None:
    contribution = prepare_owner(db_session)
    authenticate_test_user()
    original_storage_key = contribution.audio_storage_key

    response = request_withdrawal(
        client,
        {
            "scope": "contribution",
            "contributionId": contribution.id,
            "reason": "Please exclude this recording.",
        },
    )
    stored = db_session.scalar(select(WithdrawalRequest))

    assert response.status_code == 201
    assert response.json()["scope"] == "contribution"
    assert response.json()["status"] == "requested"
    assert response.json()["requestedAt"].endswith("Z")
    assert response.json()["resolvedAt"] is None
    assert "id" not in response.json()
    assert stored is not None
    assert stored.user_id == TEST_USER_ID
    assert stored.contribution_id == contribution.id
    assert db_session.get(Contribution, contribution.id).audio_storage_key == original_storage_key


def test_client_cannot_request_another_users_contribution(
    client: TestClient,
    db_session: Session,
) -> None:
    add_withdrawal_profile(db_session, user_id=TEST_USER_ID)
    add_withdrawal_profile(db_session, user_id=OTHER_OWNER_ID)
    other = add_withdrawal_contribution(db_session, user_id=OTHER_OWNER_ID)
    authenticate_test_user()

    response = request_withdrawal(
        client,
        {"scope": "contribution", "contributionId": other.id},
    )

    assert response.status_code == 404
    assert response.json()["code"] == "OWNED_CONTRIBUTION_NOT_FOUND"
    assert db_session.scalar(select(func.count()).select_from(WithdrawalRequest)) == 0


def test_client_supplied_owner_identity_is_rejected(
    client: TestClient,
    db_session: Session,
) -> None:
    contribution = prepare_owner(db_session)
    authenticate_test_user()

    response = request_withdrawal(
        client,
        {
            "scope": "contribution",
            "contributionId": contribution.id,
            "userId": OTHER_OWNER_ID,
        },
    )

    assert response.status_code == 422
    assert db_session.scalar(select(func.count()).select_from(WithdrawalRequest)) == 0


def test_owner_can_request_all_current_owned_contributions(
    client: TestClient,
    db_session: Session,
) -> None:
    prepare_owner(db_session)
    add_withdrawal_contribution(db_session, user_id=TEST_USER_ID)
    authenticate_test_user()

    response = request_withdrawal(
        client,
        {"scope": "all", "reason": "Please exclude all my current recordings."},
    )
    stored = db_session.scalar(select(WithdrawalRequest))

    assert response.status_code == 201
    assert response.json()["scope"] == "all"
    assert response.json()["contributionId"] is None
    assert stored is not None
    assert stored.user_id == TEST_USER_ID
    assert stored.contribution_id is None


def test_duplicate_active_request_returns_safe_conflict(
    client: TestClient,
    db_session: Session,
) -> None:
    contribution = prepare_owner(db_session)
    authenticate_test_user()
    payload = {"scope": "contribution", "contributionId": contribution.id}

    first = request_withdrawal(client, payload)
    duplicate = request_withdrawal(client, payload)

    assert first.status_code == 201
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "WITHDRAWAL_REQUEST_ALREADY_ACTIVE"
    assert db_session.scalar(select(func.count()).select_from(WithdrawalRequest)) == 1


def test_private_history_returns_effective_withdrawal_status(
    client: TestClient,
    db_session: Session,
) -> None:
    contribution = prepare_owner(db_session)
    authenticate_test_user()
    assert request_withdrawal(
        client,
        {"scope": "contribution", "contributionId": contribution.id},
    ).status_code == 201

    response = client.get(
        "/api/contributions/me",
        headers=TEST_AUTHORIZATION,
    )

    assert response.status_code == 200
    assert response.json()["items"][0]["withdrawalStatus"] == "requested"


def test_public_leaderboard_exposes_no_withdrawal_information(
    client: TestClient,
    db_session: Session,
) -> None:
    contribution = prepare_owner(db_session)
    profile = contribution.profile
    profile.leaderboard_opt_in = True
    db_session.commit()
    authenticate_test_user()
    assert request_withdrawal(
        client,
        {"scope": "contribution", "contributionId": contribution.id},
    ).status_code == 201

    response = client.get("/api/leaderboard")
    serialized = response.text.lower()

    assert response.status_code == 200
    assert "withdrawal" not in serialized
    assert "requested" not in serialized


def test_request_persists_across_sign_out_and_later_login(
    client: TestClient,
    db_session: Session,
) -> None:
    contribution = prepare_owner(db_session)
    authenticate_test_user()
    assert request_withdrawal(
        client,
        {"scope": "contribution", "contributionId": contribution.id},
    ).status_code == 201

    assert client.get(OWNER_ENDPOINT).status_code == 401
    authenticate_test_user()
    restored = client.get(OWNER_ENDPOINT, headers=TEST_AUTHORIZATION)

    assert restored.status_code == 200
    assert restored.json()["total"] == 1
    assert restored.json()["items"][0]["status"] == "requested"


def test_admin_can_approve_without_deleting_or_changing_review_score_state(
    client: TestClient,
    db_session: Session,
) -> None:
    contribution = prepare_owner(db_session)
    authenticate_test_user()
    score_before = client.get(
        "/api/profile/me/statistics", headers=TEST_AUTHORIZATION
    ).json()["approvedContributions"]
    created = request_withdrawal(
        client,
        {"scope": "contribution", "contributionId": contribution.id},
    )
    request_id = db_session.scalar(select(WithdrawalRequest.id))
    assert created.status_code == 201

    response = client.patch(
        f"{ADMIN_ENDPOINT}/{request_id}",
        headers=admin_headers(),
        json={"status": "approved", "resolutionReason": "Exclusion approved."},
    )
    db_session.refresh(contribution)
    score_after = client.get(
        "/api/profile/me/statistics", headers=TEST_AUTHORIZATION
    ).json()["approvedContributions"]

    assert response.status_code == 200
    assert response.json()["status"] == "approved"
    assert response.json()["resolvedAt"].endswith("Z")
    assert contribution.review_status == "approved"
    assert contribution.audio_storage_key
    assert db_session.get(WithdrawalRequest, request_id).status == "approved"
    assert score_before == score_after == 1


def test_admin_decline_requires_safe_reason_and_is_protected(
    client: TestClient,
    db_session: Session,
) -> None:
    contribution = prepare_owner(db_session)
    authenticate_test_user()
    request_withdrawal(
        client,
        {"scope": "contribution", "contributionId": contribution.id},
    )
    request_id = db_session.scalar(select(WithdrawalRequest.id))

    assert client.get(ADMIN_ENDPOINT).status_code == 401
    assert client.get(
        ADMIN_ENDPOINT,
        headers={"X-Admin-Key": "incorrect-withdrawal-admin-key"},
    ).status_code == 403
    missing_reason = client.patch(
        f"{ADMIN_ENDPOINT}/{request_id}",
        headers=admin_headers(),
        json={"status": "declined"},
    )
    declined = client.patch(
        f"{ADMIN_ENDPOINT}/{request_id}",
        headers=admin_headers(),
        json={"status": "declined", "resolutionReason": "Request could not be verified."},
    )

    assert missing_reason.status_code == 400
    assert missing_reason.json()["code"] == "WITHDRAWAL_RESOLUTION_REASON_REQUIRED"
    assert declined.status_code == 200
    assert declined.json()["status"] == "declined"


def test_admin_queue_returns_safe_request_metadata_only(
    client: TestClient,
    db_session: Session,
) -> None:
    contribution = prepare_owner(db_session)
    authenticate_test_user()
    request_withdrawal(
        client,
        {
            "scope": "contribution",
            "contributionId": contribution.id,
            "reason": "Please exclude this voice sample.",
        },
    )

    response = client.get(ADMIN_ENDPOINT, headers=admin_headers())
    item = response.json()["items"][0]

    assert response.status_code == 200
    assert set(item) == {
        "id",
        "scope",
        "status",
        "ownerDisplayName",
        "contributionSummary",
        "affectedContributionCount",
        "reason",
        "requestedAt",
        "resolvedAt",
        "resolutionReason",
    }
    for forbidden in [TEST_USER_ID, "@example.com", "audio/private", "admin_api_key"]:
        assert forbidden.lower() not in response.text.lower()
