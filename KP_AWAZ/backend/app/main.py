"""FastAPI application entry point."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.database import Base, engine
from app.dependencies import AuthenticationRequiredError
from app.models import ImportBatch, Profile, Sentence  # noqa: F401 - registers metadata
from app.routes import (
    admin,
    auth,
    contributions,
    health,
    profiles,
    sentence_imports,
    sentences,
)
from app.services.profile_service import ProfileServiceError
from app.services.schema_compatibility import ensure_contribution_ownership_schema
from app.services.supabase_auth import SupabaseAuthError


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Prepare database tables when the application starts."""

    Base.metadata.create_all(bind=engine)
    ensure_contribution_ownership_schema(engine)
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)


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

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.frontend_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix=settings.api_prefix)
app.include_router(sentences.router, prefix=settings.api_prefix)
app.include_router(admin.router, prefix=settings.api_prefix)
app.include_router(sentence_imports.router, prefix=settings.api_prefix)
app.include_router(contributions.router, prefix=settings.api_prefix)
app.include_router(auth.router, prefix=settings.api_prefix)
app.include_router(profiles.router, prefix=settings.api_prefix)
