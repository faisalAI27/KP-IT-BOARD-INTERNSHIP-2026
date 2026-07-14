"""Reusable FastAPI dependencies."""

from collections.abc import Generator

from sqlalchemy.orm import Session

from app.database import SessionLocal


def get_db() -> Generator[Session, None, None]:
    """Provide one database session for the lifetime of a request."""

    database = SessionLocal()
    try:
        yield database
    finally:
        database.close()

