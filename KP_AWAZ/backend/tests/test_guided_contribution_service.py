"""Service-level tests for guided contribution validation and atomic storage."""

from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

import app.services.contribution_service as contribution_service_module
from app.config import settings
from app.models import Contribution, Sentence
from app.schemas import ContributionCreatedResponse
from app.services.audio_storage import (
    AudioStorageError,
    resolve_audio_storage_path,
)
from app.services.contribution_service import (
    AudioStorageFailedError,
    ConsentRequiredError,
    ContributionCreationError,
    CustomSentenceIdNotAllowedError,
    GuidedContributionInput,
    InvalidContributionLanguageError,
    InvalidContributionSentenceError,
    InvalidContributorNameError,
    InvalidSentenceIdError,
    InvalidSentenceSourceError,
    SentenceLanguageMismatchError,
    SentenceNotFoundError,
    SentenceTextMismatchError,
    create_guided_contribution,
)
from app.utils.audio_validation import (
    AudioFileTooLargeError,
    InvalidAudioSignatureError,
    UnsupportedAudioTypeError,
)
from app.utils.text_normalization import normalize_sentence_text


WEBM_BYTES = b"\x1a\x45\xdf\xa3guided-webm"
OGG_BYTES = b"OggSguided-ogg"
MP3_BYTES = b"ID3guided-mp3"
M4A_BYTES = b"\x00\x00\x00\x18ftypM4A guided-m4a"


def guided_input(**values: object) -> GuidedContributionInput:
    defaults: dict[str, object] = {
        "contributor_name": "Faisal Imran",
        "language": "Pashto",
        "sentence": "هر غږ ارزښت لري.",
        "sentence_source": "provided",
        "sentence_id": None,
        "consent": "true",
        "audio_filename": "recording.webm",
        "audio_mime_type": "audio/webm",
        "audio_content": WEBM_BYTES,
    }
    defaults.update(values)
    return GuidedContributionInput(**defaults)


def add_sentence(
    database: Session,
    *,
    text: str = "هر غږ ارزښت لري.",
    language: str = "Pashto",
    is_active: bool = True,
) -> Sentence:
    sentence = Sentence(
        language=language,
        text=text,
        meaning=None,
        normalized_text=normalize_sentence_text(text),
        source_type="custom",
        source_filename=None,
        is_active=is_active,
    )
    database.add(sentence)
    database.commit()
    return sentence


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
def test_supported_guided_audio_is_created_and_stored(
    filename: str,
    mime_type: str,
    content: bytes,
    extension: str,
    db_session: Session,
) -> None:
    contribution = create_guided_contribution(
        db_session,
        guided_input(
            audio_filename=filename,
            audio_mime_type=mime_type,
            audio_content=content,
        ),
    )

    stored_path = resolve_audio_storage_path(contribution.audio_storage_key)
    assert contribution.contribution_type == "guided"
    assert contribution.status == "queued"
    assert contribution.consent_given is True
    assert contribution.topic is None
    assert contribution.duration_seconds is None
    assert contribution.audio_storage_key.endswith(f".{extension}")
    assert not Path(contribution.audio_storage_key).is_absolute()
    assert stored_path.read_bytes() == content


