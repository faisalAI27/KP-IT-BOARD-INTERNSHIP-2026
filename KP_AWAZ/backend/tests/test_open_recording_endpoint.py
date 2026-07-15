"""Multipart endpoint tests for open-recording contributions."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile as StarletteUploadFile

import app.routes.contributions as contribution_route_module
import app.services.contribution_service as contribution_service_module
from app.config import settings
from app.models import Contribution
from app.services.audio_storage import AudioStorageError, resolve_audio_storage_path
from tests.conftest import TEST_AUTHORIZATION, authenticate_test_user


ENDPOINT = "/api/contributions/open-recording"
GUIDED_ENDPOINT = "/api/contributions/voice"
WEBM_BYTES = b"\x1a\x45\xdf\xa3open-webm"


@pytest.fixture(autouse=True)
def authenticated_contributor() -> None:
    authenticate_test_user()


def valid_form_data() -> dict[str, str]:
    return {
        "contributorName": "Faisal Imran",
        "language": "Pashto",
        "topic": "زما د کلي یوه کیسه",
        "consent": "true",
    }


def post_open(
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


def contribution_count(database: Session) -> int:
    return database.scalar(select(func.count()).select_from(Contribution)) or 0


def test_valid_webm_returns_safe_201_response(client: TestClient) -> None:
    response = post_open(client)

    assert response.status_code == 201
    assert set(response.json()) == {"id", "status", "createdAt"}
    assert response.json()["status"] == "queued"
    assert response.json()["createdAt"].endswith("Z")
    assert "audio_storage_key" not in response.text


def test_valid_request_without_topic_returns_201(client: TestClient) -> None:
    data = valid_form_data()
    data.pop("topic")

    response = post_open(client, data=data)

    assert response.status_code == 201


def test_pashto_topic_is_stored(client: TestClient, db_session: Session) -> None:
    topic = "زما د کلي یوه کیسه!"
    data = valid_form_data()
    data["topic"] = topic

    response = post_open(client, data=data)
    contribution = db_session.get(Contribution, response.json()["id"])

    assert response.status_code == 201
    assert contribution is not None
    assert contribution.topic == topic


def test_database_row_and_audio_are_created(
    client: TestClient, db_session: Session
) -> None:
    response = post_open(client)
    contribution = db_session.get(Contribution, response.json()["id"])

    assert contribution is not None
    assert contribution.contribution_type == "open_recording"
    assert contribution.consent_given is True
    assert contribution.sentence_id is None
    assert contribution.sentence_text is None
    assert contribution.sentence_source is None
    assert resolve_audio_storage_path(contribution.audio_storage_key).read_bytes() == WEBM_BYTES


def test_swagger_uses_exact_multipart_field_names(client: TestClient) -> None:
    document = client.get("/openapi.json").json()
    request_schema = document["paths"][ENDPOINT]["post"]["requestBody"][
        "content"
    ]["multipart/form-data"]["schema"]
    schema_name = request_schema["$ref"].rsplit("/", maxsplit=1)[-1]
    form_schema = document["components"]["schemas"][schema_name]

    assert set(form_schema["properties"]) == {
        "contributorName",
        "language",
        "topic",
        "consent",
        "audio",
    }
    assert set(form_schema["required"]) == {
        "contributorName",
        "language",
        "consent",
        "audio",
    }


@pytest.mark.parametrize("missing_field", ["contributorName", "language", "consent"])
def test_missing_required_form_field_returns_422(
    missing_field: str, client: TestClient
) -> None:
    data = valid_form_data()
    data.pop(missing_field)

    response = post_open(client, data=data)

    assert response.status_code == 422


def test_missing_audio_returns_422(client: TestClient) -> None:
    response = post_open(client, include_audio=False)

    assert response.status_code == 422


@pytest.mark.parametrize("contributor_name", ["   ", "x", "x" * 101])
def test_invalid_contributor_name_returns_safe_400(
    contributor_name: str, client: TestClient
) -> None:
    data = valid_form_data()
    data["contributorName"] = contributor_name

    response = post_open(client, data=data)

    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_CONTRIBUTOR_NAME"


def test_blank_language_returns_safe_400(client: TestClient) -> None:
    data = valid_form_data()
    data["language"] = "   "

    response = post_open(client, data=data)

    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_CONTRIBUTION_LANGUAGE"


def test_topic_over_200_characters_returns_safe_400(client: TestClient) -> None:
    data = valid_form_data()
    data["topic"] = "x" * 201

    response = post_open(client, data=data)

    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_RECORDING_TOPIC"


def test_whitespace_only_topic_becomes_null(
    client: TestClient, db_session: Session
) -> None:
    data = valid_form_data()
    data["topic"] = "   "

    response = post_open(client, data=data)
    contribution = db_session.get(Contribution, response.json()["id"])

    assert response.status_code == 201
    assert contribution is not None
    assert contribution.topic is None


@pytest.mark.parametrize("consent", ["false", "0", "no", "off"])
def test_false_consent_returns_safe_400(
    consent: str, client: TestClient
) -> None:
    data = valid_form_data()
    data["consent"] = consent

    response = post_open(client, data=data)

    assert response.status_code == 400
    assert response.json()["code"] == "CONSENT_REQUIRED"


@pytest.mark.parametrize("consent", ["true", "1", "yes", "on", " YES "])
def test_true_consent_representations_succeed(
    consent: str, client: TestClient
) -> None:
    data = valid_form_data()
    data["consent"] = consent

    response = post_open(client, data=data)

    assert response.status_code == 201


def test_empty_audio_returns_400(client: TestClient) -> None:
    response = post_open(client, content=b"")

    assert response.status_code == 400
    assert response.json()["code"] == "EMPTY_AUDIO_FILE"


def test_unsupported_mime_returns_415(client: TestClient) -> None:
    response = post_open(
        client,
        filename="recording.bin",
        mime_type="application/octet-stream",
    )

    assert response.status_code == 415
    assert response.json()["code"] == "UNSUPPORTED_AUDIO_TYPE"


def test_oversized_open_audio_returns_413(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "max_open_audio_size_mb", 1 / (1024 * 1024))

    response = post_open(client)

    assert response.status_code == 413
    assert response.json()["code"] == "AUDIO_FILE_TOO_LARGE"


def test_contradictory_extension_returns_400(client: TestClient) -> None:
    response = post_open(client, filename="recording.wav")

    assert response.status_code == 400
    assert response.json()["code"] == "AUDIO_EXTENSION_MISMATCH"


def test_invalid_signature_returns_400(client: TestClient) -> None:
    response = post_open(client, content=b"not-webm")

    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_AUDIO_SIGNATURE"


def test_malicious_filename_is_reduced_to_safe_metadata(
    client: TestClient, db_session: Session
) -> None:
    response = post_open(client, filename="../../recording.webm")
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

    response = post_open(client)

    assert response.status_code == 201
    assert captured_uploads[0].file.closed


def test_reader_stops_at_open_limit_plus_one_byte(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    requested_sizes: list[int] = []
    original_read = StarletteUploadFile.read
    monkeypatch.setattr(settings, "max_open_audio_size_mb", 1 / (1024 * 1024))

    async def tracking_read(upload, size=-1):
        requested_sizes.append(size)
        return await original_read(upload, size)

    monkeypatch.setattr(StarletteUploadFile, "read", tracking_read)

    response = post_open(client)

    assert response.status_code == 413
    assert requested_sizes == [2]


def test_guided_and_open_endpoints_use_independent_size_limits(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "max_guided_audio_size_mb", 4 / (1024 * 1024))
    monkeypatch.setattr(
        settings,
        "max_open_audio_size_mb",
        len(WEBM_BYTES) / (1024 * 1024),
    )
    guided_response = client.post(
        GUIDED_ENDPOINT,
        headers=TEST_AUTHORIZATION,
        data={
            "contributorName": "Faisal Imran",
            "language": "Pashto",
            "sentence": "هر غږ ارزښت لري.",
            "sentenceSource": "provided",
            "consent": "true",
        },
        files={"audio": ("recording.webm", WEBM_BYTES, "audio/webm")},
    )

    open_response = post_open(client)

    assert guided_response.status_code == 413
    assert guided_response.json()["code"] == "AUDIO_FILE_TOO_LARGE"
    assert open_response.status_code == 201


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

    response = post_open(client)

    assert response.status_code == 500
    assert response.json() == {
        "message": "The open recording could not be completed.",
        "code": "CONTRIBUTION_CREATION_FAILED",
    }
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

    response = post_open(client)

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
    assert (
        client.post(
            "/api/admin/sentences/import",
            data={"language": "Pashto"},
            files={"files": ("phrases.txt", b"valid phrase", "text/plain")},
            headers={"X-Admin-Key": settings.admin_api_key},
        ).status_code
        == 200
    )
    assert (
        client.post(
            GUIDED_ENDPOINT,
            headers=TEST_AUTHORIZATION,
            data={
                "contributorName": "Faisal Imran",
                "language": "Pashto",
                "sentence": "هر غږ ارزښت لري.",
                "sentenceSource": "provided",
                "consent": "true",
            },
            files={"audio": ("recording.webm", WEBM_BYTES, "audio/webm")},
        ).status_code
        == 201
    )
