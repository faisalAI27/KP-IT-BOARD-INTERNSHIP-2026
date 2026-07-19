"""Multipart endpoint tests for guided voice contributions."""

from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile as StarletteUploadFile

import app.routes.contributions as contribution_route_module
import app.services.contribution_service as contribution_service_module
from app.config import settings
from app.consent import CONSENT_POLICY_VERSION
from app.models import Contribution, Sentence
from app.services.audio_storage import AudioStorageError, resolve_audio_storage_path
from app.utils.text_normalization import normalize_sentence_text
from tests.conftest import TEST_AUTHORIZATION, authenticate_test_user


ENDPOINT = "/api/contributions/voice"
WEBM_BYTES = b"\x1a\x45\xdf\xa3guided-webm"


@pytest.fixture(autouse=True)
def authenticated_contributor() -> None:
    authenticate_test_user()


def valid_form_data() -> dict[str, str]:
    return {
        "contributorName": "Faisal Imran",
        "language": "Pashto",
        "sentence": "هر غږ ارزښت لري.",
        "sentenceSource": "custom",
        "consentGiven": "true",
        "consentPolicyVersion": CONSENT_POLICY_VERSION,
    }


def post_guided(
    client: TestClient,
    *,
    data: dict[str, str] | None = None,
    filename: str = "recording.webm",
    content: bytes = WEBM_BYTES,
    mime_type: str = "audio/webm",
    include_audio: bool = True,
):
    files = {"audio": (filename, content, mime_type)} if include_audio else None
    return client.post(
        ENDPOINT,
        headers=TEST_AUTHORIZATION,
        data=valid_form_data() if data is None else data,
        files=files,
    )


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


def test_valid_webm_returns_201_and_queued(client: TestClient) -> None:
    response = post_guided(client)

    assert response.status_code == 201
    assert response.json()["status"] == "queued"


def test_valid_custom_sentence_returns_201(client: TestClient) -> None:
    data = valid_form_data()
    data.update({"sentence": "زما خپله جمله ده.", "sentenceSource": "custom"})

    response = post_guided(client, data=data)

    assert response.status_code == 201


def test_provided_sentence_without_id_returns_400(client: TestClient) -> None:
    data = valid_form_data()
    data["sentenceSource"] = "provided"
    response = post_guided(client, data=data)

    assert response.status_code == 400
    assert response.json()["code"] == "SENTENCE_ID_REQUIRED"


def test_valid_provided_sentence_with_id_returns_201(
    client: TestClient, db_session: Session
) -> None:
    sentence = add_sentence(db_session)
    data = valid_form_data()
    data["sentenceSource"] = "provided"
    data["sentenceId"] = sentence.id

    response = post_guided(client, data=data)

    assert response.status_code == 201


def test_response_contains_only_public_camel_case_fields(client: TestClient) -> None:
    response = post_guided(client)

    assert set(response.json()) == {"id", "status", "createdAt"}
    assert response.json()["createdAt"].endswith("Z")
    assert "audio_storage_key" not in response.text


def test_database_record_is_created(client: TestClient, db_session: Session) -> None:
    response = post_guided(client)
    contribution = db_session.get(Contribution, response.json()["id"])

    assert contribution is not None
    assert contribution.contribution_type == "guided"
    assert contribution.consent_given is True
    assert contribution.consent_policy_version == CONSENT_POLICY_VERSION
    assert contribution.consent_timestamp is not None
    assert contribution.review_status == "pending"
    assert contribution.reviewed_at is None
    assert contribution.rejection_reason is None


def test_public_form_cannot_control_review_fields(
    client: TestClient,
    db_session: Session,
) -> None:
    data = valid_form_data()
    data.update(
        {
            "reviewStatus": "approved",
            "reviewedAt": "2020-01-01T00:00:00Z",
            "rejectionReason": "client supplied",
        }
    )

    response = post_guided(client, data=data)
    contribution = db_session.get(Contribution, response.json()["id"])

    assert response.status_code == 201
    assert contribution is not None
    assert contribution.review_status == "pending"
    assert contribution.reviewed_at is None
    assert contribution.rejection_reason is None


def test_audio_file_is_created(client: TestClient, db_session: Session) -> None:
    response = post_guided(client)
    contribution = db_session.get(Contribution, response.json()["id"])

    assert contribution is not None
    assert resolve_audio_storage_path(contribution.audio_storage_key).read_bytes() == WEBM_BYTES


