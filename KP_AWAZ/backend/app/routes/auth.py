"""Protected endpoint proving the Supabase Auth backend foundation."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.dependencies import get_db, require_authenticated_user
from app.schemas import AuthenticatedUserResponse
from app.services.profile_service import get_or_create_profile
from app.services.supabase_auth import AuthenticatedUser


router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.get("/me", response_model=AuthenticatedUserResponse)
async def get_authenticated_user(
    user: Annotated[AuthenticatedUser, Depends(require_authenticated_user)],
    database: Annotated[Session, Depends(get_db)],
) -> AuthenticatedUserResponse:
    """Verify the caller and guarantee one durable local profile exists."""

    get_or_create_profile(database=database, authenticated_user=user)

    return AuthenticatedUserResponse(
        id=user.id,
        email=user.email,
        provider=user.provider,
    )
