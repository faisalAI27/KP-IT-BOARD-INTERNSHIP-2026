"""Reusable FastAPI dependencies."""

import secrets
from collections.abc import Generator
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.services.supabase_auth import AuthenticatedUser, SupabaseAuthClient


bearer_scheme = HTTPBearer(auto_error=False)


class AuthenticationRequiredError(Exception):
    """Safe request error raised when no usable bearer token was supplied."""

    code = "AUTHENTICATION_REQUIRED"
    message = "Authentication is required."
    http_status = status.HTTP_401_UNAUTHORIZED

    def __init__(self) -> None:
        super().__init__(self.message)


def get_db() -> Generator[Session, None, None]:
    """Provide one database session for the lifetime of a request."""

    database = SessionLocal()
    try:
        yield database
    finally:
        database.close()


def require_admin_api_key(
    provided_key: Annotated[str | None, Header(alias="X-Admin-Key")] = None,
) -> None:
    """Require the configured API key for an internal admin endpoint."""

    if provided_key is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Admin API key is required.",
        )

    key_matches = secrets.compare_digest(
        provided_key.encode("utf-8"),
        settings.admin_api_key.encode("utf-8"),
    )
    if not key_matches:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid admin API key.",
        )


def get_supabase_auth_client() -> SupabaseAuthClient:
    """Build the small Supabase Auth client from validated application settings."""

    return SupabaseAuthClient()


async def require_authenticated_user(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(bearer_scheme),
    ],
    auth_client: Annotated[SupabaseAuthClient, Depends(get_supabase_auth_client)],
) -> AuthenticatedUser:
    """Validate one required Supabase bearer token and return its verified user."""

    if (
        credentials is None
        or credentials.scheme.lower() != "bearer"
        or not credentials.credentials.strip()
    ):
        raise AuthenticationRequiredError()

    return await auth_client.get_user(credentials.credentials)
