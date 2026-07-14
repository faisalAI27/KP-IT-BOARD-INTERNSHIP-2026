"""Reusable FastAPI dependencies."""

import secrets
from collections.abc import Generator
from typing import Annotated

from fastapi import Header, HTTPException, status
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal


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
