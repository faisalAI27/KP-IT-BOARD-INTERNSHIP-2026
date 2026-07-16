"""Public privacy-safe contribution leaderboard route."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.dependencies import get_db
from app.schemas import PublicLeaderboardResponse
from app.services.contribution_statistics_service import list_public_leaderboard


router = APIRouter(tags=["Leaderboard"])


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
