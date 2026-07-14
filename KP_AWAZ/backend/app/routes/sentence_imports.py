"""Protected multipart endpoint for importing sentence TXT files."""

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.dependencies import get_db, require_admin_api_key
from app.schemas import SentenceImportResponse
from app.services.sentence_import_service import (
    SentenceImportFailedError,
    import_txt_sentences,
)
from app.services.txt_import_parser import (
    ImportFileTooLargeError,
    TxtFileInput,
    TxtImportError,
)


router = APIRouter(
    prefix="/admin/sentences",
    tags=["Admin sentence imports"],
    dependencies=[Depends(require_admin_api_key)],
)


def _safe_error_response(
    *, message: str, code: str, status_code: int
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"message": message, "code": code},
    )


@router.post("/import", response_model=SentenceImportResponse)
async def import_sentences(
    database: Annotated[Session, Depends(get_db)],
    language: Annotated[str | None, Form()] = None,
    files: Annotated[list[UploadFile] | None, File()] = None,
) -> SentenceImportResponse | JSONResponse:
    """Read and close uploads, then delegate the complete import workflow."""

    uploads = files or []
    parser_inputs: list[TxtFileInput] = []

    try:
        for upload in uploads:
            parser_inputs.append(
                TxtFileInput(
                    filename=upload.filename or "",
                    content=await upload.read(),
                )
            )
    except Exception:
        return _safe_error_response(
            message=SentenceImportFailedError.default_message,
            code=SentenceImportFailedError.code,
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
    finally:
        for upload in uploads:
            try:
                await upload.close()
            except Exception:
                pass

    try:
        return import_txt_sentences(
            database=database,
            language=language or "",
            files=parser_inputs,
        )
    except TxtImportError as error:
        error_status = (
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
            if isinstance(error, ImportFileTooLargeError)
            else status.HTTP_400_BAD_REQUEST
        )
        return _safe_error_response(
            message=str(error),
            code=error.code,
            status_code=error_status,
        )
    except SentenceImportFailedError as error:
        return _safe_error_response(
            message=str(error),
            code=error.code,
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
