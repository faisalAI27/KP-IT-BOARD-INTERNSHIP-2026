"""Public privacy-safe contribution leaderboard route."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.dependencies import get_db, require_authenticated_user
from app.schemas import (
    PersonalLeaderboardContextResponse,
    PublicLeaderboardResponse,
)
from app.services.contribution_statistics_service import (
    get_personal_leaderboard_context,
    list_public_leaderboard,
)
from app.services.profile_service import get_or_create_profile
from app.services.supabase_auth import AuthenticatedUser


router = APIRouter(tags=["Leaderboard"])


@router.get(
    "/leaderboard/me/context",
    response_model=PersonalLeaderboardContextResponse,
)
def get_current_user_leaderboard_context(
    user: Annotated[AuthenticatedUser, Depends(require_authenticated_user)],
    database: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> PersonalLeaderboardContextResponse:
    """Return the ranked page containing only the verified caller's marker."""

    profile = get_or_create_profile(
        database=database,
        authenticated_user=user,
    )
    return PersonalLeaderboardContextResponse.model_validate(
        get_personal_leaderboard_context(
            database=database,
            profile=profile,
            limit=limit,
        )
    )


@router.get("/leaderboard", response_model=PublicLeaderboardResponse)
def get_public_leaderboard(
    database: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> PublicLeaderboardResponse:
    """Return currently eligible profiles ranked by approved contributions."""

    return PublicLeaderboardResponse.model_validate(
        list_public_leaderboard(
            database=database,
            limit=limit,
            offset=offset,
        )
    )
