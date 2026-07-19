"""Public sentence retrieval route."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.dependencies import get_db
from app.schemas import SentenceListResponse
from app.services.sentence_service import SentenceDeliveryError, get_active_sentences
from app.utils.text_normalization import normalize_language_name


router = APIRouter(tags=["Sentences"])


@router.get("/sentences", response_model=SentenceListResponse)
def list_sentences(
    database: Annotated[Session, Depends(get_db)],
    language: Annotated[str, Query(min_length=1, max_length=100)] = "Pashto",
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> SentenceListResponse | JSONResponse:
    """Return active prompts for the requested language."""

    try:
        cleaned_language = normalize_language_name(language)
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(error),
        ) from error

    try:
        sentences = get_active_sentences(
            database,
            language=cleaned_language,
            limit=limit,
        )
    except SentenceDeliveryError as error:
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"message": error.message, "code": error.code},
        )
    return SentenceListResponse(data=sentences)
