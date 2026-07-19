"""Service tests for open-recording validation and atomic storage."""

from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

import app.services.contribution_service as contribution_service_module
from app.config import settings
from app.consent import CONSENT_POLICY_VERSION
from app.models import Contribution
from app.schemas import ContributionCreatedResponse
from app.services.audio_storage import (
    AudioStorageError,
    resolve_audio_storage_path,
)
from app.services.contribution_service import (
    AudioStorageFailedError,
    ConsentRequiredError,
    ContributionCreationError,
    InvalidContributionLanguageError,
    InvalidConsentPolicyVersionError,
    InvalidContributorNameError,
    InvalidRecordingTopicError,
    OpenRecordingInput,
    create_open_recording as create_owned_open_recording,
)
from app.utils.audio_validation import (
    AudioExtensionMismatchError,
    AudioFileTooLargeError,
    EmptyAudioFileError,
    InvalidAudioSignatureError,
    UnsupportedAudioTypeError,
)


WEBM_BYTES = b"\x1a\x45\xdf\xa3open-webm"
OGG_BYTES = b"OggSopen-ogg"
MP3_BYTES = b"ID3open-mp3"
M4A_BYTES = b"\x00\x00\x00\x18ftypM4A open-m4a"
OWNER_USER_ID = "0d5dd8f5-93df-462b-b234-a16973089092"


def create_open_recording(
    database: Session,
    contribution_input: OpenRecordingInput,
) -> Contribution:
    """Exercise the service with ownership trusted separately from form data."""

    return create_owned_open_recording(
        database,
        contribution_input,
        owner_user_id=OWNER_USER_ID,
    )


def open_input(**values: object) -> OpenRecordingInput:
    defaults: dict[str, object] = {
        "contributor_name": "Faisal Imran",
        "language": "Pashto",
        "topic": "زما د کلي یوه کیسه",
        "consent_given": "true",
        "consent_policy_version": CONSENT_POLICY_VERSION,
        "audio_filename": "recording.webm",
        "audio_mime_type": "audio/webm",
        "audio_content": WEBM_BYTES,
    }
    defaults.update(values)
    return OpenRecordingInput(**defaults)


def contribution_count(database: Session) -> int:
    return database.scalar(select(func.count()).select_from(Contribution)) or 0


@pytest.mark.parametrize(
    ("filename", "mime_type", "content", "extension"),
    [
        ("recording.webm", "audio/webm", WEBM_BYTES, "webm"),
        ("recording.ogg", "audio/ogg", OGG_BYTES, "ogg"),
        ("recording.mp3", "audio/mpeg", MP3_BYTES, "mp3"),
        ("recording.m4a", "audio/mp4", M4A_BYTES, "m4a"),
    ],
)
def test_supported_open_audio_is_created_and_stored(
    filename: str,
    mime_type: str,
    content: bytes,
    extension: str,
    db_session: Session,
) -> None:
    contribution = create_open_recording(
        db_session,
        open_input(
            audio_filename=filename,
            audio_mime_type=mime_type,
            audio_content=content,
        ),
    )

    stored_path = resolve_audio_storage_path(contribution.audio_storage_key)
    assert contribution.contribution_type == "open_recording"
    assert contribution.status == "queued"
    assert contribution.consent_given is True
    assert contribution.consent_policy_version == CONSENT_POLICY_VERSION
    assert contribution.consent_timestamp == contribution.created_at
    assert contribution.sentence_id is None
    assert contribution.sentence_text is None
    assert contribution.sentence_source is None
    assert contribution.duration_seconds is None
    assert contribution.audio_storage_key.endswith(f".{extension}")
    assert not Path(contribution.audio_storage_key).is_absolute()
    assert stored_path.read_bytes() == content


def test_open_metadata_is_normalized_and_exact(db_session: Session) -> None:
    contribution = create_open_recording(
        db_session,
        open_input(
            contributor_name="  Faisal  Imran  ",
            language="  pASHTO  ",
            audio_filename="../../Recording.WEBM",
            audio_mime_type=" Audio/WebM; codecs=opus ",
        ),
    )

    assert contribution.contributor_name == "Faisal  Imran"
    assert contribution.language == "Pashto"
    assert contribution.original_filename == "Recording.WEBM"
    assert contribution.mime_type == "audio/webm"
    assert contribution.file_size == len(WEBM_BYTES)


@pytest.mark.parametrize("topic", [None, "", "   "])
def test_absent_or_blank_topic_is_stored_as_null(
    topic: str | None, db_session: Session
) -> None:
    contribution = create_open_recording(
        db_session,
        open_input(topic=topic),
    )

    assert contribution.topic is None


