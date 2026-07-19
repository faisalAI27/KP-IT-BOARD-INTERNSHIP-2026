"""Authenticated contributor withdrawal-request endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.dependencies import get_db, require_authenticated_user
from app.schemas import (
    OwnerWithdrawalRequestListResponse,
    OwnerWithdrawalRequestResponse,
    WithdrawalRequestCreate,
)
from app.services.supabase_auth import AuthenticatedUser
from app.services.withdrawal_service import (
    WithdrawalServiceError,
    create_withdrawal_request,
    list_owner_withdrawal_requests,
)


router = APIRouter(prefix="/withdrawals", tags=["Withdrawals"])


def safe_withdrawal_error(error: WithdrawalServiceError) -> JSONResponse:
    return JSONResponse(
        status_code=error.http_status,
        content={"message": error.message, "code": error.code},
    )


@router.post(
    "/me",
    response_model=OwnerWithdrawalRequestResponse,
    status_code=status.HTTP_201_CREATED,
)
def request_owned_withdrawal(
    request: WithdrawalRequestCreate,
    user: Annotated[AuthenticatedUser, Depends(require_authenticated_user)],
    database: Annotated[Session, Depends(get_db)],
) -> OwnerWithdrawalRequestResponse | JSONResponse:
    """Request exclusion without accepting ownership identity from the client."""

    try:
        stored = create_withdrawal_request(
            database=database,
            owner_user_id=user.id,
            scope=request.scope,
            contribution_id=request.contributionId,
            reason=request.reason,
        )
    except WithdrawalServiceError as error:
        return safe_withdrawal_error(error)
    return OwnerWithdrawalRequestResponse.model_validate(stored)


@router.get("/me", response_model=OwnerWithdrawalRequestListResponse)
def list_owned_withdrawals(
    user: Annotated[AuthenticatedUser, Depends(require_authenticated_user)],
    database: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> OwnerWithdrawalRequestListResponse | JSONResponse:
    """Return only withdrawal records belonging to the verified caller."""

    try:
        items, total = list_owner_withdrawal_requests(
            database=database,
            owner_user_id=user.id,
            limit=limit,
            offset=offset,
        )
    except WithdrawalServiceError as error:
        return safe_withdrawal_error(error)
    return OwnerWithdrawalRequestListResponse.model_validate(
        {
            "items": items,
            "total": total,
            "limit": limit,
            "offset": offset,
        }
    )
