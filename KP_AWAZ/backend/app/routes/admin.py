"""Protected internal administration routes."""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.dependencies import require_admin_api_key
from app.schemas import AdminHealthResponse


router = APIRouter(prefix="/admin", tags=["Admin"])


@router.get("/health", response_model=AdminHealthResponse)
def admin_health(
    _authenticated: Annotated[None, Depends(require_admin_api_key)],
) -> AdminHealthResponse:
    """Verify that the configured admin API key is accepted."""

    return AdminHealthResponse(status="healthy", scope="admin")
