"""Protected internal administration routes."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy.orm import Session

from app.dependencies import get_db, require_admin_api_key
from app.schemas import (
    AdminContributionListResponse,
    AdminContributionResponse,
    AdminHealthResponse,
    ContributionReviewRequest,
)
from app.services.admin_contribution_review_service import (
    AdminContributionReviewError,
    apply_contribution_review,
    get_admin_contribution,
    get_contribution_audio_file,
    list_admin_contributions,
)


router = APIRouter(prefix="/admin", tags=["Admin"])


@router.get("/health", response_model=AdminHealthResponse)
def admin_health(
    _authenticated: Annotated[None, Depends(require_admin_api_key)],
) -> AdminHealthResponse:
    """Verify that the configured admin API key is accepted."""

    return AdminHealthResponse(status="healthy", scope="admin")


def _safe_review_error(error: AdminContributionReviewError) -> JSONResponse:
    return JSONResponse(
        status_code=error.http_status,
        content={"message": error.message, "code": error.code},
    )


@router.get("/contributions", response_model=AdminContributionListResponse)
def admin_contribution_list(
    _authenticated: Annotated[None, Depends(require_admin_api_key)],
    database: Annotated[Session, Depends(get_db)],
    review_status: Annotated[str, Query(alias="status")] = "pending",
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> AdminContributionListResponse | JSONResponse:
    """Return one protected, database-filtered contribution review page."""

    try:
        items, total, normalized_status = list_admin_contributions(
            database=database,
            review_status=review_status,
            limit=limit,
            offset=offset,
        )
    except AdminContributionReviewError as error:
        return _safe_review_error(error)
    return AdminContributionListResponse(
        items=[AdminContributionResponse.from_contribution(item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
        status=normalized_status,
    )


@router.get(
    "/contributions/{contribution_id}",
    response_model=AdminContributionResponse,
)
def admin_contribution_detail(
    contribution_id: str,
    _authenticated: Annotated[None, Depends(require_admin_api_key)],
    database: Annotated[Session, Depends(get_db)],
) -> AdminContributionResponse | JSONResponse:
    """Return safe review metadata for one protected contribution."""

    try:
        contribution = get_admin_contribution(
            database=database,
            contribution_id=contribution_id,
        )
    except AdminContributionReviewError as error:
        return _safe_review_error(error)
    return AdminContributionResponse.from_contribution(contribution)


@router.get(
    "/contributions/{contribution_id}/audio",
    response_model=None,
)
def admin_contribution_audio(
    contribution_id: str,
    _authenticated: Annotated[None, Depends(require_admin_api_key)],
    database: Annotated[Session, Depends(get_db)],
) -> FileResponse | JSONResponse:
    """Return one private contribution recording for authenticated review."""

    try:
        audio_file = get_contribution_audio_file(
            database=database,
            contribution_id=contribution_id,
        )
    except AdminContributionReviewError as error:
        return _safe_review_error(error)
    return FileResponse(
        path=audio_file.path,
        media_type=audio_file.mime_type,
        filename=audio_file.filename,
        content_disposition_type="inline",
    )


@router.patch(
    "/contributions/{contribution_id}/review",
    response_model=AdminContributionResponse,
)
def review_admin_contribution(
    contribution_id: str,
    request: ContributionReviewRequest,
    _authenticated: Annotated[None, Depends(require_admin_api_key)],
    database: Annotated[Session, Depends(get_db)],
) -> AdminContributionResponse | JSONResponse:
    """Approve or reject one contribution without altering its ownership or audio."""

    try:
        contribution = apply_contribution_review(
            database=database,
            contribution_id=contribution_id,
            review_status=request.status,
            rejection_reason=request.rejectionReason,
        )
    except AdminContributionReviewError as error:
        return _safe_review_error(error)
    return AdminContributionResponse.from_contribution(contribution)
