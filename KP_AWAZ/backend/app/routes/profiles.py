"""Protected current-user profile endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.dependencies import get_db, require_authenticated_user
from app.schemas import (
    ProfileContributionStatisticsResponse,
    ProfileResponse,
    ProfileUpdateRequest,
)
from app.services.contribution_statistics_service import (
    get_profile_contribution_statistics,
)
from app.services.profile_service import get_or_create_profile, update_profile
from app.services.supabase_auth import AuthenticatedUser


router = APIRouter(prefix="/profile", tags=["Profile"])


@router.get(
    "/me/statistics",
    response_model=ProfileContributionStatisticsResponse,
)
def get_current_profile_statistics(
    user: Annotated[AuthenticatedUser, Depends(require_authenticated_user)],
    database: Annotated[Session, Depends(get_db)],
) -> ProfileContributionStatisticsResponse:
    """Return dynamic contribution counts for only the verified caller."""

    profile = get_or_create_profile(
        database=database,
        authenticated_user=user,
    )
    return ProfileContributionStatisticsResponse.model_validate(
        get_profile_contribution_statistics(
            database=database,
            profile=profile,
        )
    )


@router.get("/me", response_model=ProfileResponse)
def get_current_profile(
    user: Annotated[AuthenticatedUser, Depends(require_authenticated_user)],
    database: Annotated[Session, Depends(get_db)],
) -> ProfileResponse:
    """Return, creating when necessary, the verified caller's profile."""

    return ProfileResponse.model_validate(
        get_or_create_profile(database=database, authenticated_user=user)
    )


@router.patch("/me", response_model=ProfileResponse)
def patch_current_profile(
    updates: ProfileUpdateRequest,
    user: Annotated[AuthenticatedUser, Depends(require_authenticated_user)],
    database: Annotated[Session, Depends(get_db)],
) -> ProfileResponse:
    """Update only the preferences belonging to the verified caller."""

    return ProfileResponse.model_validate(
        update_profile(
            database=database,
            authenticated_user=user,
            updates=updates,
        )
    )
