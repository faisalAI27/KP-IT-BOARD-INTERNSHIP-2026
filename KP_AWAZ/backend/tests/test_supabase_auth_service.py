"""Isolated tests for the direct Supabase Auth HTTP client."""

import asyncio
from dataclasses import fields

import httpx
import pytest
from pydantic import ValidationError

from app.config import Settings
from app.services.supabase_auth import (
    AuthenticatedUser,
    AuthNotConfiguredError,
    AuthServiceUnavailableError,
    InvalidAccessTokenError,
    InvalidAuthResponseError,
    SupabaseAuthClient,
)


VALID_USER_ID = "0d5dd8f5-93df-462b-b234-a16973089092"
SUPABASE_URL = "https://test-project.supabase.co"
PUBLISHABLE_KEY = "test-publishable-key"
ACCESS_TOKEN = "test-user-access-token"


def call_get_user(
    handler: httpx.MockTransport,
    *,
    token: str = ACCESS_TOKEN,
    supabase_url: str = SUPABASE_URL,
    publishable_key: str = PUBLISHABLE_KEY,
) -> AuthenticatedUser:
    client = SupabaseAuthClient(
        supabase_url=supabase_url,
        publishable_key=publishable_key,
        timeout_seconds=1,
        transport=handler,
    )
    return asyncio.run(client.get_user(token))


def json_transport(payload: object, status_code: int = 200) -> httpx.MockTransport:
    return httpx.MockTransport(
        lambda _: httpx.Response(status_code, json=payload)
    )


def test_supabase_settings_allow_missing_development_configuration() -> None:
    configured = Settings(
        _env_file=None,
        supabase_url="",
        supabase_publishable_key="",
    )

    assert configured.supabase_url == ""
    assert configured.supabase_publishable_key == ""


def test_supabase_settings_normalize_url_and_require_positive_timeout() -> None:
    configured = Settings(
        _env_file=None,
        supabase_url=f"  {SUPABASE_URL}///  ",
        supabase_publishable_key=" test-key ",
        supabase_auth_timeout_seconds=5,
    )

    assert configured.supabase_url == SUPABASE_URL
    assert configured.supabase_publishable_key == "test-key"
    with pytest.raises(ValidationError):
        Settings(_env_file=None, supabase_auth_timeout_seconds=0)


def test_valid_google_user_response_returns_minimal_authenticated_user() -> None:
    user = call_get_user(
        json_transport(
            {
                "id": VALID_USER_ID,
                "email": "  person@example.com  ",
                "app_metadata": {"provider": "google", "role": "authenticated"},
                "user_metadata": {"full_name": "Private Name"},
                "identities": [{"provider": "google"}],
            }
        )
    )

    assert user == AuthenticatedUser(
        id=VALID_USER_ID,
        email="person@example.com",
        provider="google",
        display_name="Private Name",
    )


def test_valid_email_user_response_returns_email_provider() -> None:
    user = call_get_user(
        json_transport(
            {
                "id": VALID_USER_ID,
                "email": "person@example.com",
                "app_metadata": {"provider": "email"},
            }
        )
    )

    assert user.provider == "email"


def test_email_may_be_null() -> None:
    user = call_get_user(
        json_transport(
            {
                "id": VALID_USER_ID,
                "email": None,
                "app_metadata": {"provider": "google"},
            }
        )
    )

    assert user.email is None


def test_provider_may_be_null_when_app_metadata_is_missing() -> None:
    user = call_get_user(
        json_transport({"id": VALID_USER_ID, "email": "person@example.com"})
    )

    assert user.provider is None


def test_trailing_url_slashes_are_removed_and_user_path_is_exact() -> None:
    requested_urls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested_urls.append(str(request.url))
        return httpx.Response(200, json={"id": VALID_USER_ID})

    call_get_user(
        httpx.MockTransport(handler),
        supabase_url=f"{SUPABASE_URL}///",
    )

    assert requested_urls == [f"{SUPABASE_URL}/auth/v1/user"]


def test_publishable_key_and_bearer_token_are_sent_in_headers() -> None:
    observed_headers: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        observed_headers.update(request.headers)
        return httpx.Response(200, json={"id": VALID_USER_ID})

    call_get_user(httpx.MockTransport(handler))

    assert observed_headers["apikey"] == PUBLISHABLE_KEY
    assert observed_headers["authorization"] == f"Bearer {ACCESS_TOKEN}"


