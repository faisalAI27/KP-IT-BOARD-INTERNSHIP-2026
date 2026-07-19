"""Validation and transactional creation for voice contributions."""

from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.config import settings
from app.consent import CONSENT_POLICY_VERSION
from app.models import Contribution, Sentence
from app.services.audio_storage import (
    AudioStorageError,
    delete_audio_file,
    save_audio_file,
)
from app.utils.audio_validation import ValidatedAudio, validate_audio_upload
from app.utils.text_normalization import (
    clean_sentence_text,
    normalize_language_name,
    normalize_sentence_text,
)
from app.services.withdrawal_service import (
    WithdrawalServiceError,
    attach_withdrawal_statuses,
)


TRUE_CONSENT_VALUES = frozenset({"true", "1", "yes", "on"})


class ContributionServiceError(Exception):
    """Base contribution error with safe API metadata."""

    code = "CONTRIBUTION_SERVICE_ERROR"
    default_message = "The voice contribution could not be processed."
    http_status = 400

    def __init__(self, message: str | None = None) -> None:
        self.message = message or self.default_message
        super().__init__(self.message)


class InvalidContributorNameError(ContributionServiceError):
    code = "INVALID_CONTRIBUTOR_NAME"
    default_message = "Contributor name must contain between 2 and 100 characters."


class InvalidContributionLanguageError(ContributionServiceError):
    code = "INVALID_CONTRIBUTION_LANGUAGE"
    default_message = "A valid contribution language is required."


class InvalidContributionSentenceError(ContributionServiceError):
    code = "INVALID_CONTRIBUTION_SENTENCE"
    default_message = "The sentence must contain between 3 and 500 characters."


class InvalidRecordingTopicError(ContributionServiceError):
    code = "INVALID_RECORDING_TOPIC"
    default_message = "Recording topic must contain between 2 and 200 characters."


class InvalidSentenceSourceError(ContributionServiceError):
    code = "INVALID_SENTENCE_SOURCE"
    default_message = "Sentence source must be provided or custom."


class ConsentRequiredError(ContributionServiceError):
    code = "CONSENT_REQUIRED"
    default_message = "Please confirm the contribution consent before submitting."


class InvalidConsentPolicyVersionError(ContributionServiceError):
    code = "CONSENT_POLICY_VERSION_INVALID"
    default_message = "Please review and accept the current contribution consent."


class InvalidSentenceIdError(ContributionServiceError):
    code = "INVALID_SENTENCE_ID"
    default_message = "The sentence ID is invalid."


class SentenceIdRequiredError(ContributionServiceError):
    code = "SENTENCE_ID_REQUIRED"
    default_message = "Select an active contribution phrase before submitting."


class SentenceNotFoundError(ContributionServiceError):
    code = "SENTENCE_NOT_FOUND"
    default_message = "The requested active sentence was not found."
    http_status = 404


class SentenceLanguageMismatchError(ContributionServiceError):
    code = "SENTENCE_LANGUAGE_MISMATCH"
    default_message = "The sentence language does not match the contribution language."


class SentenceTextMismatchError(ContributionServiceError):
    code = "SENTENCE_TEXT_MISMATCH"
    default_message = "The submitted sentence does not match the requested sentence."


class CustomSentenceIdNotAllowedError(ContributionServiceError):
    code = "CUSTOM_SENTENCE_ID_NOT_ALLOWED"
    default_message = "A custom sentence must not include a sentence ID."


class AudioStorageFailedError(ContributionServiceError):
    code = "AUDIO_STORAGE_FAILED"
    default_message = "The contribution audio could not be stored."
    http_status = 500


class ContributionCreationError(ContributionServiceError):
    code = "CONTRIBUTION_CREATION_FAILED"
    default_message = "The voice contribution could not be completed."
    http_status = 500


class ContributionQueryError(ContributionServiceError):
    code = "CONTRIBUTION_QUERY_FAILED"
    default_message = "Contribution history could not be loaded."
    http_status = 500


@dataclass(frozen=True, slots=True)
class GuidedContributionInput:
    """Framework-independent input for one guided voice contribution."""

    contributor_name: str
    language: str
    sentence: str
    sentence_source: str
    sentence_id: str | None
    consent_given: str | bool | None
    consent_policy_version: str | None
    audio_filename: str
    audio_mime_type: str
    audio_content: bytes


@dataclass(frozen=True, slots=True)
class OpenRecordingInput:
    """Framework-independent input for one open recording."""

    contributor_name: str
    language: str
    topic: str | None
    consent_given: str | bool | None
    consent_policy_version: str | None
    audio_filename: str
    audio_mime_type: str
    audio_content: bytes


