"""Protected endpoint proving the Supabase Auth backend foundation."""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.dependencies import require_authenticated_user
from app.schemas import AuthenticatedUserResponse
from app.services.supabase_auth import AuthenticatedUser


router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.get("/me", response_model=AuthenticatedUserResponse)
async def get_authenticated_user(
    user: Annotated[AuthenticatedUser, Depends(require_authenticated_user)],
) -> AuthenticatedUserResponse:
    """Return the identity Supabase verified for the caller's access token."""

    return AuthenticatedUserResponse(
        id=user.id,
        email=user.email,
        provider=user.provider,
    )