@pytest.mark.parametrize(
    "missing_field",
    [
        "contributorName",
        "language",
        "sentence",
        "sentenceSource",
        "consentGiven",
        "consentPolicyVersion",
    ],
)
def test_missing_required_form_field_returns_422(
    missing_field: str, client: TestClient
) -> None:
    data = valid_form_data()
    data.pop(missing_field)

    response = post_guided(client, data=data)

    assert response.status_code == 422


def test_missing_audio_returns_422(client: TestClient) -> None:
    response = post_guided(client, include_audio=False)

    assert response.status_code == 422


@pytest.mark.parametrize("contributor_name", ["   ", "x", "x" * 101])
def test_invalid_contributor_name_returns_safe_400(
    contributor_name: str, client: TestClient
) -> None:
    data = valid_form_data()
    data["contributorName"] = contributor_name

    response = post_guided(client, data=data)

    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_CONTRIBUTOR_NAME"


def test_blank_language_returns_safe_400(client: TestClient) -> None:
    data = valid_form_data()
    data["language"] = "   "

    response = post_guided(client, data=data)

    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_CONTRIBUTION_LANGUAGE"


@pytest.mark.parametrize("sentence", ["ab", "x" * 501])
def test_invalid_sentence_length_returns_safe_400(
    sentence: str, client: TestClient
) -> None:
    data = valid_form_data()
    data["sentence"] = sentence

    response = post_guided(client, data=data)

    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_CONTRIBUTION_SENTENCE"


def test_invalid_sentence_source_returns_safe_400(client: TestClient) -> None:
    data = valid_form_data()
    data["sentenceSource"] = "unknown"

    response = post_guided(client, data=data)

    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_SENTENCE_SOURCE"


@pytest.mark.parametrize("consent", ["false", "0", "no", "off"])
def test_false_consent_returns_safe_400(consent: str, client: TestClient) -> None:
    data = valid_form_data()
    data["consentGiven"] = consent

    response = post_guided(client, data=data)

    assert response.status_code == 400
    assert response.json()["code"] == "CONSENT_REQUIRED"


def test_noncurrent_consent_policy_version_returns_safe_400(
    client: TestClient,
) -> None:
    data = valid_form_data()
    data["consentPolicyVersion"] = "0.9"

    response = post_guided(client, data=data)

    assert response.status_code == 400
    assert response.json()["code"] == "CONSENT_POLICY_VERSION_INVALID"


def test_custom_sentence_with_id_returns_400(client: TestClient) -> None:
    data = valid_form_data()
    data.update({"sentenceSource": "custom", "sentenceId": str(uuid4())})

    response = post_guided(client, data=data)

    assert response.status_code == 400
    assert response.json()["code"] == "CUSTOM_SENTENCE_ID_NOT_ALLOWED"


def test_invalid_sentence_id_returns_400(client: TestClient) -> None:
    data = valid_form_data()
    data["sentenceSource"] = "provided"
    data["sentenceId"] = "not-a-uuid"

    response = post_guided(client, data=data)

    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_SENTENCE_ID"


def test_unknown_sentence_id_returns_404(client: TestClient) -> None:
    data = valid_form_data()
    data["sentenceSource"] = "provided"
    data["sentenceId"] = str(uuid4())

    response = post_guided(client, data=data)

    assert response.status_code == 404
    assert response.json()["code"] == "SENTENCE_NOT_FOUND"


def test_inactive_sentence_id_returns_404(
    client: TestClient, db_session: Session
) -> None:
    sentence = add_sentence(db_session, is_active=False)
    data = valid_form_data()
    data["sentenceSource"] = "provided"
    data["sentenceId"] = sentence.id

    response = post_guided(client, data=data)

    assert response.status_code == 404
    assert response.json()["code"] == "SENTENCE_NOT_FOUND"


def test_sentence_language_mismatch_returns_400(
    client: TestClient, db_session: Session
) -> None:
    sentence = add_sentence(db_session, language="Urdu")
    data = valid_form_data()
    data["sentenceSource"] = "provided"
    data["sentenceId"] = sentence.id

    response = post_guided(client, data=data)

    assert response.status_code == 400
    assert response.json()["code"] == "SENTENCE_LANGUAGE_MISMATCH"


