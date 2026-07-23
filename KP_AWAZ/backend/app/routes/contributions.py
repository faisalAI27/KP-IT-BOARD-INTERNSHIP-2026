"""Authenticated voice and text contribution endpoints."""

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile, status
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.dependencies import get_db, require_authenticated_user
from app.schemas import (
    ContributionCreatedResponse,
    MyContributionListResponse,
    TextContributionBatchResponse,
)
from app.services.contribution_service import (
    ContributionCreationError,
    ContributionServiceError,
    GuidedContributionInput,
    OpenRecordingInput,
    create_guided_contribution,
    create_open_recording,
    get_user_contribution_audio_file,
    get_user_contributions,
)
from app.services.profile_service import ProfileServiceError, get_or_create_profile
from app.services.text_contribution_service import (
    TextContributionItemInput,
    TextContributionServiceError,
    create_text_contributions,
)
from app.services.supabase_auth import AuthenticatedUser
from app.services.audio_storage import (
    AudioStorageError,
    StagedAudioUpload,
    cleanup_staged_audio,
    stage_audio_upload,
)
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
ALLOWED_TEXT_FILE_EXTENSIONS = {".csv", ".txt", ".tsv", ".json"}


async def read_bounded_upload(
    upload: UploadFile, max_size_bytes: int
) -> StagedAudioUpload:
    """Compatibility entry point that now streams into bounded private staging."""

    return await stage_audio_upload(
        upload=upload,
        max_size_bytes=max_size_bytes,
    )


def _safe_error_response(
    error: ContributionServiceError | AudioValidationError | AudioStorageError,
) -> JSONResponse:
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
    elif isinstance(error, AudioStorageError):
        status_code = status.HTTP_500_INTERNAL_SERVER_ERROR
    else:
        status_code = error.http_status

    return JSONResponse(
        status_code=status_code,
        content={"message": str(error), "code": error.code},
    )


def _text_error_response(
    message: str,
    *,
    code: str = "TEXT_CONTRIBUTION_INVALID",
    status_code: int = status.HTTP_400_BAD_REQUEST,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"message": message, "code": code},
    )


def _safe_text_filename(filename: str) -> str | None:
    normalized = filename.strip().replace("\\", "/")
    display_name = normalized.rsplit("/", maxsplit=1)[-1].strip()
    if (
        not display_name
        or display_name in {".", ".."}
        or "\x00" in display_name
        or len(display_name) > 255
    ):
        return None
    return display_name


