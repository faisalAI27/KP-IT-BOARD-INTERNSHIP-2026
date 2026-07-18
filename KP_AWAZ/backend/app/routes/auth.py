"""Protected endpoint proving the Supabase Auth backend foundation."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.dependencies import (
    get_account_status_rate_limiter,
    get_db,
    get_supabase_admin_client,
    require_authenticated_user,
)
from app.schemas import (
    AccountStatusRequest,
    AccountStatusResponse,
    AuthenticatedUserResponse,
)
from app.services.profile_service import get_or_create_profile
from app.services.account_status_rate_limit import AccountStatusRateLimiter
from app.services.supabase_auth import AuthenticatedUser, SupabaseAdminClient


router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/account-status", response_model=AccountStatusResponse)
async def get_account_status(
    account: AccountStatusRequest,
    request: Request,
    response: Response,
    admin_client: Annotated[
        SupabaseAdminClient,
        Depends(get_supabase_admin_client),
    ],
    limiter: Annotated[
        AccountStatusRateLimiter,
        Depends(get_account_status_rate_limiter),
    ],
) -> AccountStatusResponse:
    """Return only whether a normalized email exists in Supabase Auth."""

    client_host = request.client.host if request.client is not None else ""
    limiter.check(client_host)
    account_exists = await admin_client.account_exists(account.email)
    response.headers["Cache-Control"] = "no-store"
    return AccountStatusResponse(accountExists=account_exists)


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
