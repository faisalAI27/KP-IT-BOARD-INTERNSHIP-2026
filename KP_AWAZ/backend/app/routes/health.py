"""Safe process health and persistent-storage readiness routes."""

import os
from pathlib import Path

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.config import settings
from app.database import engine
from app.services.runtime_configuration import (
    configured_raw_audio_root,
    sqlite_database_path,
)


router = APIRouter(tags=["Health"])


@router.get("/health")
def health_check() -> dict[str, str]:
    """Report whether the API process is available."""

    return {
        "status": "healthy",
        "service": settings.app_name,
    }


def _directory_accessible(directory: Path) -> bool:
    try:
        return bool(
            directory.is_dir()
            and os.access(directory, os.R_OK)
            and os.access(directory, os.W_OK)
        )
    except OSError:
        return False


@router.get("/readiness", response_model=None)
def readiness_check() -> dict[str, object] | JSONResponse:
    """Check database and storage access without exposing paths or contents."""

    checks = {
        "database": "unavailable",
        "databaseStorage": "unavailable",
        "audioStorage": "unavailable",
    }
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except SQLAlchemyError:
        pass

    try:
        database_parent = sqlite_database_path(settings.database_url).parent
        if _directory_accessible(database_parent):
            checks["databaseStorage"] = "ok"
    except (OSError, RuntimeError):
        pass

    try:
        if _directory_accessible(configured_raw_audio_root(settings)):
            checks["audioStorage"] = "ok"
    except OSError:
        pass

    ready = all(value == "ok" for value in checks.values())
    payload = {"status": "ready" if ready else "not_ready", "checks": checks}
    if ready:
        return payload
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content=payload,
    )