@router.post(
    "/text",
    response_model=TextContributionBatchResponse,
    status_code=status.HTTP_201_CREATED,
)
async def submit_text_contribution(
    user: Annotated[AuthenticatedUser, Depends(require_authenticated_user)],
    database: Annotated[Session, Depends(get_db)],
    contributor_name: Annotated[str, Form(alias="contributorName")],
    language: Annotated[str, Form()],
    text_type: Annotated[str, Form(alias="textType")],
    text: Annotated[str | None, Form()] = None,
    files: Annotated[list[UploadFile] | None, File()] = None,
) -> TextContributionBatchResponse | JSONResponse:
    """Store one authenticated manual sentence and/or bounded text-file batch."""

    uploads = files or []
    if len(uploads) > settings.max_text_upload_files:
        for upload in uploads:
            await upload.close()
        return _text_error_response(
            f"Choose no more than {settings.max_text_upload_files} text files.",
            code="TOO_MANY_TEXT_FILES",
        )

    items: list[TextContributionItemInput] = []
    if isinstance(text, str) and text.strip():
        items.append(
            TextContributionItemInput(
                submission_method="manual",
                text_type=text_type.strip().lower(),
                content=text,
            )
        )

    try:
        for upload in uploads:
            display_name = _safe_text_filename(upload.filename or "")
            if display_name is None:
                return _text_error_response(
                    "One selected text file has an invalid filename.",
                    code="INVALID_TEXT_FILENAME",
                )
            if Path(display_name).suffix.lower() not in ALLOWED_TEXT_FILE_EXTENSIONS:
                return _text_error_response(
                    "Choose CSV, TXT, TSV, or JSON text files only.",
                    code="UNSUPPORTED_TEXT_FILE",
                    status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                )
            content = await upload.read(settings.max_text_upload_bytes + 1)
            if len(content) > settings.max_text_upload_bytes:
                return _text_error_response(
                    f"{display_name} is larger than 2 MB.",
                    code="TEXT_FILE_TOO_LARGE",
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                )
            if not content:
                return _text_error_response(
                    f"{display_name} is empty.",
                    code="EMPTY_TEXT_FILE",
                )
            try:
                decoded = content.decode("utf-8-sig")
            except UnicodeDecodeError:
                return _text_error_response(
                    f"{display_name} must use UTF-8 text encoding.",
                    code="INVALID_TEXT_ENCODING",
                )
            if not decoded.strip() or "\x00" in decoded:
                return _text_error_response(
                    f"{display_name} does not contain usable text.",
                    code="EMPTY_TEXT_FILE",
                )
            items.append(
                TextContributionItemInput(
                    submission_method="file",
                    text_type="file_batch",
                    content=decoded,
                    original_filename=display_name,
                    mime_type=(upload.content_type or "text/plain")[:100],
                    file_size=len(content),
                )
            )
    finally:
        for upload in uploads:
            try:
                await upload.close()
            except Exception:
                pass

    try:
        profile = get_or_create_profile(
            database=database,
            authenticated_user=user,
        )
        contributions = create_text_contributions(
            database=database,
            owner_user_id=profile.id,
            contributor_name=contributor_name,
            language=language,
            items=items,
        )
    except ProfileServiceError:
        raise
    except TextContributionServiceError as error:
        return _text_error_response(
            str(error),
            code=error.code,
            status_code=error.http_status,
        )

    return TextContributionBatchResponse.model_validate(
        {
            "ids": [item.id for item in contributions],
            "itemCount": len(contributions),
            "status": "queued",
            "createdAt": contributions[0].created_at,
        }
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
    consentGiven: Annotated[str, Form()],
    consentPolicyVersion: Annotated[str, Form()],
    audio: Annotated[UploadFile, File()],
    sentence_id: Annotated[str | None, Form(alias="sentenceId")] = None,
    audioDurationSeconds: Annotated[float | None, Form(ge=0)] = None,
) -> ContributionCreatedResponse | JSONResponse:
    """Accept one guided recording using the existing frontend field names."""

    staged_audio: StagedAudioUpload | None = None
    try:
        profile = get_or_create_profile(
            database=database,
            authenticated_user=user,
        )
        staged_audio = await read_bounded_upload(
            audio,
            settings.max_audio_upload_bytes,
        )
        contribution_input = GuidedContributionInput(
            contributor_name=contributor_name,
            language=language,
            sentence=sentence,
            sentence_source=sentence_source,
            sentence_id=sentence_id,
            consent_given=consentGiven,
            consent_policy_version=consentPolicyVersion,
            audio_filename=audio.filename or "recording",
            audio_mime_type=audio.content_type or "",
            audio_content=None,
            audio_duration_seconds=audioDurationSeconds,
            staged_audio=staged_audio,
        )
        contribution = create_guided_contribution(
            database,
            contribution_input,
            owner_user_id=profile.id,
        )
    except ProfileServiceError:
        raise
    except (ContributionServiceError, AudioValidationError, AudioStorageError) as error:
        return _safe_error_response(error)
    except Exception:
        database.rollback()
        return _safe_error_response(ContributionCreationError())
    finally:
        cleanup_staged_audio(staged_audio)
        try:
            await audio.close()
        except Exception:
            pass

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
    consentGiven: Annotated[str, Form()],
    consentPolicyVersion: Annotated[str, Form()],
    audio: Annotated[UploadFile, File()],
    topic: Annotated[str | None, Form()] = None,
    audioDurationSeconds: Annotated[float | None, Form(ge=0)] = None,
) -> ContributionCreatedResponse | JSONResponse:
    """Accept one consented open recording with an optional topic."""

    creation_error = ContributionCreationError()
    staged_audio: StagedAudioUpload | None = None
    try:
        profile = get_or_create_profile(
            database=database,
            authenticated_user=user,
        )
        staged_audio = await read_bounded_upload(
            audio,
            settings.max_audio_upload_bytes,
        )
        contribution_input = OpenRecordingInput(
            contributor_name=contributorName,
            language=language,
            topic=topic,
            consent_given=consentGiven,
            consent_policy_version=consentPolicyVersion,
            audio_filename=audio.filename or "recording",
            audio_mime_type=audio.content_type or "",
            audio_content=None,
            audio_duration_seconds=audioDurationSeconds,
            staged_audio=staged_audio,
        )
        contribution = create_open_recording(
            database,
            contribution_input,
            owner_user_id=profile.id,
        )
    except ProfileServiceError:
        raise
    except (ContributionServiceError, AudioValidationError, AudioStorageError) as error:
        return _safe_error_response(error)
    except Exception:
        database.rollback()
        return _safe_error_response(creation_error)
    finally:
        cleanup_staged_audio(staged_audio)
        try:
            await audio.close()
        except Exception:
            pass

    return ContributionCreatedResponse.model_validate(contribution)


@router.get("/me", response_model=MyContributionListResponse)
def get_my_contributions(
    user: Annotated[AuthenticatedUser, Depends(require_authenticated_user)],
    database: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    review_status: Annotated[str, Query(alias="status")] = "all",
) -> MyContributionListResponse | JSONResponse:
    """Return only the verified caller's contribution history."""

    try:
        items, total = get_user_contributions(
            database=database,
            owner_user_id=user.id,
            limit=limit,
            offset=offset,
            review_status=review_status,
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


@router.get("/me/{contribution_id}/audio", response_model=None)
def get_my_contribution_audio(
    contribution_id: str,
    user: Annotated[AuthenticatedUser, Depends(require_authenticated_user)],
    database: Annotated[Session, Depends(get_db)],
) -> FileResponse | JSONResponse:
    """Stream one private contribution recording only to its verified owner."""

    try:
        audio_file = get_user_contribution_audio_file(
            database=database,
            owner_user_id=user.id,
            contribution_id=contribution_id,
        )
    except ContributionServiceError as error:
        return _safe_error_response(error)
    return FileResponse(
        path=audio_file.path,
        media_type=audio_file.mime_type,
        filename=audio_file.filename,
        content_disposition_type="inline",
    )
