"""Authenticated containing-page leaderboard endpoint tests."""

from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.models import Profile
from app.routes import leaderboard
from app.services.contribution_statistics_service import (
    PersonalLeaderboardContextQueryError,
    get_personal_leaderboard_context,
)
from tests.conftest import (
    TEST_AUTHORIZATION,
    TEST_USER_ID,
    authenticate_test_user,
    reject_test_access_token,
)
from tests.leaderboard_helpers import (
    add_approved_contributions,
    add_statistics_profile,
)


ENDPOINT = "/api/leaderboard/me/context"
CONTEXT_FIELDS = {
    "leaderboardOptIn",
    "leaderboardEligible",
    "currentUser",
    "items",
    "total",
    "limit",
    "offset",
}
ITEM_FIELDS = {
    "rank",
    "displayName",
    "approvedContributions",
    "isCurrentUser",
}


def profile_id(index: int) -> str:
    """Return deterministic valid UUIDs without overlapping the test user."""

    return str(UUID(int=index + 100))


def add_profile(
    database: Session,
    *,
    user_id: str,
    name: str,
    opt_in: bool = True,
    approved: int = 1,
) -> None:
    add_statistics_profile(
        database,
        profile_id=user_id,
        display_name=name,
        leaderboard_opt_in=opt_in,
        email=f"private-{name.lower().replace(' ', '-')}@example.com",
    )
    add_approved_contributions(database, user_id=user_id, count=approved)


def test_context_requires_authentication(client: TestClient) -> None:
    response = client.get(ENDPOINT)

    assert response.status_code == 401
    assert response.json() == {
        "message": "Authentication is required.",
        "code": "AUTHENTICATION_REQUIRED",
    }


def test_context_rejects_an_invalid_access_token(client: TestClient) -> None:
    reject_test_access_token()

    response = client.get(ENDPOINT, headers=TEST_AUTHORIZATION)

    assert response.status_code == 401
    assert response.json()["code"] == "INVALID_ACCESS_TOKEN"


def test_context_returns_the_page_containing_the_verified_user(
    client: TestClient,
    db_session: Session,
) -> None:
    for index in range(25):
        user_id = TEST_USER_ID if index == 22 else profile_id(index)
        add_profile(
            db_session,
            user_id=user_id,
            name=f"Contributor {index:02d}",
        )
    authenticate_test_user(email="current@example.com", provider="email")

    response = client.get(ENDPOINT, headers=TEST_AUTHORIZATION)
    body = response.json()

    assert response.status_code == 200
    assert set(body) == CONTEXT_FIELDS
    assert body["leaderboardOptIn"] is True
    assert body["leaderboardEligible"] is True
    assert body["currentUser"] == {
        "rank": 1,
        "displayName": "Contributor 22",
        "approvedContributions": 1,
    }
    assert body["total"] == 25
    assert body["limit"] == 20
    assert body["offset"] == 20
    assert len(body["items"]) == 5
    assert sum(item["isCurrentUser"] for item in body["items"]) == 1
    assert next(item for item in body["items"] if item["isCurrentUser"])[
        "displayName"
    ] == "Contributor 22"
    assert all(set(item) == ITEM_FIELDS for item in body["items"])


def test_context_marks_duplicate_names_by_verified_identity(
    client: TestClient,
    db_session: Session,
) -> None:
    add_profile(
        db_session,
        user_id=TEST_USER_ID,
        name="Same Public Name",
    )
    add_profile(
        db_session,
        user_id=profile_id(1),
        name="Same Public Name",
    )
    authenticate_test_user(email="current@example.com")

    items = client.get(ENDPOINT, headers=TEST_AUTHORIZATION).json()["items"]

    assert [item["displayName"] for item in items] == [
        "Same Public Name",
        "Same Public Name",
    ]
    assert sum(item["isCurrentUser"] for item in items) == 1


def test_request_identity_parameters_cannot_select_another_user(
    client: TestClient,
    db_session: Session,
) -> None:
    add_profile(
        db_session,
        user_id=TEST_USER_ID,
        name="Verified Caller",
    )
    other_id = profile_id(4)
    add_profile(db_session, user_id=other_id, name="Other Account")
    authenticate_test_user(email="caller@example.com")

    body = client.get(
        f"{ENDPOINT}?userId={other_id}&profileId={other_id}",
        headers=TEST_AUTHORIZATION,
    ).json()

    assert body["currentUser"]["displayName"] == "Verified Caller"
    assert next(item for item in body["items"] if item["isCurrentUser"])[
        "displayName"
    ] == "Verified Caller"


