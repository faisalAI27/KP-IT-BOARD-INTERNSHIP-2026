"""Small asynchronous client for verifying users with Supabase Auth."""

from dataclasses import dataclass
from typing import Any
from uuid import UUID

import httpx

from app.config import settings


@dataclass(frozen=True, slots=True)
class AuthenticatedUser:
    """Minimal verified identity retained from a Supabase Auth response."""

    id: str
    email: str | None
    provider: str | None
    display_name: str | None = None


class SupabaseAuthError(Exception):
    """Base class for safe failures during Supabase authentication."""

    code = "SUPABASE_AUTH_ERROR"
    message = "Authentication could not be completed."
    http_status = 503

    def __init__(self) -> None:
        super().__init__(self.message)


class AuthNotConfiguredError(SupabaseAuthError):
    """Raised when the optional Supabase settings have not been supplied."""

    code = "AUTH_NOT_CONFIGURED"
    message = "Authentication is not configured."


class InvalidAccessTokenError(SupabaseAuthError):
    """Raised when a token is blank, invalid, or expired."""

    code = "INVALID_ACCESS_TOKEN"
    message = "The access token is invalid or expired."
    http_status = 401


class AuthServiceUnavailableError(SupabaseAuthError):
    """Raised when Supabase Auth cannot provide a reliable answer."""

    code = "AUTH_SERVICE_UNAVAILABLE"
    message = "Authentication is temporarily unavailable."


class AccountStatusNotConfiguredError(SupabaseAuthError):
    """Raised when the server-only Supabase administrator key is absent."""

    code = "ACCOUNT_STATUS_NOT_CONFIGURED"
    message = "Account status is temporarily unavailable."


class AccountStatusUnavailableError(SupabaseAuthError):
    """Raised when an administrator lookup cannot provide a reliable answer."""

    code = "ACCOUNT_STATUS_UNAVAILABLE"
    message = "Account status is temporarily unavailable."


class AccountStatusRateLimitError(SupabaseAuthError):
    """Raised when one client makes too many existence checks."""

    code = "ACCOUNT_STATUS_RATE_LIMITED"
    message = "Too many account checks. Please try again shortly."
    http_status = 429


class InvalidAuthResponseError(SupabaseAuthError):
    """Raised when a successful upstream response has no valid user identity."""

    code = "INVALID_AUTH_RESPONSE"
    message = "Authentication returned an invalid response."