def test_audio_and_contributor_metadata_are_normalized(db_session: Session) -> None:
    contribution = create_guided_contribution(
        db_session,
        guided_input(
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


def test_pashto_sentence_snapshot_preserves_punctuation_and_diacritics(
    db_session: Session,
) -> None:
    text = "  مُحَمَّد وایي: هر غږ ارزښت لري!  "
    contribution = create_guided_contribution(
        db_session,
        guided_input(sentence=text, sentence_source="custom"),
    )

    assert contribution.sentence_text == text.strip()
    assert contribution.sentence_id is None


def test_custom_sentence_stores_null_id(db_session: Session) -> None:
    contribution = create_guided_contribution(
        db_session,
        guided_input(sentence_source=" CUSTOM ", sentence_id="   "),
    )

    assert contribution.sentence_source == "custom"
    assert contribution.sentence_id is None


def test_provided_sentence_without_id_succeeds(db_session: Session) -> None:
    contribution = create_guided_contribution(db_session, guided_input())

    assert contribution.sentence_source == "provided"
    assert contribution.sentence_id is None
    assert contribution.sentence_text == "هر غږ ارزښت لري."


def test_valid_provided_sentence_id_creates_relationship(
    db_session: Session,
) -> None:
    sentence = add_sentence(db_session)
    contribution = create_guided_contribution(
        db_session,
        guided_input(sentence_id=sentence.id),
    )

    assert contribution.sentence_id == sentence.id
    assert contribution.sentence is sentence


def test_valid_sentence_id_uses_canonical_database_snapshot(
    db_session: Session,
) -> None:
    sentence = add_sentence(db_session, text="زما   ژبه زما پېژندنه ده.")
    contribution = create_guided_contribution(
        db_session,
        guided_input(
            sentence_id=sentence.id,
            sentence="زما ژبه زما پېژندنه ده.",
        ),
    )

    assert contribution.sentence_text == "زما   ژبه زما پېژندنه ده."


def test_invalid_sentence_uuid_is_rejected(db_session: Session) -> None:
    with pytest.raises(InvalidSentenceIdError):
        create_guided_contribution(
            db_session,
            guided_input(sentence_id="not-a-uuid"),
        )


def test_missing_sentence_record_is_rejected(db_session: Session) -> None:
    with pytest.raises(SentenceNotFoundError):
        create_guided_contribution(
            db_session,
            guided_input(sentence_id=str(uuid4())),
        )


def test_inactive_sentence_is_rejected(db_session: Session) -> None:
    sentence = add_sentence(db_session, is_active=False)

    with pytest.raises(SentenceNotFoundError):
        create_guided_contribution(
            db_session,
            guided_input(sentence_id=sentence.id),
        )


def test_sentence_language_mismatch_is_rejected(db_session: Session) -> None:
    sentence = add_sentence(db_session, language="Urdu")

    with pytest.raises(SentenceLanguageMismatchError):
        create_guided_contribution(
            db_session,
            guided_input(sentence_id=sentence.id, language="Pashto"),
        )


def test_sentence_text_mismatch_is_rejected(db_session: Session) -> None:
    sentence = add_sentence(db_session)

    with pytest.raises(SentenceTextMismatchError):
        create_guided_contribution(
            db_session,
            guided_input(sentence_id=sentence.id, sentence="بله جمله"),
        )


def test_custom_sentence_with_id_is_rejected(db_session: Session) -> None:
    with pytest.raises(CustomSentenceIdNotAllowedError):
        create_guided_contribution(
            db_session,
            guided_input(sentence_source="custom", sentence_id=str(uuid4())),
        )


def test_invalid_sentence_source_is_rejected(db_session: Session) -> None:
    with pytest.raises(InvalidSentenceSourceError):
        create_guided_contribution(
            db_session,
            guided_input(sentence_source="unknown"),
        )


@pytest.mark.parametrize("consent", [None, False, "false", "0", "no", "off"])
def test_missing_or_false_consent_is_rejected(
    consent: str | bool | None, db_session: Session
) -> None:
    with pytest.raises(ConsentRequiredError):
        create_guided_contribution(db_session, guided_input(consent=consent))


@pytest.mark.parametrize("consent", [True, "true", "1", "yes", "on", " YES "])
def test_true_consent_representations_are_accepted(
    consent: str | bool, db_session: Session
) -> None:
    contribution = create_guided_contribution(
        db_session,
        guided_input(consent=consent),
    )

    assert contribution.consent_given is True


@pytest.mark.parametrize("contributor_name", ["x", " ", "x" * 101])
def test_invalid_contributor_name_is_rejected(
    contributor_name: str, db_session: Session
) -> None:
    with pytest.raises(InvalidContributorNameError):
        create_guided_contribution(
            db_session,
            guided_input(contributor_name=contributor_name),
        )


@pytest.mark.parametrize("language", ["", "   ", "x" * 101])
def test_invalid_language_is_rejected(language: str, db_session: Session) -> None:
    with pytest.raises(InvalidContributionLanguageError):
        create_guided_contribution(db_session, guided_input(language=language))


@pytest.mark.parametrize("sentence", ["ab", " ", "x" * 501])
def test_invalid_sentence_length_is_rejected(
    sentence: str, db_session: Session
) -> None:
    with pytest.raises(InvalidContributionSentenceError):
        create_guided_contribution(db_session, guided_input(sentence=sentence))


def test_unsupported_audio_type_is_rejected(db_session: Session) -> None:
    with pytest.raises(UnsupportedAudioTypeError):
        create_guided_contribution(
            db_session,
            guided_input(audio_filename="recording.exe", audio_mime_type="video/webm"),
        )


def test_invalid_audio_signature_is_rejected(db_session: Session) -> None:
    with pytest.raises(InvalidAudioSignatureError):
        create_guided_contribution(
            db_session,
            guided_input(audio_content=b"not-webm"),
        )


def test_oversized_audio_is_rejected(
    monkeypatch: pytest.MonkeyPatch, db_session: Session
) -> None:
    monkeypatch.setattr(settings, "max_guided_audio_size_mb", 1 / (1024 * 1024))

    with pytest.raises(AudioFileTooLargeError):
        create_guided_contribution(
            db_session,
            guided_input(audio_content=WEBM_BYTES),
        )


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

    with pytest.raises(ContributionCreationError):
        create_guided_contribution(db_session, guided_input())

    assert contribution_count(db_session) == 0
    assert list((test_storage_root / "audio").rglob("*.webm")) == []


def test_storage_failure_leaves_no_contribution(
    monkeypatch: pytest.MonkeyPatch, db_session: Session
) -> None:
    monkeypatch.setattr(
        contribution_service_module,
        "save_audio_file",
        lambda **_: (_ for _ in ()).throw(AudioStorageError()),
    )

    with pytest.raises(AudioStorageFailedError):
        create_guided_contribution(db_session, guided_input())

    assert contribution_count(db_session) == 0


def test_successful_response_schema_uses_only_public_fields(
    db_session: Session,
) -> None:
    contribution = create_guided_contribution(db_session, guided_input())
    response = ContributionCreatedResponse.model_validate(contribution).model_dump(
        mode="json"
    )

    assert set(response) == {"id", "status", "createdAt"}
    assert "audio_storage_key" not in response
    assert response["createdAt"].endswith("Z")