def _validate_contributor_name(contributor_name: str) -> str:
    if not isinstance(contributor_name, str):
        raise InvalidContributorNameError()
    cleaned_name = contributor_name.strip()
    if not 2 <= len(cleaned_name) <= 100:
        raise InvalidContributorNameError()
    return cleaned_name


def _validate_language(language: str) -> str:
    try:
        normalized_language = normalize_language_name(language)
    except (TypeError, ValueError) as error:
        raise InvalidContributionLanguageError() from error
    if len(normalized_language) > 100:
        raise InvalidContributionLanguageError()
    return normalized_language


def _validate_sentence(sentence: str) -> str:
    try:
        cleaned_sentence = clean_sentence_text(sentence)
    except TypeError as error:
        raise InvalidContributionSentenceError() from error
    if not 3 <= len(cleaned_sentence) <= 500:
        raise InvalidContributionSentenceError()
    return cleaned_sentence


def _validate_recording_topic(topic: str | None) -> str | None:
    if topic is None:
        return None
    if not isinstance(topic, str):
        raise InvalidRecordingTopicError()

    cleaned_topic = topic.strip()
    if not cleaned_topic:
        return None
    if not 2 <= len(cleaned_topic) <= 200:
        raise InvalidRecordingTopicError()
    return cleaned_topic


def _validate_sentence_source(sentence_source: str) -> str:
    if not isinstance(sentence_source, str):
        raise InvalidSentenceSourceError()
    normalized_source = sentence_source.strip().lower()
    if normalized_source not in {"provided", "custom"}:
        raise InvalidSentenceSourceError()
    return normalized_source


def _validate_consent(
    consent_given: str | bool | None,
    consent_policy_version: str | None,
) -> str:
    valid_consent = consent_given is True or (
        isinstance(consent_given, str)
        and consent_given.strip().lower() in TRUE_CONSENT_VALUES
    )
    if not valid_consent:
        raise ConsentRequiredError()

    normalized_version = (
        consent_policy_version.strip()
        if isinstance(consent_policy_version, str)
        else ""
    )
    if normalized_version != CONSENT_POLICY_VERSION:
        raise InvalidConsentPolicyVersionError()
    return CONSENT_POLICY_VERSION


def _validate_optional_sentence(
    database: Session,
    *,
    sentence_id: str | None,
    sentence_source: str,
    language: str,
    submitted_sentence: str,
) -> tuple[str | None, str]:
    cleaned_sentence_id = sentence_id.strip() if isinstance(sentence_id, str) else ""

    if sentence_source == "custom":
        if cleaned_sentence_id:
            raise CustomSentenceIdNotAllowedError()
        return None, submitted_sentence

    if not cleaned_sentence_id:
        raise SentenceIdRequiredError()

    try:
        canonical_sentence_id = str(UUID(cleaned_sentence_id))
    except (ValueError, TypeError, AttributeError) as error:
        raise InvalidSentenceIdError() from error

    stored_sentence = database.get(Sentence, canonical_sentence_id)
    if stored_sentence is None or not stored_sentence.is_active:
        raise SentenceNotFoundError()
    if normalize_language_name(stored_sentence.language) != language:
        raise SentenceLanguageMismatchError()
    if normalize_sentence_text(stored_sentence.text) != normalize_sentence_text(
        submitted_sentence
    ):
        raise SentenceTextMismatchError()

    return stored_sentence.id, stored_sentence.text


def _persist_contribution(
    database: Session,
    *,
    owner_user_id: str,
    contribution_type: str,
    contributor_name: str,
    language: str,
    sentence_id: str | None,
    sentence_text: str | None,
    sentence_source: str | None,
    topic: str | None,
    consent_policy_version: str,
    audio_content: bytes,
    validated_audio: ValidatedAudio,
    creation_failure_message: str | None = None,
) -> Contribution:
    """Store validated audio and atomically persist its contribution metadata."""

    contribution_id = str(uuid4())
    created_at = datetime.now(timezone.utc)
    try:
        storage_key = save_audio_file(
            contribution_id=contribution_id,
            extension=validated_audio.extension,
            content=audio_content,
            created_at=created_at,
        )
    except AudioStorageError as error:
        database.rollback()
        raise AudioStorageFailedError() from error

    contribution = Contribution(
        id=contribution_id,
        user_id=owner_user_id,
        contribution_type=contribution_type,
        contributor_name=contributor_name,
        language=language,
        sentence_id=sentence_id,
        sentence_text=sentence_text,
        sentence_source=sentence_source,
        topic=topic,
        consent_given=True,
        consent_policy_version=consent_policy_version,
        consent_timestamp=created_at,
        audio_storage_key=storage_key,
        original_filename=validated_audio.original_filename,
        mime_type=validated_audio.mime_type,
        file_size=validated_audio.file_size,
        duration_seconds=None,
        status="queued",
        created_at=created_at,
        updated_at=created_at,
    )

    try:
        database.add(contribution)
        database.commit()
    except Exception as error:
        database.rollback()
        try:
            delete_audio_file(storage_key)
        except AudioStorageError:
            pass
        raise ContributionCreationError(creation_failure_message) from error

    try:
        database.refresh(contribution)
    except Exception:
        # expire_on_commit=False keeps the committed response fields available.
        pass
    return contribution