class SupabaseAuthClient:
    """Verify access tokens against Supabase's authenticated-user endpoint."""

    def __init__(
        self,
        *,
        supabase_url: str | None = None,
        publishable_key: str | None = None,
        timeout_seconds: float | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        configured_url = settings.supabase_url if supabase_url is None else supabase_url
        configured_key = (
            settings.supabase_publishable_key
            if publishable_key is None
            else publishable_key
        )
        configured_timeout = (
            settings.supabase_auth_timeout_seconds
            if timeout_seconds is None
            else timeout_seconds
        )

        self._supabase_url = configured_url.strip().rstrip("/")
        self._publishable_key = configured_key.strip()
        self._timeout_seconds = float(configured_timeout)
        self._transport = transport

        if self._timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")

    async def get_user(self, access_token: str) -> AuthenticatedUser:
        """Return only the safe fields from a user verified by Supabase Auth."""

        if not self._supabase_url or not self._publishable_key:
            raise AuthNotConfiguredError()

        cleaned_token = access_token.strip() if isinstance(access_token, str) else ""
        if not cleaned_token:
            raise InvalidAccessTokenError()

        try:
            async with httpx.AsyncClient(
                timeout=self._timeout_seconds,
                transport=self._transport,
            ) as client:
                response = await client.get(
                    f"{self._supabase_url}/auth/v1/user",
                    headers={
                        "apikey": self._publishable_key,
                        "Authorization": f"Bearer {cleaned_token}",
                    },
                )
        except (httpx.TimeoutException, httpx.RequestError) as error:
            raise AuthServiceUnavailableError() from error

        if response.status_code in {401, 403}:
            raise InvalidAccessTokenError()
        if response.status_code == 429 or response.status_code >= 500:
            raise AuthServiceUnavailableError()
        if response.status_code != 200:
            raise AuthServiceUnavailableError()

        try:
            payload = response.json()
        except ValueError as error:
            raise InvalidAuthResponseError() from error

        return _authenticated_user_from_payload(payload)


class SupabaseAdminClient:
    """Perform a bounded server-only lookup through Supabase Auth Admin."""

    def __init__(
        self,
        *,
        supabase_url: str | None = None,
        secret_key: str | None = None,
        timeout_seconds: float | None = None,
        users_per_page: int | None = None,
        max_pages: int | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        configured_url = settings.supabase_url if supabase_url is None else supabase_url
        configured_key = (
            settings.supabase_secret_key if secret_key is None else secret_key
        )
        configured_timeout = (
            settings.supabase_admin_timeout_seconds
            if timeout_seconds is None
            else timeout_seconds
        )
        configured_page_size = (
            settings.supabase_admin_users_per_page
            if users_per_page is None
            else users_per_page
        )
        configured_max_pages = (
            settings.supabase_admin_max_pages if max_pages is None else max_pages
        )

        self._supabase_url = configured_url.strip().rstrip("/")
        self._secret_key = configured_key.strip()
        self._timeout_seconds = float(configured_timeout)
        self._users_per_page = int(configured_page_size)
        self._max_pages = int(configured_max_pages)
        self._transport = transport

        if self._timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")
        if not 1 <= self._users_per_page <= 1000:
            raise ValueError("users_per_page must be between 1 and 1000")
        if self._max_pages <= 0:
            raise ValueError("max_pages must be positive")

    async def account_exists(self, email: str) -> bool:
        """Return only whether a normalized email appears within the safe bound."""

        if not self._supabase_url or not self._secret_key:
            raise AccountStatusNotConfiguredError()

        normalized_email = email.strip().lower() if isinstance(email, str) else ""
        if not normalized_email:
            raise AccountStatusUnavailableError()

        try:
            async with httpx.AsyncClient(
                timeout=self._timeout_seconds,
                transport=self._transport,
            ) as client:
                for page in range(1, self._max_pages + 1):
                    response = await client.get(
                        f"{self._supabase_url}/auth/v1/admin/users",
                        params={"page": page, "per_page": self._users_per_page},
                        headers={
                            "apikey": self._secret_key,
                            "Authorization": f"Bearer {self._secret_key}",
                        },
                    )
                    users = _admin_users_from_response(response)
                    for user in users:
                        candidate = user.get("email")
                        if (
                            isinstance(candidate, str)
                            and candidate.strip().lower() == normalized_email
                        ):
                            return True
                    if len(users) < self._users_per_page:
                        return False
        except (httpx.TimeoutException, httpx.RequestError) as error:
            raise AccountStatusUnavailableError() from error

        # A full last page means more users may exist beyond the configured bound.
        raise AccountStatusUnavailableError()


def _admin_users_from_response(response: httpx.Response) -> list[dict[str, Any]]:
    if response.status_code != 200:
        raise AccountStatusUnavailableError()
    try:
        payload = response.json()
    except ValueError as error:
        raise AccountStatusUnavailableError() from error
    if not isinstance(payload, dict):
        raise AccountStatusUnavailableError()
    users = payload.get("users")
    if not isinstance(users, list) or any(not isinstance(user, dict) for user in users):
        raise AccountStatusUnavailableError()
    return users


def _authenticated_user_from_payload(payload: Any) -> AuthenticatedUser:
    if not isinstance(payload, dict):
        raise InvalidAuthResponseError()

    raw_id = payload.get("id")
    if not isinstance(raw_id, str):
        raise InvalidAuthResponseError()
    try:
        user_id = str(UUID(raw_id))
    except (ValueError, TypeError, AttributeError) as error:
        raise InvalidAuthResponseError() from error

    raw_email = payload.get("email")
    if raw_email is not None and not isinstance(raw_email, str):
        raise InvalidAuthResponseError()
    email = raw_email.strip() or None if isinstance(raw_email, str) else None

    raw_app_metadata = payload.get("app_metadata")
    if raw_app_metadata is not None and not isinstance(raw_app_metadata, dict):
        raise InvalidAuthResponseError()
    raw_provider = (
        raw_app_metadata.get("provider")
        if isinstance(raw_app_metadata, dict)
        else None
    )
    if raw_provider is not None and not isinstance(raw_provider, str):
        raise InvalidAuthResponseError()
    provider = (
        raw_provider.strip() or None if isinstance(raw_provider, str) else None
    )

    raw_user_metadata = payload.get("user_metadata")
    if raw_user_metadata is not None and not isinstance(raw_user_metadata, dict):
        raise InvalidAuthResponseError()
    display_name: str | None = None
    if isinstance(raw_user_metadata, dict):
        for field_name in ("display_name", "full_name", "name"):
            candidate = raw_user_metadata.get(field_name)
            if not isinstance(candidate, str):
                continue
            cleaned_candidate = candidate.strip()
            if 2 <= len(cleaned_candidate) <= 80:
                display_name = cleaned_candidate
                break

    return AuthenticatedUser(
        id=user_id,
        email=email,
        provider=provider,
        display_name=display_name,
    )