def test_topic_is_trimmed_and_preserves_unicode_and_punctuation(
    db_session: Session,
) -> None:
    topic = "  زما د کلي یوه کیسه: دود، کرنه او ژوند!  "

    contribution = create_open_recording(
        db_session,
        open_input(topic=topic),
    )

    assert contribution.topic == topic.strip()


@pytest.mark.parametrize("contributor_name", ["x", "x" * 101])
def test_invalid_contributor_name_is_rejected(
    contributor_name: str, db_session: Session
) -> None:
    with pytest.raises(InvalidContributorNameError):
        create_open_recording(
            db_session,
            open_input(contributor_name=contributor_name),
        )


def test_blank_language_is_rejected(db_session: Session) -> None:
    with pytest.raises(InvalidContributionLanguageError):
        create_open_recording(db_session, open_input(language="   "))


@pytest.mark.parametrize("topic", ["x", "x" * 201])
def test_invalid_topic_length_is_rejected(
    topic: str, db_session: Session
) -> None:
    with pytest.raises(InvalidRecordingTopicError):
        create_open_recording(db_session, open_input(topic=topic))


@pytest.mark.parametrize("consent", [None, False, "false", "0", "no", "off"])
def test_false_or_missing_consent_is_rejected(
    consent: str | bool | None, db_session: Session
) -> None:
    with pytest.raises(ConsentRequiredError):
        create_open_recording(db_session, open_input(consent_given=consent))


def test_noncurrent_consent_version_is_rejected(db_session: Session) -> None:
    with pytest.raises(InvalidConsentPolicyVersionError):
        create_open_recording(
            db_session,
            open_input(consent_policy_version="0.9"),
        )


def test_unsupported_audio_type_is_rejected(db_session: Session) -> None:
    with pytest.raises(UnsupportedAudioTypeError):
        create_open_recording(
            db_session,
            open_input(
                audio_filename="recording.bin",
                audio_mime_type="application/octet-stream",
            ),
        )


def test_invalid_audio_signature_is_rejected(db_session: Session) -> None:
    with pytest.raises(InvalidAudioSignatureError):
        create_open_recording(
            db_session,
            open_input(audio_content=b"not-webm"),
        )


def test_contradictory_audio_extension_is_rejected(db_session: Session) -> None:
    with pytest.raises(AudioExtensionMismatchError):
        create_open_recording(
            db_session,
            open_input(audio_filename="recording.wav"),
        )


def test_empty_audio_is_rejected(db_session: Session) -> None:
    with pytest.raises(EmptyAudioFileError):
        create_open_recording(db_session, open_input(audio_content=b""))


def test_audio_over_open_limit_is_rejected(
    monkeypatch: pytest.MonkeyPatch, db_session: Session
) -> None:
    monkeypatch.setattr(settings, "max_open_audio_size_mb", 1 / (1024 * 1024))

    with pytest.raises(AudioFileTooLargeError):
        create_open_recording(db_session, open_input())


def test_audio_above_guided_but_within_open_limit_succeeds(
    monkeypatch: pytest.MonkeyPatch, db_session: Session
) -> None:
    monkeypatch.setattr(settings, "max_guided_audio_size_mb", 4 / (1024 * 1024))
    monkeypatch.setattr(
        settings,
        "max_open_audio_size_mb",
        len(WEBM_BYTES) / (1024 * 1024),
    )

    contribution = create_open_recording(db_session, open_input())

    assert contribution.file_size == len(WEBM_BYTES)


def test_database_failure_removes_audio_and_row(
    monkeypatch: pytest.MonkeyPatch,
    db_session: Session,
    test_storage_root: Path,
) -> None:
    monkeypatch.setattr(
        db_session,
        "commit",
        lambda: (_ for _ in ()).throw(RuntimeError("simulated database failure")),
    )

    with pytest.raises(ContributionCreationError) as error:
        create_open_recording(db_session, open_input())

    assert str(error.value) == "The open recording could not be completed."
    assert contribution_count(db_session) == 0
    assert list((test_storage_root / "audio").rglob("*.*")) == []


def test_storage_failure_leaves_no_contribution(
    monkeypatch: pytest.MonkeyPatch, db_session: Session
) -> None:
    monkeypatch.setattr(
        contribution_service_module,
        "save_audio_file",
        lambda **_: (_ for _ in ()).throw(AudioStorageError()),
    )

    with pytest.raises(AudioStorageFailedError):
        create_open_recording(db_session, open_input())

    assert contribution_count(db_session) == 0


def test_public_response_uses_only_safe_camel_case_fields(
    db_session: Session,
) -> None:
    contribution = create_open_recording(db_session, open_input())
    response = ContributionCreatedResponse.model_validate(contribution).model_dump(
        mode="json"
    )

    assert set(response) == {"id", "status", "createdAt"}
    assert response["createdAt"].endswith("Z")
    assert "audio_storage_key" not in response