@pytest.mark.parametrize(
    ("supabase_url", "publishable_key"),
    [("", PUBLISHABLE_KEY), (SUPABASE_URL, "")],
)
def test_missing_configuration_raises_safe_error(
    supabase_url: str,
    publishable_key: str,
) -> None:
    client = SupabaseAuthClient(
        supabase_url=supabase_url,
        publishable_key=publishable_key,
        timeout_seconds=1,
        transport=json_transport({"id": VALID_USER_ID}),
    )

    with pytest.raises(AuthNotConfiguredError) as captured:
        asyncio.run(client.get_user(ACCESS_TOKEN))

    assert captured.value.code == "AUTH_NOT_CONFIGURED"


def test_blank_token_is_rejected_without_network_access() -> None:
    requests = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal requests
        requests += 1
        return httpx.Response(200, json={"id": VALID_USER_ID})

    client = SupabaseAuthClient(
        supabase_url=SUPABASE_URL,
        publishable_key=PUBLISHABLE_KEY,
        timeout_seconds=1,
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(InvalidAccessTokenError):
        asyncio.run(client.get_user("   "))

    assert requests == 0


@pytest.mark.parametrize("status_code", [401, 403])
def test_unauthorized_upstream_status_rejects_token(status_code: int) -> None:
    with pytest.raises(InvalidAccessTokenError):
        call_get_user(json_transport({"message": "upstream detail"}, status_code))


@pytest.mark.parametrize("status_code", [429, 500, 503])
def test_temporary_upstream_status_is_unavailable(status_code: int) -> None:
    with pytest.raises(AuthServiceUnavailableError):
        call_get_user(json_transport({"message": "upstream detail"}, status_code))


def test_timeout_is_mapped_to_auth_service_unavailable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("upstream timed out", request=request)

    with pytest.raises(AuthServiceUnavailableError):
        call_get_user(httpx.MockTransport(handler))


def test_connection_failure_is_mapped_to_auth_service_unavailable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("upstream unavailable", request=request)

    with pytest.raises(AuthServiceUnavailableError):
        call_get_user(httpx.MockTransport(handler))


def test_malformed_success_json_is_rejected() -> None:
    transport = httpx.MockTransport(
        lambda _: httpx.Response(200, content=b"{not-json")
    )

    with pytest.raises(InvalidAuthResponseError):
        call_get_user(transport)


def test_missing_user_id_is_rejected() -> None:
    with pytest.raises(InvalidAuthResponseError):
        call_get_user(json_transport({"email": "person@example.com"}))


def test_invalid_uuid_user_id_is_rejected() -> None:
    with pytest.raises(InvalidAuthResponseError):
        call_get_user(json_transport({"id": "not-a-uuid"}))


def test_raw_metadata_is_not_retained_on_authenticated_user() -> None:
    user = call_get_user(
        json_transport(
            {
                "id": VALID_USER_ID,
                "app_metadata": {"provider": "google", "secret": "hidden"},
                "user_metadata": {
                    "display_name": "Safe Display Name",
                    "private": "hidden",
                },
                "access_token": "must-not-appear",
            }
        )
    )

    assert {field.name for field in fields(user)} == {
        "id",
        "email",
        "provider",
        "display_name",
    }
    assert user.display_name == "Safe Display Name"
    assert "metadata" not in repr(user)
    assert "hidden" not in repr(user)
    assert "must-not-appear" not in repr(user)


@pytest.mark.parametrize(
    "user_metadata",
    [
        None,
        {},
        {"display_name": "x"},
        {"full_name": " "},
        {"name": "x" * 81},
        {"display_name": 42},
    ],
)
def test_missing_or_invalid_display_name_metadata_is_ignored(
    user_metadata: object,
) -> None:
    payload = {"id": VALID_USER_ID}
    if user_metadata is not None:
        payload["user_metadata"] = user_metadata

    user = call_get_user(json_transport(payload))

    assert user.display_name is None


def test_auth_exceptions_do_not_contain_token_or_publishable_key() -> None:
    transport = json_transport(
        {
            "message": f"raw {ACCESS_TOKEN} {PUBLISHABLE_KEY}",
        },
        401,
    )

    with pytest.raises(InvalidAccessTokenError) as captured:
        call_get_user(transport)

    safe_exception = f"{captured.value!r} {captured.value}"
    assert ACCESS_TOKEN not in safe_exception
    assert PUBLISHABLE_KEY not in safe_exception
