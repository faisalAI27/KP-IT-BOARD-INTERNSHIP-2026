"""FastAPI application entry point."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.database import Base, engine
from app.dependencies import AuthenticationRequiredError
from app.models import (  # noqa: F401 - registers metadata
    ImportBatch,
    PointLedgerEntry,
    Profile,
    Sentence,
    TextContribution,
    WithdrawalRequest,
)
from app.routes import (
    admin,
    auth,
    contributions,
    health,
    leaderboard,
    phrases,
    profiles,
    sentence_imports,
    sentences,
    withdrawals,
)
from app.services.contribution_statistics_service import ContributionStatisticsError
from app.services.profile_service import ProfileServiceError
from app.services.points_ledger_service import PointsLedgerError
from app.services.schema_compatibility import (
    ensure_contribution_ownership_schema,
    ensure_sentence_phrase_schema,
)
from app.services.runtime_configuration import prepare_runtime_storage
from app.services.supabase_auth import SupabaseAuthError


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Prepare database tables when the application starts."""

    prepare_runtime_storage(settings)
    Base.metadata.create_all(bind=engine)
    ensure_contribution_ownership_schema(engine)
    ensure_sentence_phrase_schema(engine)
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)
logger = logging.getLogger("kp_awaz")


DEVELOPMENT_LAN_FRONTEND_ORIGIN_REGEX = (
    r"^http://(?:"
    r"10(?:\.[0-9]{1,3}){3}|"
    r"192\.168(?:\.[0-9]{1,3}){2}|"
    r"172\.(?:1[6-9]|2[0-9]|3[01])(?:\.[0-9]{1,3}){2}"
    r"):4173$"
)


def development_lan_frontend_origin_regex(environment: str) -> str | None:
    """Permit the documented private-LAN demo origin only in development."""

    return (
        DEVELOPMENT_LAN_FRONTEND_ORIGIN_REGEX
        if environment == "development"
        else None
    )


@app.exception_handler(RequestValidationError)
async def request_validation_error_handler(
    _: Request,
    error: RequestValidationError,
) -> JSONResponse:
    """Return validation locations and messages without echoing supplied secrets."""

    safe_errors = [
        {
            "type": item.get("type", "validation_error"),
            "loc": item.get("loc", ()),
            "msg": item.get("msg", "Invalid request value."),
        }
        for item in error.errors()
    ]
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": safe_errors},
    )


@app.exception_handler(AuthenticationRequiredError)
async def authentication_required_handler(
    _: Request,
    error: AuthenticationRequiredError,
) -> JSONResponse:
    """Return the auth error envelope without FastAPI's default detail wrapper."""

    return JSONResponse(
        status_code=error.http_status,
        content={"message": error.message, "code": error.code},
    )


@app.exception_handler(SupabaseAuthError)
async def supabase_auth_error_handler(
    _: Request,
    error: SupabaseAuthError,
) -> JSONResponse:
    """Map only Supabase Auth failures to the public safe error envelope."""

    return JSONResponse(
        status_code=error.http_status,
        content={"message": error.message, "code": error.code},
    )


@app.exception_handler(ProfileServiceError)
async def profile_service_error_handler(
    _: Request,
    error: ProfileServiceError,
) -> JSONResponse:
    """Return a safe profile error without leaking persistence details."""

    return JSONResponse(
        status_code=error.http_status,
        content={"message": error.message, "code": error.code},
    )


@app.exception_handler(ContributionStatisticsError)
async def contribution_statistics_error_handler(
    _: Request,
    error: ContributionStatisticsError,
) -> JSONResponse:
    """Return database-query failures without SQL or filesystem details."""

    return JSONResponse(
        status_code=error.http_status,
        content={"message": error.message, "code": error.code},
    )


@app.exception_handler(PointsLedgerError)
async def points_ledger_error_handler(
    _: Request,
    error: PointsLedgerError,
) -> JSONResponse:
    """Return point persistence and query failures without internal details."""

    return JSONResponse(
        status_code=error.http_status,
        content={"message": error.message, "code": error.code},
    )


@app.exception_handler(Exception)
async def unexpected_error_handler(request: Request, _: Exception) -> JSONResponse:
    """Return a stable public error and log no body, headers, query, or secrets."""

    route = request.scope.get("route")
    route_name = getattr(route, "path", "unmatched-route")
    logger.error("Unhandled request failure route=%s status=500", route_name)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "message": "The request could not be completed.",
            "code": "INTERNAL_SERVER_ERROR",
        },
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.frontend_origins,
    allow_origin_regex=development_lan_frontend_origin_regex(settings.environment),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Accept", "Authorization", "Content-Type", "X-Admin-Key"],
)

app.include_router(health.router, prefix=settings.api_prefix)
app.include_router(leaderboard.router, prefix=settings.api_prefix)
app.include_router(sentences.router, prefix=settings.api_prefix)
app.include_router(admin.router, prefix=settings.api_prefix)
app.include_router(phrases.router, prefix=settings.api_prefix)
app.include_router(sentence_imports.router, prefix=settings.api_prefix)
app.include_router(contributions.router, prefix=settings.api_prefix)
app.include_router(auth.router, prefix=settings.api_prefix)
app.include_router(profiles.router, prefix=settings.api_prefix)
app.include_router(withdrawals.router, prefix=settings.api_prefix)