def create_guided_contribution(
    database: Session,
    contribution_input: GuidedContributionInput,
    *,
    owner_user_id: str,
) -> Contribution:
    """Validate, store audio, and commit one guided contribution."""

    contributor_name = _validate_contributor_name(
        contribution_input.contributor_name
    )
    language = _validate_language(contribution_input.language)
    sentence = _validate_sentence(contribution_input.sentence)
    sentence_source = _validate_sentence_source(
        contribution_input.sentence_source
    )
    consent_policy_version = _validate_consent(
        contribution_input.consent_given,
        contribution_input.consent_policy_version,
    )
    verified_sentence_id, sentence_snapshot = _validate_optional_sentence(
        database,
        sentence_id=contribution_input.sentence_id,
        sentence_source=sentence_source,
        language=language,
        submitted_sentence=sentence,
    )
    validated_audio = validate_audio_upload(
        filename=contribution_input.audio_filename,
        mime_type=contribution_input.audio_mime_type,
        content=contribution_input.audio_content,
        max_size_mb=settings.max_guided_audio_size_mb,
    )

    return _persist_contribution(
        database,
        owner_user_id=owner_user_id,
        contribution_type="guided",
        contributor_name=contributor_name,
        language=language,
        sentence_id=verified_sentence_id,
        sentence_text=sentence_snapshot,
        sentence_source=sentence_source,
        topic=None,
        consent_policy_version=consent_policy_version,
        audio_content=contribution_input.audio_content,
        validated_audio=validated_audio,
    )


def create_open_recording(
    database: Session,
    contribution_input: OpenRecordingInput,
    *,
    owner_user_id: str,
) -> Contribution:
    """Validate, store audio, and commit one open recording."""

    contributor_name = _validate_contributor_name(
        contribution_input.contributor_name
    )
    language = _validate_language(contribution_input.language)
    topic = _validate_recording_topic(contribution_input.topic)
    consent_policy_version = _validate_consent(
        contribution_input.consent_given,
        contribution_input.consent_policy_version,
    )
    validated_audio = validate_audio_upload(
        filename=contribution_input.audio_filename,
        mime_type=contribution_input.audio_mime_type,
        content=contribution_input.audio_content,
        max_size_mb=settings.max_open_audio_size_mb,
    )

    return _persist_contribution(
        database,
        owner_user_id=owner_user_id,
        contribution_type="open_recording",
        contributor_name=contributor_name,
        language=language,
        sentence_id=None,
        sentence_text=None,
        sentence_source=None,
        topic=topic,
        consent_policy_version=consent_policy_version,
        audio_content=contribution_input.audio_content,
        validated_audio=validated_audio,
        creation_failure_message="The open recording could not be completed.",
    )


def get_user_contributions(
    *,
    database: Session,
    owner_user_id: str,
    limit: int,
    offset: int,
) -> tuple[list[Contribution], int]:
    """Return one owner's page using ownership filtering in the database."""

    ownership_filter = Contribution.user_id == owner_user_id
    try:
        total = database.scalar(
            select(func.count()).select_from(Contribution).where(ownership_filter)
        )
        items = list(
            database.scalars(
                select(Contribution)
                .where(ownership_filter)
                .order_by(Contribution.created_at.desc(), Contribution.id.desc())
                .limit(limit)
                .offset(offset)
            ).all()
        )
        attach_withdrawal_statuses(
            database=database,
            owner_user_id=owner_user_id,
            contributions=items,
        )
    except (SQLAlchemyError, WithdrawalServiceError) as error:
        database.rollback()
        raise ContributionQueryError() from error
    return items, int(total or 0)
