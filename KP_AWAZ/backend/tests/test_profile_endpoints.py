"""Protected endpoint tests for the current user's local profile."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.dependencies import get_supabase_auth_client
from app.main import app
from app.models import Profile
from app.routes import profiles
from app.services.profile_service import ProfilePersistenceError
from app.services.supabase_auth import AuthenticatedUser, InvalidAccessTokenError
from tests.conftest import TEST_ADMIN_API_KEY


USER_ID = "0d5dd8f5-93df-462b-b234-a16973089092"
OTHER_USER_ID = "93cdf86e-2d29-4b4f-a665-90b25b9d5f31"
PUBLIC_FIELDS = {
    "id",
    "email",
    "authProvider",
    "displayName",
    "preferredLanguage",
    "leaderboardOptIn",
    "createdAt",
    "updatedAt",
    "lastLoginAt",
}


class StubAuthClient:
    def __init__(
        self,
        *,
        user: AuthenticatedUser | None = None,
        error: Exception | None = None,
    ) -> None:
        self.user = user
        self.error = error

    async def get_user(self, _access_token: str) -> AuthenticatedUser:
        if self.error is not None:
            raise self.error
        if self.user is None:
            raise AssertionError("A fake authenticated user is required")
        return self.user


def user(
    user_id: str = USER_ID,
    *,
    email: str | None = "person@example.com",
    provider: str | None = "google",
) -> AuthenticatedUser:
    return AuthenticatedUser(id=user_id, email=email, provider=provider)


def authenticate_as(authenticated_user: AuthenticatedUser) -> None:
    stub = StubAuthClient(user=authenticated_user)
    app.dependency_overrides[get_supabase_auth_client] = lambda: stub


def authorization() -> dict[str, str]:
    return {"Authorization": "Bearer test-access-token"}


def profile_count(database: Session) -> int:
    return database.scalar(select(func.count()).select_from(Profile)) or 0


def test_missing_token_returns_401(client: TestClient) -> None:
    response = client.get("/api/profile/me")

    assert response.status_code == 401
    assert response.json()["code"] == "AUTHENTICATION_REQUIRED"


def test_invalid_token_returns_401(client: TestClient) -> None:
    stub = StubAuthClient(error=InvalidAccessTokenError())
    app.dependency_overrides[get_supabase_auth_client] = lambda: stub

    response = client.get("/api/profile/me", headers=authorization())

    assert response.status_code == 401
    assert response.json()["code"] == "INVALID_ACCESS_TOKEN"


def test_first_authenticated_get_creates_and_returns_profile(
    client: TestClient,
    db_session: Session,
) -> None:
    authenticate_as(user())

    response = client.get("/api/profile/me", headers=authorization())

    assert response.status_code == 200
    assert response.json()["id"] == USER_ID
    assert response.json()["leaderboardOptIn"] is False
    assert profile_count(db_session) == 1


def test_get_response_uses_exact_public_camel_case_fields(
    client: TestClient,
) -> None:
    authenticate_as(user())

    response = client.get("/api/profile/me", headers=authorization())

    assert response.status_code == 200
    assert set(response.json()) == PUBLIC_FIELDS


def test_repeated_get_does_not_create_duplicates(
    client: TestClient,
    db_session: Session,
) -> None:
    authenticate_as(user())

    assert client.get("/api/profile/me", headers=authorization()).status_code == 200
    assert client.get("/api/profile/me", headers=authorization()).status_code == 200

    assert profile_count(db_session) == 1


def test_get_returns_only_verified_email_and_provider(client: TestClient) -> None:
    authenticate_as(user(email="Verified@Example.COM", provider="GOOGLE"))

    response = client.get("/api/profile/me", headers=authorization())

    assert response.json()["email"] == "verified@example.com"
    assert response.json()["authProvider"] == "google"


def test_get_response_contains_no_tokens_or_metadata(client: TestClient) -> None:
    authenticate_as(user())

    response = client.get("/api/profile/me", headers=authorization())
    serialized = response.text.lower()

    for forbidden in [
        "test-access-token",
        "access_token",
        "refresh_token",
        "provider_token",
        "app_metadata",
        "user_metadata",
    ]:
        assert forbidden not in serialized


def test_profile_persistence_failure_uses_safe_error_envelope(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    authenticate_as(user())

    def fail_safely(**_arguments: object) -> Profile:
        raise ProfilePersistenceError()

    monkeypatch.setattr(profiles, "get_or_create_profile", fail_safely)

    response = client.get("/api/profile/me", headers=authorization())

    assert response.status_code == 500
    assert response.json() == {
        "message": "The profile could not be saved. Please try again.",
        "code": "PROFILE_PERSISTENCE_FAILED",
    }


@pytest.mark.parametrize(
    ("payload", "field", "expected"),
    [
        ({"displayName": "Faisal Imran"}, "displayName", "Faisal Imran"),
        ({"displayName": "فیصل عمران"}, "displayName", "فیصل عمران"),
        ({"preferredLanguage": "  pASHTO  "}, "preferredLanguage", "Pashto"),
        ({"leaderboardOptIn": True}, "leaderboardOptIn", True),
        ({"leaderboardOptIn": False}, "leaderboardOptIn", False),
    ],
)
def test_patch_updates_each_editable_preference(
    payload: dict[str, object],
    field: str,
    expected: object,
    client: TestClient,
) -> None:
    authenticate_as(user())

    response = client.patch(
        "/api/profile/me",
        headers=authorization(),
        json=payload,
    )

    assert response.status_code == 200
    assert response.json()[field] == expected


@pytest.mark.parametrize(
    "payload",
    [
        {"displayName": " "},
        {"displayName": "x" * 81},
        {"preferredLanguage": "   "},
        {},
        {"unknownField": "value"},
        {"id": OTHER_USER_ID},
        {"email": "another@example.com"},
        {"authProvider": "email"},
        {"leaderboardOptIn": "true"},
    ],
)
def test_patch_rejects_invalid_or_identity_fields(
    payload: dict[str, object],
    client: TestClient,
) -> None:
    authenticate_as(user())

    response = client.patch(
        "/api/profile/me",
        headers=authorization(),
        json=payload,
    )

    assert response.status_code == 422


def test_one_user_cannot_edit_another_profile(
    client: TestClient,
    db_session: Session,
) -> None:
    authenticate_as(user())
    first_response = client.patch(
        "/api/profile/me",
        headers=authorization(),
        json={"displayName": "First User"},
    )
    assert first_response.status_code == 200

    authenticate_as(user(OTHER_USER_ID, email="other@example.com"))
    second_response = client.patch(
        "/api/profile/me",
        headers=authorization(),
        json={"displayName": "Second User"},
    )

    assert second_response.status_code == 200
    assert second_response.json()["id"] == OTHER_USER_ID
    assert db_session.get(Profile, USER_ID).display_name == "First User"
    assert db_session.get(Profile, OTHER_USER_ID).display_name == "Second User"


def test_patch_then_get_preserves_preferences(client: TestClient) -> None:
    authenticate_as(user())
    patch_response = client.patch(
        "/api/profile/me",
        headers=authorization(),
        json={
            "displayName": "Persistent Name",
            "preferredLanguage": "Hindko",
            "leaderboardOptIn": True,
        },
    )

    get_response = client.get("/api/profile/me", headers=authorization())

    assert patch_response.status_code == get_response.status_code == 200
    assert get_response.json()["displayName"] == "Persistent Name"
    assert get_response.json()["preferredLanguage"] == "Hindko"
    assert get_response.json()["leaderboardOptIn"] is True


def test_auth_me_still_works(client: TestClient) -> None:
    authenticate_as(user())

    response = client.get("/api/auth/me", headers=authorization())

    assert response.status_code == 200
    assert response.json()["id"] == USER_ID


def test_contribution_endpoints_remain_public(client: TestClient) -> None:
    for path in [
        "/api/contributions/voice",
        "/api/contributions/open-recording",
    ]:
        response = client.post(path)
        assert response.status_code == 422
        assert response.json().get("code") != "AUTHENTICATION_REQUIRED"


def test_admin_endpoints_still_use_admin_key(client: TestClient) -> None:
    assert client.get("/api/admin/health").status_code == 401
    response = client.get(
        "/api/admin/health",
        headers={"X-Admin-Key": TEST_ADMIN_API_KEY},
    )
    assert response.status_code == 200


def test_only_current_user_profile_routes_are_registered() -> None:
    profile_routes = [
        (route.path, route.methods)
        for route in app.routes
        if route.path.startswith("/api/profile")
    ]

    assert len(profile_routes) == 2
    assert {path for path, _methods in profile_routes} == {"/api/profile/me"}
    methods = {method for _path, route_methods in profile_routes for method in route_methods}
    assert methods == {"GET", "PATCH"}
    assert not any(route.path.startswith("/api/leaderboard") for route in app.routes)