def test_sentence_text_mismatch_returns_400(
    client: TestClient, db_session: Session
) -> None:
    sentence = add_sentence(db_session)
    data = valid_form_data()
    data.update(
        {
            "sentenceSource": "provided",
            "sentenceId": sentence.id,
            "sentence": "بله جمله",
        }
    )

    response = post_guided(client, data=data)

    assert response.status_code == 400
    assert response.json()["code"] == "SENTENCE_TEXT_MISMATCH"


def test_empty_audio_returns_400(client: TestClient) -> None:
    response = post_guided(client, content=b"")

    assert response.status_code == 400
    assert response.json()["code"] == "EMPTY_AUDIO_FILE"


def test_unsupported_mime_returns_415(client: TestClient) -> None:
    response = post_guided(
        client,
        filename="recording.bin",
        mime_type="application/octet-stream",
    )

    assert response.status_code == 415
    assert response.json()["code"] == "UNSUPPORTED_AUDIO_TYPE"


def test_oversized_audio_returns_413(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "max_guided_audio_size_mb", 1 / (1024 * 1024))

    response = post_guided(client, content=WEBM_BYTES)

    assert response.status_code == 413
    assert response.json()["code"] == "AUDIO_FILE_TOO_LARGE"


def test_audio_reader_stops_at_limit_plus_one_byte(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    requested_sizes: list[int] = []
    original_read = StarletteUploadFile.read
    monkeypatch.setattr(settings, "max_guided_audio_size_mb", 1 / (1024 * 1024))

    async def tracking_read(upload, size=-1):
        requested_sizes.append(size)
        return await original_read(upload, size)

    monkeypatch.setattr(StarletteUploadFile, "read", tracking_read)

    response = post_guided(client, content=WEBM_BYTES)

    assert response.status_code == 413
    assert requested_sizes == [2]


def test_contradictory_extension_returns_400(client: TestClient) -> None:
    response = post_guided(client, filename="recording.wav")

    assert response.status_code == 400
    assert response.json()["code"] == "AUDIO_EXTENSION_MISMATCH"


def test_invalid_signature_returns_400(client: TestClient) -> None:
    response = post_guided(client, content=b"not-webm")

    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_AUDIO_SIGNATURE"


def test_malicious_filename_is_reduced_to_safe_metadata(
    client: TestClient, db_session: Session
) -> None:
    response = post_guided(client, filename="../../recording.webm")
    contribution = db_session.get(Contribution, response.json()["id"])

    assert response.status_code == 201
    assert contribution is not None
    assert contribution.original_filename == "recording.webm"


def test_upload_file_is_closed_after_processing(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured_uploads = []
    original_reader = contribution_route_module.read_bounded_upload

    async def tracking_reader(upload, max_size_mb):
        captured_uploads.append(upload)
        return await original_reader(upload, max_size_mb)

    monkeypatch.setattr(
        contribution_route_module,
        "read_bounded_upload",
        tracking_reader,
    )

    response = post_guided(client)

    assert response.status_code == 201
    assert captured_uploads[0].file.closed


def test_database_failure_returns_500_and_removes_audio(
    client: TestClient,
    db_session: Session,
    test_storage_root: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        Session,
        "commit",
        lambda _: (_ for _ in ()).throw(RuntimeError("simulated database failure")),
    )

    response = post_guided(client)

    assert response.status_code == 500
    assert response.json()["code"] == "CONTRIBUTION_CREATION_FAILED"
    assert contribution_count(db_session) == 0
    assert list((test_storage_root / "audio").rglob("*.*")) == []


def test_storage_failure_returns_500_without_database_row(
    client: TestClient,
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        contribution_service_module,
        "save_audio_file",
        lambda **_: (_ for _ in ()).throw(AudioStorageError()),
    )

    response = post_guided(client)

    assert response.status_code == 500
    assert response.json()["code"] == "AUDIO_STORAGE_FAILED"
    assert contribution_count(db_session) == 0


def test_existing_routes_continue_working(client: TestClient) -> None:
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/sentences").status_code == 200
    assert (
        client.get(
            "/api/admin/health",
            headers={"X-Admin-Key": settings.admin_api_key},
        ).status_code
        == 200
    )
    assert client.post("/api/admin/sentences/import").status_code == 401
