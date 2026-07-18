"""Targeted tests for the privacy-minimal account-status endpoint."""

from fastapi.testclient import TestClient

from app.dependencies import (
    get_account_status_rate_limiter,
    get_supabase_admin_client,
)
from app.main import app
from app.services.account_status_rate_limit import AccountStatusRateLimiter
from app.services.supabase_auth import AccountStatusUnavailableError


class StubAdminClient:
    def __init__(self, result: bool = False, error: Exception | None = None) -> None:
        self.result = result
        self.error = error
        self.emails: list[str] = []

    async def account_exists(self, email: str) -> bool:
        self.emails.append(email)
        if self.error is not None:
            raise self.error
        return self.result


class AllowingLimiter:
    def __init__(self) -> None:
        self.clients: list[str] = []

    def check(self, client_key: str) -> None:
        self.clients.append(client_key)


def configure_account_status(stub: StubAdminClient, limiter=None) -> None:
    app.dependency_overrides[get_supabase_admin_client] = lambda: stub
    app.dependency_overrides[get_account_status_rate_limiter] = (
        lambda: limiter or AllowingLimiter()
    )


def test_existing_email_returns_only_account_exists_true(client: TestClient) -> None:
    stub = StubAdminClient(result=True)
    configure_account_status(stub)

    response = client.post(
        "/api/auth/account-status",
        json={"email": " Person@Example.com "},
    )

    assert response.status_code == 200
    assert response.json() == {"accountExists": True}
    assert response.headers["cache-control"] == "no-store"
    assert stub.emails == ["person@example.com"]
    serialized = response.text.lower()
    for forbidden in ["user_id", "provider", "profile", "metadata", "identities"]:
        assert forbidden not in serialized


def test_new_email_returns_only_account_exists_false(client: TestClient) -> None:
    stub = StubAdminClient(result=False)
    configure_account_status(stub)

    response = client.post(
        "/api/auth/account-status",
        json={"email": "new@example.com"},
    )

    assert response.status_code == 200
    assert response.json() == {"accountExists": False}
    assert set(response.json()) == {"accountExists"}


def test_invalid_email_is_rejected_before_supabase(client: TestClient) -> None:
    stub = StubAdminClient(result=True)
    configure_account_status(stub)

    response = client.post(
        "/api/auth/account-status",
        json={"email": "not-an-email"},
    )

    assert response.status_code == 422
    assert stub.emails == []
    assert "not-an-email" not in response.text


def test_admin_failure_returns_safe_error(client: TestClient) -> None:
    stub = StubAdminClient(error=AccountStatusUnavailableError())
    configure_account_status(stub)

    response = client.post(
        "/api/auth/account-status",
        json={"email": "person@example.com"},
    )

    assert response.status_code == 503
    assert response.json() == {
        "message": "Account status is temporarily unavailable.",
        "code": "ACCOUNT_STATUS_UNAVAILABLE",
    }
    assert "person@example.com" not in response.text


def test_rate_limit_blocks_repeated_account_checks(client: TestClient) -> None:
    stub = StubAdminClient(result=False)
    limiter = AccountStatusRateLimiter(limit=2, window_seconds=60, clock=lambda: 10)
    configure_account_status(stub, limiter)

    statuses = [
        client.post(
            "/api/auth/account-status",
            json={"email": f"person{index}@example.com"},
        ).status_code
        for index in range(3)
    ]

    assert statuses == [200, 200, 429]
    assert len(stub.emails) == 2


def test_account_status_route_is_registered_once() -> None:
    paths = [route.path for route in app.routes]

    assert paths.count("/api/auth/account-status") == 1
