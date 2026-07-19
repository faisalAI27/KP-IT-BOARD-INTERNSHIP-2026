"""Protected current-user profile endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.dependencies import get_db, require_authenticated_user
from app.schemas import (
    ProfileContributionStatisticsResponse,
    PersonalPointsResponse,
    ProfileConsentSummaryResponse,
    ProfileResponse,
    ProfileUpdateRequest,
)
from app.services.contribution_statistics_service import (
    get_profile_contribution_statistics,
)
from app.services.profile_service import (
    get_or_create_profile,
    get_profile_consent_summary,
    update_profile,
)
from app.services.points_ledger_service import get_personal_points
from app.services.supabase_auth import AuthenticatedUser


router = APIRouter(prefix="/profile", tags=["Profile"])


@router.get("/me/consent", response_model=ProfileConsentSummaryResponse)
def get_current_profile_consent(
    user: Annotated[AuthenticatedUser, Depends(require_authenticated_user)],
    database: Annotated[Session, Depends(get_db)],
) -> ProfileConsentSummaryResponse:
    """Return consent details belonging only to the verified caller."""

    profile = get_or_create_profile(
        database=database,
        authenticated_user=user,
    )
    return ProfileConsentSummaryResponse.model_validate(
        get_profile_consent_summary(
            database=database,
            owner_user_id=profile.id,
        )
    )


@router.get("/me/points", response_model=PersonalPointsResponse)
def get_current_profile_points(
    user: Annotated[AuthenticatedUser, Depends(require_authenticated_user)],
    database: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> PersonalPointsResponse:
    """Return only the verified caller's private balance and ledger events."""

    profile = get_or_create_profile(
        database=database,
        authenticated_user=user,
    )
    return PersonalPointsResponse.model_validate(
        get_personal_points(
            database=database,
            owner_user_id=profile.id,
            limit=limit,
            offset=offset,
        )
    )


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
