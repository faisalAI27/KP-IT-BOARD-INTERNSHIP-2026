"""Public voice-contribution endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.dependencies import get_db, require_authenticated_user
from app.schemas import ContributionCreatedResponse, MyContributionListResponse
from app.services.contribution_service import (
    ContributionCreationError,
    ContributionServiceError,
    GuidedContributionInput,
    OpenRecordingInput,
    create_guided_contribution,
    create_open_recording,
    get_user_contributions,
)
from app.services.profile_service import ProfileServiceError, get_or_create_profile
from app.services.supabase_auth import AuthenticatedUser
from app.utils.audio_validation import (
    AudioExtensionMismatchError,
    AudioFileTooLargeError,
    AudioValidationError,
    EmptyAudioFileError,
    InvalidAudioFilenameError,
    InvalidAudioSignatureError,
    UnsupportedAudioTypeError,
)


router = APIRouter(prefix="/contributions", tags=["Contributions"])
UPLOAD_READ_CHUNK_SIZE = 64 * 1024


async def read_bounded_upload(upload: UploadFile, max_size_mb: int | float) -> bytes:
    """Read at most the configured bytes plus one byte for size detection."""

    maximum_bytes = int(max_size_mb * 1024 * 1024)
    read_limit = maximum_bytes + 1
    chunks: list[bytes] = []
    bytes_read = 0

    while bytes_read < read_limit:
        chunk = await upload.read(min(UPLOAD_READ_CHUNK_SIZE, read_limit - bytes_read))
        if not chunk:
            break
        chunks.append(chunk)
        bytes_read += len(chunk)

    return b"".join(chunks)


def _safe_error_response(error: ContributionServiceError | AudioValidationError) -> JSONResponse:
    if isinstance(error, UnsupportedAudioTypeError):
        status_code = status.HTTP_415_UNSUPPORTED_MEDIA_TYPE
    elif isinstance(error, AudioFileTooLargeError):
        status_code = status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
    elif isinstance(
        error,
        (
            EmptyAudioFileError,
            AudioExtensionMismatchError,
            InvalidAudioSignatureError,
            InvalidAudioFilenameError,
        ),
    ):
        status_code = status.HTTP_400_BAD_REQUEST
    else:
        status_code = error.http_status

    return JSONResponse(
        status_code=status_code,
        content={"message": str(error), "code": error.code},
    )


@router.post(
    "/voice",
    response_model=ContributionCreatedResponse,
    status_code=status.HTTP_201_CREATED,
)
async def submit_guided_voice_contribution(
    user: Annotated[AuthenticatedUser, Depends(require_authenticated_user)],
    database: Annotated[Session, Depends(get_db)],
    contributor_name: Annotated[str, Form(alias="contributorName")],
    language: Annotated[str, Form()],
    sentence: Annotated[str, Form()],
    sentence_source: Annotated[str, Form(alias="sentenceSource")],
    consent: Annotated[str, Form()],
    audio: Annotated[UploadFile, File()],
    sentence_id: Annotated[str | None, Form(alias="sentenceId")] = None,
) -> ContributionCreatedResponse | JSONResponse:
    """Accept one guided recording using the existing frontend field names."""

    try:
        audio_content = await read_bounded_upload(
            audio,
            settings.max_guided_audio_size_mb,
        )
    except Exception:
        error = ContributionCreationError()
        return _safe_error_response(error)
    finally:
        try:
            await audio.close()
        except Exception:
            pass

    contribution_input = GuidedContributionInput(
        contributor_name=contributor_name,
        language=language,
        sentence=sentence,
        sentence_source=sentence_source,
        sentence_id=sentence_id,
        consent=consent,
        audio_filename=audio.filename or "",
        audio_mime_type=audio.content_type or "",
        audio_content=audio_content,
    )

    try:
        profile = get_or_create_profile(
            database=database,
            authenticated_user=user,
        )
        contribution = create_guided_contribution(
            database,
            contribution_input,
            owner_user_id=profile.id,
        )
    except ProfileServiceError:
        raise
    except (ContributionServiceError, AudioValidationError) as error:
        return _safe_error_response(error)
    except Exception:
        database.rollback()
        return _safe_error_response(ContributionCreationError())

    return ContributionCreatedResponse.model_validate(contribution)


@router.post(
    "/open-recording",
    response_model=ContributionCreatedResponse,
    status_code=status.HTTP_201_CREATED,
)
async def submit_open_recording(
    user: Annotated[AuthenticatedUser, Depends(require_authenticated_user)],
    database: Annotated[Session, Depends(get_db)],
    contributorName: Annotated[str, Form()],
    language: Annotated[str, Form()],
    consent: Annotated[str, Form()],
    audio: Annotated[UploadFile, File()],
    topic: Annotated[str | None, Form()] = None,
) -> ContributionCreatedResponse | JSONResponse:
    """Accept one consented open recording with an optional topic."""

    creation_error = ContributionCreationError(
        "The open recording could not be completed."
    )
    try:
        audio_content = await read_bounded_upload(
            audio,
            settings.max_open_audio_size_mb,
        )
    except Exception:
        return _safe_error_response(creation_error)
    finally:
        try:
            await audio.close()
        except Exception:
            pass

    contribution_input = OpenRecordingInput(
        contributor_name=contributorName,
        language=language,
        topic=topic,
        consent=consent,
        audio_filename=audio.filename or "",
        audio_mime_type=audio.content_type or "",
        audio_content=audio_content,
    )

    try:
        profile = get_or_create_profile(
            database=database,
            authenticated_user=user,
        )
        contribution = create_open_recording(
            database,
            contribution_input,
            owner_user_id=profile.id,
        )
    except ProfileServiceError:
        raise
    except (ContributionServiceError, AudioValidationError) as error:
        return _safe_error_response(error)
    except Exception:
        database.rollback()
        return _safe_error_response(creation_error)

    return ContributionCreatedResponse.model_validate(contribution)


@router.get("/me", response_model=MyContributionListResponse)
def get_my_contributions(
    user: Annotated[AuthenticatedUser, Depends(require_authenticated_user)],
    database: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> MyContributionListResponse | JSONResponse:
    """Return only the verified caller's contribution history."""

    try:
        items, total = get_user_contributions(
            database=database,
            owner_user_id=user.id,
            limit=limit,
            offset=offset,
        )
    except ContributionServiceError as error:
        return _safe_error_response(error)

    return MyContributionListResponse.model_validate(
        {
            "items": items,
            "total": total,
            "limit": limit,
            "offset": offset,
        }
    )
