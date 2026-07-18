"""Endpoint tests for the Supabase-authenticated current-user route."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.dependencies import get_supabase_auth_client
from app.main import app
from app.models import Profile
from app.services.supabase_auth import (
    AuthenticatedUser,
    AuthNotConfiguredError,
    AuthServiceUnavailableError,
    InvalidAccessTokenError,
    InvalidAuthResponseError,
)
from tests.conftest import TEST_ADMIN_API_KEY


VALID_USER_ID = "0d5dd8f5-93df-462b-b234-a16973089092"


class StubAuthClient:
    """Network-free endpoint dependency returning one result or safe error."""

    def __init__(
        self,
        *,
        user: AuthenticatedUser | None = None,
        error: Exception | None = None,
    ) -> None:
        self.user = user
        self.error = error
        self.tokens: list[str] = []

    async def get_user(self, access_token: str) -> AuthenticatedUser:
        self.tokens.append(access_token)
        if self.error is not None:
            raise self.error
        if self.user is None:
            raise AssertionError("StubAuthClient requires a user or error")
        return self.user


def override_auth_client(stub: StubAuthClient) -> None:
    app.dependency_overrides[get_supabase_auth_client] = lambda: stub


def test_missing_authorization_header_returns_safe_401(client: TestClient) -> None:
    response = client.get("/api/auth/me")

    assert response.status_code == 401
    assert response.json() == {
        "message": "Authentication is required.",
        "code": "AUTHENTICATION_REQUIRED",
    }


def test_basic_authentication_scheme_returns_safe_401(client: TestClient) -> None:
    response = client.get(
        "/api/auth/me",
        headers={"Authorization": "Basic abc123"},
    )

    assert response.status_code == 401
    assert response.json()["code"] == "AUTHENTICATION_REQUIRED"


def test_blank_bearer_token_returns_safe_401(client: TestClient) -> None:
    response = client.get(
        "/api/auth/me",
        headers={"Authorization": "Bearer "},
    )

    assert response.status_code == 401
    assert response.json()["code"] == "AUTHENTICATION_REQUIRED"


@pytest.mark.parametrize("scenario", ["invalid", "expired"])
def test_invalid_or_expired_access_token_returns_401(
    client: TestClient,
    scenario: str,
) -> None:
    stub = StubAuthClient(error=InvalidAccessTokenError())
    override_auth_client(stub)

    response = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {scenario}-token"},
    )

    assert response.status_code == 401
    assert response.json()["code"] == "INVALID_ACCESS_TOKEN"
    assert response.json()["message"] == "The access token is invalid or expired."


def test_missing_supabase_configuration_returns_503(client: TestClient) -> None:
    override_auth_client(StubAuthClient(error=AuthNotConfiguredError()))

    response = client.get(
        "/api/auth/me",
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 503
    assert response.json()["code"] == "AUTH_NOT_CONFIGURED"


def test_supabase_timeout_returns_503(client: TestClient) -> None:
    override_auth_client(StubAuthClient(error=AuthServiceUnavailableError()))

    response = client.get(
        "/api/auth/me",
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 503
    assert response.json()["code"] == "AUTH_SERVICE_UNAVAILABLE"


def test_malformed_supabase_response_returns_503(client: TestClient) -> None:
    override_auth_client(StubAuthClient(error=InvalidAuthResponseError()))

    response = client.get(
        "/api/auth/me",
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 503
    assert response.json()["code"] == "INVALID_AUTH_RESPONSE"


def test_valid_google_user_returns_only_safe_fields(client: TestClient) -> None:
    stub = StubAuthClient(
        user=AuthenticatedUser(
            id=VALID_USER_ID,
            email="person@example.com",
            provider="google",
            display_name="Verified Display Name",
        )
    )
    override_auth_client(stub)

    response = client.get(
        "/api/auth/me",
        headers={"Authorization": "Bearer private-access-token"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "id": VALID_USER_ID,
        "email": "person@example.com",
        "provider": "google",
    }
    assert set(response.json()) == {"id", "email", "provider"}
    serialized_response = response.text.lower()
    for forbidden_value in [
        "private-access-token",
        "refresh_token",
        "app_metadata",
        "user_metadata",
    ]:
        assert forbidden_value not in serialized_response
    assert stub.tokens == ["private-access-token"]


def test_auth_me_creates_one_profile_without_duplicates(
    client: TestClient,
    db_session: Session,
) -> None:
    override_auth_client(
        StubAuthClient(
            user=AuthenticatedUser(
                id=VALID_USER_ID,
                email="person@example.com",
                provider="google",
                display_name="Verified Display Name",
            )
        )
    )
    headers = {"Authorization": "Bearer private-access-token"}

    assert client.get("/api/auth/me", headers=headers).status_code == 200
    assert client.get("/api/auth/me", headers=headers).status_code == 200

    db_session.expire_all()
    assert db_session.scalar(select(func.count()).select_from(Profile)) == 1
    profile = db_session.get(Profile, VALID_USER_ID)
    assert profile is not None
    assert profile.display_name == "Verified Display Name"


def test_valid_email_user_returns_200(client: TestClient) -> None:
    override_auth_client(
        StubAuthClient(
            user=AuthenticatedUser(
                id=VALID_USER_ID,
                email="person@example.com",
                provider="email",
            )
        )
    )

    response = client.get(
        "/api/auth/me",
        headers={"Authorization": "Bearer email-access-token"},
    )

    assert response.status_code == 200
    assert response.json()["provider"] == "email"


def test_existing_health_and_sentence_routes_remain_public(
    client: TestClient,
) -> None:
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/sentences").status_code == 200


def test_contribution_routes_require_authentication(
    client: TestClient,
) -> None:
    guided_response = client.post("/api/contributions/voice")
    open_response = client.post("/api/contributions/open-recording")

    assert guided_response.status_code == 401
    assert open_response.status_code == 401
    assert guided_response.json()["code"] == "AUTHENTICATION_REQUIRED"
    assert open_response.json()["code"] == "AUTHENTICATION_REQUIRED"


def test_admin_routes_continue_using_admin_api_key(client: TestClient) -> None:
    assert client.get("/api/admin/health").status_code == 401
    assert (
        client.get(
            "/api/admin/health",
            headers={"X-Admin-Key": TEST_ADMIN_API_KEY},
        ).status_code
        == 200
    )
    assert client.post("/api/admin/sentences/import").status_code == 401


def test_auth_me_is_registered_once() -> None:
    registered_paths = [route.path for route in app.routes]

    assert registered_paths.count("/api/auth/me") == 1
