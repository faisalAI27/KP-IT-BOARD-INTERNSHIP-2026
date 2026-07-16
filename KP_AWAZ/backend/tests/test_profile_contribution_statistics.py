"""Authenticated personal contribution statistics endpoint tests."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session

from app.main import app
from app.models import Profile
from app.routes import profiles
from app.services.contribution_statistics_service import (
    ContributionStatisticsQueryError,
    get_profile_contribution_statistics,
)
from tests.conftest import (
    TEST_AUTHORIZATION,
    TEST_USER_ID,
    authenticate_test_user,
    reject_test_access_token,
)
from tests.leaderboard_helpers import (
    add_approved_contributions,
    add_statistics_contribution,
    add_statistics_profile,
)


ENDPOINT = "/api/profile/me/statistics"
OTHER_USER_ID = "93cdf86e-2d29-4b4f-a665-90b25b9d5f31"
THIRD_USER_ID = "7d86fca3-a572-4a13-b5de-925c366194b2"
EXACT_FIELDS = {
    "totalContributions",
    "pendingContributions",
    "approvedContributions",
    "rejectedContributions",
    "leaderboardOptIn",
    "leaderboardEligible",
    "publicRank",
}


def get_statistics(client: TestClient, query: str = ""):
    return client.get(f"{ENDPOINT}{query}", headers=TEST_AUTHORIZATION)


def add_current_profile(
    database: Session,
    *,
    opt_in: bool,
    display_name: str = "Current Contributor",
) -> Profile:
    return add_statistics_profile(
        database,
        profile_id=TEST_USER_ID,
        display_name=display_name,
        leaderboard_opt_in=opt_in,
    )


def test_statistics_missing_token_returns_401(client: TestClient) -> None:
    response = client.get(ENDPOINT)

    assert response.status_code == 401
    assert response.json()["code"] == "AUTHENTICATION_REQUIRED"


def test_statistics_invalid_token_returns_401(client: TestClient) -> None:
    reject_test_access_token()

    response = get_statistics(client)

    assert response.status_code == 401
    assert response.json()["code"] == "INVALID_ACCESS_TOKEN"


def test_valid_user_receives_exact_zero_statistics(client: TestClient) -> None:
    authenticate_test_user()

    response = get_statistics(client)

    assert response.status_code == 200
    assert response.json() == {
        "totalContributions": 0,
        "pendingContributions": 0,
        "approvedContributions": 0,
        "rejectedContributions": 0,
        "leaderboardOptIn": False,
        "leaderboardEligible": False,
        "publicRank": None,
    }


def test_statistics_profile_is_created_automatically(
    client: TestClient,
    db_session: Session,
) -> None:
    authenticate_test_user()

    assert get_statistics(client).status_code == 200

    assert db_session.scalar(select(func.count()).select_from(Profile)) == 1
    assert db_session.get(Profile, TEST_USER_ID) is not None


def test_total_and_each_review_count_are_dynamic(
    client: TestClient,
    db_session: Session,
) -> None:
    add_current_profile(db_session, opt_in=True)
    for review_status in ["pending", "approved", "approved", "rejected"]:
        add_statistics_contribution(
            db_session,
            user_id=TEST_USER_ID,
            review_status=review_status,
        )
    authenticate_test_user()

    response = get_statistics(client)

    assert response.status_code == 200
    assert response.json()["totalContributions"] == 4
    assert response.json()["pendingContributions"] == 1
    assert response.json()["approvedContributions"] == 2
    assert response.json()["rejectedContributions"] == 1


def test_legacy_contributions_are_excluded_from_personal_counts(
    client: TestClient,
    db_session: Session,
) -> None:
    add_current_profile(db_session, opt_in=True)
    add_statistics_contribution(
        db_session,
        user_id=None,
        review_status="approved",
    )
    authenticate_test_user()

    response = get_statistics(client)

    assert response.json()["totalContributions"] == 0
    assert response.json()["approvedContributions"] == 0


def test_another_users_contributions_are_excluded(
    client: TestClient,
    db_session: Session,
) -> None:
    add_current_profile(db_session, opt_in=True)
    add_statistics_profile(
        db_session,
        profile_id=OTHER_USER_ID,
        display_name="Other Contributor",
        leaderboard_opt_in=True,
    )
    add_approved_contributions(db_session, user_id=OTHER_USER_ID, count=3)
    authenticate_test_user()

    response = get_statistics(client)

    assert response.json()["totalContributions"] == 0
    assert response.json()["approvedContributions"] == 0


@pytest.mark.parametrize("opt_in", [False, True])
def test_leaderboard_opt_in_reflects_saved_profile_preference(
    opt_in: bool,
    client: TestClient,
    db_session: Session,
) -> None:
    add_current_profile(db_session, opt_in=opt_in)
    authenticate_test_user()

    response = get_statistics(client)

    assert response.json()["leaderboardOptIn"] is opt_in


def test_opted_out_approved_profile_is_ineligible_with_null_rank(
    client: TestClient,
    db_session: Session,
) -> None:
    add_current_profile(db_session, opt_in=False)
    add_approved_contributions(db_session, user_id=TEST_USER_ID, count=2)
    authenticate_test_user()

    response = get_statistics(client)

    assert response.json()["approvedContributions"] == 2
    assert response.json()["leaderboardEligible"] is False
    assert response.json()["publicRank"] is None


def test_opted_in_zero_approved_profile_is_ineligible_with_null_rank(
    client: TestClient,
    db_session: Session,
) -> None:
    add_current_profile(db_session, opt_in=True)
    add_statistics_contribution(
        db_session,
        user_id=TEST_USER_ID,
        review_status="pending",
    )
    authenticate_test_user()

    response = get_statistics(client)

    assert response.json()["leaderboardEligible"] is False
    assert response.json()["publicRank"] is None


def test_eligible_profile_receives_same_dense_public_rank(
    client: TestClient,
    db_session: Session,
) -> None:
    add_current_profile(db_session, opt_in=True)
    add_statistics_profile(
        db_session,
        profile_id=OTHER_USER_ID,
        display_name="Top Contributor",
        leaderboard_opt_in=True,
    )
    add_statistics_profile(
        db_session,
        profile_id=THIRD_USER_ID,
        display_name="Tied Contributor",
        leaderboard_opt_in=True,
    )
    add_approved_contributions(db_session, user_id=OTHER_USER_ID, count=4)
    add_approved_contributions(db_session, user_id=TEST_USER_ID, count=2)
    add_approved_contributions(db_session, user_id=THIRD_USER_ID, count=2)
    authenticate_test_user()

    private_response = get_statistics(client)
    public_response = client.get("/api/leaderboard")

    assert private_response.json()["leaderboardEligible"] is True
    assert private_response.json()["publicRank"] == 2
    current_public = next(
        item
        for item in public_response.json()["items"]
        if item["displayName"] == "Current Contributor"
    )
    assert current_public["rank"] == private_response.json()["publicRank"]


def test_existing_profile_preferences_are_preserved_during_synchronization(
    client: TestClient,
    db_session: Session,
) -> None:
    add_statistics_profile(
        db_session,
        profile_id=TEST_USER_ID,
        display_name="Saved Name",
        leaderboard_opt_in=True,
        preferred_language="Hindko",
        email="old@example.com",
        provider="email",
    )
    authenticate_test_user(email="verified@example.com", provider="google")

    response = get_statistics(client)
    db_session.expire_all()
    profile = db_session.get(Profile, TEST_USER_ID)

    assert response.status_code == 200
    assert profile is not None
    assert profile.display_name == "Saved Name"
    assert profile.preferred_language == "Hindko"
    assert profile.leaderboard_opt_in is True
    assert profile.email == "verified@example.com"
    assert profile.auth_provider == "google"


def test_statistics_response_contains_exact_fields_and_no_private_identity(
    client: TestClient,
    db_session: Session,
) -> None:
    add_current_profile(db_session, opt_in=True)
    add_approved_contributions(db_session, user_id=TEST_USER_ID, count=1)
    authenticate_test_user()

    response = get_statistics(client)
    serialized = response.text.lower()

    assert response.status_code == 200
    assert set(response.json()) == EXACT_FIELDS
    for forbidden in [
        TEST_USER_ID.lower(),
        "person@example.com",
        "email",
        "authprovider",
        "access_token",
        "refresh_token",
        "audio",
    ]:
        assert forbidden not in serialized


def test_supplied_user_id_query_cannot_change_statistics_scope(
    client: TestClient,
    db_session: Session,
) -> None:
    add_current_profile(db_session, opt_in=False)
    add_statistics_profile(
        db_session,
        profile_id=OTHER_USER_ID,
        display_name="Other Contributor",
        leaderboard_opt_in=True,
    )
    add_approved_contributions(db_session, user_id=OTHER_USER_ID, count=2)
    authenticate_test_user()

    response = get_statistics(client, f"?userId={OTHER_USER_ID}")

    assert response.status_code == 200
    assert response.json()["totalContributions"] == 0
    assert response.json()["publicRank"] is None


def test_statistics_query_filters_ownership_in_sql(
    client: TestClient,
    db_session: Session,
) -> None:
    add_current_profile(db_session, opt_in=False)
    authenticate_test_user()
    statements: list[str] = []

    def capture(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: object,
    ) -> None:
        normalized = " ".join(statement.lower().split())
        if "from contributions" in normalized:
            statements.append(normalized)

    bind = db_session.get_bind()
    event.listen(bind, "before_cursor_execute", capture)
    try:
        response = get_statistics(client)
    finally:
        event.remove(bind, "before_cursor_execute", capture)

    assert response.status_code == 200
    assert len(statements) == 1
    assert "where contributions.user_id = ?" in statements[0]
    assert "sum(case when" in statements[0]


def test_statistics_database_failure_returns_safe_error(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    authenticate_test_user()

    def fail_safely(**_arguments: object):
        raise ContributionStatisticsQueryError() from RuntimeError(
            "sqlite:///private/database/path"
        )

    monkeypatch.setattr(
        profiles,
        "get_profile_contribution_statistics",
        fail_safely,
    )

    response = get_statistics(client)

    assert response.status_code == 500
    assert response.json() == {
        "message": "Contribution statistics could not be loaded.",
        "code": "CONTRIBUTION_STATISTICS_FAILED",
    }
    assert "sqlite" not in response.text.lower()


def test_statistics_service_converts_sqlalchemy_failure_to_safe_error(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    profile = add_current_profile(db_session, opt_in=True)

    def fail_query(*_arguments: object, **_keywords: object):
        from sqlalchemy.exc import SQLAlchemyError

        raise SQLAlchemyError("SELECT secret FROM private_table")

    monkeypatch.setattr(db_session, "execute", fail_query)

    with pytest.raises(ContributionStatisticsQueryError) as captured:
        get_profile_contribution_statistics(database=db_session, profile=profile)

    assert str(captured.value) == "Contribution statistics could not be loaded."
    assert "select" not in str(captured.value).lower()


def test_only_allowed_statistics_route_is_registered() -> None:
    statistics_routes = [
        route
        for route in app.routes
        if "statistics" in route.path
    ]

    assert [(route.path, route.methods) for route in statistics_routes] == [
        (ENDPOINT, {"GET"})
    ]
    for forbidden in [
        "/api/users/",
        "/api/profile/{user_id}",
        "/api/contributions/user/",
    ]:
        assert not any(route.path.startswith(forbidden) for route in app.routes)
