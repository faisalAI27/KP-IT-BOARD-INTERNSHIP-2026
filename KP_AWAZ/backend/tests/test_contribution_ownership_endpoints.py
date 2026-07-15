"""Authenticated ownership tests shared by both contribution upload routes."""

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Contribution, Profile
from tests.conftest import (
    TEST_AUTHORIZATION,
    TEST_USER_ID,
    authenticate_test_user,
    reject_test_access_token,
)


WEBM_BYTES = b"\x1a\x45\xdf\xa3ownership-webm"
OTHER_USER_ID = "93cdf86e-2d29-4b4f-a665-90b25b9d5f31"


def guided_data() -> dict[str, str]:
    return {
        "contributorName": "Faisal Imran",
        "language": "Pashto",
        "sentence": "هر غږ ارزښت لري.",
        "sentenceSource": "provided",
        "consent": "true",
    }


def open_data() -> dict[str, str]:
    return {
        "contributorName": "Faisal Imran",
        "language": "Pashto",
        "topic": "A village story",
        "consent": "true",
    }


RouteCase = tuple[str, Callable[[], dict[str, str]]]
ROUTES: list[RouteCase] = [
    ("/api/contributions/voice", guided_data),
    ("/api/contributions/open-recording", open_data),
]


def submit(
    client: TestClient,
    route: RouteCase,
    *,
    data: dict[str, str] | None = None,
    headers: dict[str, str] | None = None,
    content: bytes = WEBM_BYTES,
):
    path, data_factory = route
    return client.post(
        path,
        data=data_factory() if data is None else data,
        files={"audio": ("recording.webm", content, "audio/webm")},
        headers=headers,
    )


def contribution_count(database: Session) -> int:
    return database.scalar(select(func.count()).select_from(Contribution)) or 0


@pytest.mark.parametrize("route", ROUTES)
def test_missing_token_returns_safe_401(
    route: RouteCase,
    client: TestClient,
) -> None:
    response = submit(client, route)

    assert response.status_code == 401
    assert response.json()["code"] == "AUTHENTICATION_REQUIRED"


@pytest.mark.parametrize("route", ROUTES)
def test_invalid_token_returns_safe_401(
    route: RouteCase,
    client: TestClient,
) -> None:
    reject_test_access_token()

    response = submit(client, route, headers=TEST_AUTHORIZATION)

    assert response.status_code == 401
    assert response.json()["code"] == "INVALID_ACCESS_TOKEN"


@pytest.mark.parametrize("route", ROUTES)
def test_verified_user_creates_profile_and_owned_contribution(
    route: RouteCase,
    client: TestClient,
    db_session: Session,
) -> None:
    authenticate_test_user()

    response = submit(client, route, headers=TEST_AUTHORIZATION)
    contribution = db_session.get(Contribution, response.json()["id"])
    profile = db_session.get(Profile, TEST_USER_ID)

    assert response.status_code == 201
    assert profile is not None
    assert contribution is not None
    assert contribution.user_id == TEST_USER_ID
    assert contribution.profile is profile


@pytest.mark.parametrize("route", ROUTES)
def test_existing_profile_is_reused_without_replacing_preferences(
    route: RouteCase,
    client: TestClient,
    db_session: Session,
) -> None:
    profile = Profile(
        id=TEST_USER_ID,
        email="old@example.com",
        auth_provider="email",
        display_name="Saved Display Name",
        preferred_language="Hindko",
        leaderboard_opt_in=True,
    )
    db_session.add(profile)
    db_session.commit()
    authenticate_test_user(email="verified@example.com", provider="google")

    response = submit(client, route, headers=TEST_AUTHORIZATION)
    db_session.refresh(profile)

    assert response.status_code == 201
    assert db_session.scalar(select(func.count()).select_from(Profile)) == 1
    assert profile.email == "verified@example.com"
    assert profile.auth_provider == "google"
    assert profile.display_name == "Saved Display Name"
    assert profile.preferred_language == "Hindko"
    assert profile.leaderboard_opt_in is True


@pytest.mark.parametrize("route", ROUTES)
@pytest.mark.parametrize(
    "ownership_field",
    ["user_id", "userId", "profile_id", "profileId", "owner_id", "ownerId"],
)
def test_client_cannot_choose_contribution_owner(
    route: RouteCase,
    ownership_field: str,
    client: TestClient,
    db_session: Session,
) -> None:
    authenticate_test_user()
    data = route[1]()
    data[ownership_field] = OTHER_USER_ID

    response = submit(
        client,
        route,
        data=data,
        headers=TEST_AUTHORIZATION,
    )
    contribution = db_session.get(Contribution, response.json()["id"])

    assert response.status_code == 201
    assert contribution is not None
    assert contribution.user_id == TEST_USER_ID


@pytest.mark.parametrize("route", ROUTES)
def test_name_and_email_are_not_used_as_ownership(
    route: RouteCase,
    client: TestClient,
    db_session: Session,
) -> None:
    authenticate_test_user(email="verified@example.com")
    data = route[1]()
    data["contributorName"] = "another-owner@example.com"

    response = submit(
        client,
        route,
        data=data,
        headers=TEST_AUTHORIZATION,
    )
    contribution = db_session.get(Contribution, response.json()["id"])

    assert response.status_code == 201
    assert contribution is not None
    assert contribution.user_id == TEST_USER_ID
    assert contribution.user_id != contribution.contributor_name


@pytest.mark.parametrize("route", ROUTES)
def test_failed_submission_creates_no_contribution_ownership_row(
    route: RouteCase,
    client: TestClient,
    db_session: Session,
) -> None:
    authenticate_test_user()

    response = submit(
        client,
        route,
        headers=TEST_AUTHORIZATION,
        content=b"not-valid-webm",
    )

    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_AUDIO_SIGNATURE"
    assert contribution_count(db_session) == 0


@pytest.mark.parametrize("route", ROUTES)
def test_upload_response_exposes_no_owner_token_or_filesystem_path(
    route: RouteCase,
    client: TestClient,
) -> None:
    authenticate_test_user()

    response = submit(client, route, headers=TEST_AUTHORIZATION)
    serialized = response.text.lower()

    assert response.status_code == 201
    assert set(response.json()) == {"id", "status", "createdAt"}
    for forbidden in [
        TEST_USER_ID.lower(),
        "test-access-token",
        "user_id",
        "userId",
        "audio_storage_key",
        "storage/audio",
    ]:
        assert forbidden.lower() not in serialized
