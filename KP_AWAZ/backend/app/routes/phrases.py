"""Protected phrase import, management, statistics, and export routes."""

from typing import Annotated

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import JSONResponse, Response
from sqlalchemy.orm import Session

from app.config import settings
from app.dependencies import get_db, require_admin_api_key
from app.schemas import (
    AdminPhraseListResponse,
    AdminPhraseResponse,
    PhraseImportSummaryResponse,
    PhraseUpdateRequest,
)
from app.services.phrase_service import (
    PhraseAdminRecord,
    PhraseImportError,
    PhraseServiceError,
    export_phrase_collection,
    import_phrase_file,
    list_admin_phrases,
    update_phrase,
)


router = APIRouter(
    prefix="/admin/phrases",
    tags=["Admin phrases"],
    dependencies=[Depends(require_admin_api_key)],
)


def _safe_error(error: PhraseServiceError) -> JSONResponse:
    return JSONResponse(
        status_code=error.http_status,
        content={"message": error.message, "code": error.code},
    )


def _phrase_response(record: PhraseAdminRecord) -> AdminPhraseResponse:
    phrase = record.phrase
    return AdminPhraseResponse(
        id=phrase.id,
        text=phrase.text,
        language=phrase.language,
        category=phrase.category,
        dialect=phrase.dialect,
        source=phrase.source,
        difficulty=phrase.difficulty,
        active=phrase.is_active,
        created_at=phrase.created_at,
        updated_at=phrase.updated_at or phrase.created_at,
        times_assigned=phrase.times_assigned,
        recordings_submitted=record.recordings_submitted,
        pending_count=record.pending_count,
        approved_count=record.approved_count,
        rejected_count=record.rejected_count,
    )


@router.post("/import", response_model=PhraseImportSummaryResponse)
async def import_phrases(
    database: Annotated[Session, Depends(get_db)],
    file: Annotated[UploadFile, File()],
) -> PhraseImportSummaryResponse | JSONResponse:
    maximum_size = int(settings.max_import_file_size_mb * 1024 * 1024)
    try:
        content = await file.read(maximum_size + 1)
    except Exception:
        return _safe_error(PhraseImportError())
    finally:
        try:
            await file.close()
        except Exception:
            pass
    try:
        summary = import_phrase_file(
            database=database,
            filename=file.filename or "",
            content=content,
        )
    except PhraseServiceError as error:
        return _safe_error(error)
    return PhraseImportSummaryResponse(
        received=summary.received,
        created=summary.created,
        duplicates=summary.duplicates,
        invalid=summary.invalid,
    )


@router.get("", response_model=AdminPhraseListResponse)
def admin_phrase_list(
    database: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    search: Annotated[str | None, Query(max_length=500)] = None,
    language: Annotated[str | None, Query(max_length=100)] = None,
    active: Annotated[bool | None, Query()] = None,
    order: Annotated[str, Query(pattern="^(newest|oldest)$")] = "newest",
) -> AdminPhraseListResponse | JSONResponse:
    try:
        records, total, normalized_order = list_admin_phrases(
            database=database,
            limit=limit,
            offset=offset,
            search=search,
            language=language,
            active=active,
            order=order,
        )
    except PhraseServiceError as error:
        return _safe_error(error)
    return AdminPhraseListResponse(
        items=[_phrase_response(record) for record in records],
        total=total,
        limit=limit,
        offset=offset,
        order=normalized_order,
    )


@router.get("/export", response_model=None)
def export_phrases(
    database: Annotated[Session, Depends(get_db)],
    export_format: Annotated[
        str,
        Query(alias="format", pattern="^(csv|json)$"),
    ] = "csv",
    active_only: Annotated[bool, Query()] = True,
) -> Response | JSONResponse:
    try:
        document = export_phrase_collection(
            database=database,
            export_format=export_format,
            active_only=active_only,
        )
    except PhraseServiceError as error:
        return _safe_error(error)
    return Response(
        content=document.content,
        media_type=f"{document.media_type}; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{document.filename}"'
        },
    )


@router.patch("/{phrase_id}", response_model=AdminPhraseResponse)
def patch_phrase(
    phrase_id: str,
    request: PhraseUpdateRequest,
    database: Annotated[Session, Depends(get_db)],
) -> AdminPhraseResponse | JSONResponse:
    try:
        record = update_phrase(
            database=database,
            phrase_id=phrase_id,
            updates=request.model_dump(exclude_unset=True),
        )
    except PhraseServiceError as error:
        return _safe_error(error)
    return _phrase_response(record)
