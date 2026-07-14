"""Service health route."""

from fastapi import APIRouter

from app.config import settings


router = APIRouter(tags=["Health"])


@router.get("/health")
def health_check() -> dict[str, str]:
    """Report whether the API process is available."""

    return {
        "status": "healthy",
        "service": settings.app_name,
    }