def test_opted_out_context_is_private_and_reports_the_approved_count(
    client: TestClient,
    db_session: Session,
) -> None:
    add_profile(
        db_session,
        user_id=TEST_USER_ID,
        name="Private Contributor",
        opt_in=False,
        approved=3,
    )
    authenticate_test_user(email="private@example.com")

    response = client.get(ENDPOINT, headers=TEST_AUTHORIZATION)
    body = response.json()

    assert response.status_code == 200
    assert body["leaderboardOptIn"] is False
    assert body["leaderboardEligible"] is False
    assert body["currentUser"] == {
        "rank": None,
        "displayName": "Private Contributor",
        "approvedContributions": 3,
    }
    assert body["items"] == []
    assert body["total"] == 0
    assert body["offset"] == 0


def test_opted_in_user_without_approved_work_is_ineligible(
    client: TestClient,
    db_session: Session,
) -> None:
    add_profile(
        db_session,
        user_id=TEST_USER_ID,
        name="New Contributor",
        approved=0,
    )
    authenticate_test_user(email="new@example.com")

    body = client.get(ENDPOINT, headers=TEST_AUTHORIZATION).json()

    assert body["leaderboardOptIn"] is True
    assert body["leaderboardEligible"] is False
    assert body["currentUser"]["approvedContributions"] == 0
    assert body["currentUser"]["rank"] is None
    assert body["items"] == []


def test_context_reacts_to_review_and_visibility_changes_without_counters(
    client: TestClient,
    db_session: Session,
) -> None:
    add_statistics_profile(
        db_session,
        profile_id=TEST_USER_ID,
        display_name="Dynamic Contributor",
        leaderboard_opt_in=True,
    )
    contribution = add_approved_contributions(
        db_session,
        user_id=TEST_USER_ID,
        count=1,
    )[0]
    authenticate_test_user()

    assert client.get(
        ENDPOINT, headers=TEST_AUTHORIZATION
    ).json()["leaderboardEligible"] is True

    contribution.review_status = "rejected"
    db_session.commit()
    rejected = client.get(ENDPOINT, headers=TEST_AUTHORIZATION).json()
    assert rejected["leaderboardEligible"] is False
    assert rejected["currentUser"]["approvedContributions"] == 0

    contribution.review_status = "approved"
    profile = db_session.get(Profile, TEST_USER_ID)
    assert profile is not None
    profile.leaderboard_opt_in = False
    db_session.commit()
    opted_out = client.get(ENDPOINT, headers=TEST_AUTHORIZATION).json()
    assert opted_out["leaderboardEligible"] is False
    assert opted_out["currentUser"]["approvedContributions"] == 1


def test_context_never_exposes_ids_emails_tokens_or_audio_metadata(
    client: TestClient,
    db_session: Session,
) -> None:
    add_profile(
        db_session,
        user_id=TEST_USER_ID,
        name="Safe Public Name",
    )
    authenticate_test_user(email="secret-address@example.com")

    response = client.get(
        ENDPOINT,
        headers={"Authorization": "Bearer private-access-token"},
    )
    serialized = response.text.lower()

    assert response.status_code == 200
    for forbidden in [
        TEST_USER_ID.lower(),
        "secret-address@example.com",
        "private-access-token",
        "profileid",
        "userid",
        "email",
        "provider",
        "audio",
    ]:
        assert forbidden not in serialized


def test_context_limit_validation_is_bounded(client: TestClient) -> None:
    authenticate_test_user()

    assert client.get(
        f"{ENDPOINT}?limit=0", headers=TEST_AUTHORIZATION
    ).status_code == 422
    assert client.get(
        f"{ENDPOINT}?limit=101", headers=TEST_AUTHORIZATION
    ).status_code == 422


def test_context_query_failure_returns_only_the_safe_error(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    authenticate_test_user()

    def fail_query(**_kwargs: object) -> None:
        raise PersonalLeaderboardContextQueryError()

    monkeypatch.setattr(leaderboard, "get_personal_leaderboard_context", fail_query)

    response = client.get(ENDPOINT, headers=TEST_AUTHORIZATION)

    assert response.status_code == 500
    assert response.json() == {
        "message": "Your leaderboard position could not be loaded.",
        "code": "LEADERBOARD_CONTEXT_QUERY_FAILED",
    }
    assert "sql" not in response.text.lower()


def test_context_service_uses_a_bounded_number_of_sql_statements(
    db_session: Session,
) -> None:
    add_profile(
        db_session,
        user_id=TEST_USER_ID,
        name="Current Contributor",
    )
    for index in range(30):
        add_profile(
            db_session,
            user_id=profile_id(index),
            name=f"Other {index:02d}",
        )
    profile = db_session.get(Profile, TEST_USER_ID)
    assert profile is not None
    statements = 0

    def count_statement(*_args: object) -> None:
        nonlocal statements
        statements += 1

    event.listen(db_session.bind, "before_cursor_execute", count_statement)
    try:
        context = get_personal_leaderboard_context(
            database=db_session,
            profile=profile,
            limit=20,
        )
    finally:
        event.remove(db_session.bind, "before_cursor_execute", count_statement)

    assert context.leaderboard_eligible is True
    assert statements <= 3
