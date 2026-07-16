"""Protected admin contribution detail and private audio endpoint tests."""

from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.services.audio_storage import resolve_audio_storage_path
from tests.admin_contribution_review_helpers import (
    add_review_contribution,
    add_review_profile,
    admin_headers,
)


BASE_ENDPOINT = "/api/admin/contributions"


def test_detail_missing_admin_key_is_rejected(
    client: TestClient,
    db_session: Session,
) -> None:
    contribution = add_review_contribution(db_session)

    response = client.get(f"{BASE_ENDPOINT}/{contribution.id}")

    assert response.status_code == 401


def test_detail_invalid_admin_key_is_rejected(
    client: TestClient,
    db_session: Session,
) -> None:
    contribution = add_review_contribution(db_session)

    response = client.get(
        f"{BASE_ENDPOINT}/{contribution.id}",
        headers={"X-Admin-Key": "wrong-key"},
    )

    assert response.status_code == 403


def test_existing_contribution_detail_returns_safe_metadata(
    client: TestClient,
    db_session: Session,
) -> None:
    profile = add_review_profile(db_session, display_name="Safe Review Name")
    contribution = add_review_contribution(db_session, user_id=profile.id)

    response = client.get(
        f"{BASE_ENDPOINT}/{contribution.id}",
        headers=admin_headers(),
    )

    assert response.status_code == 200
    assert response.json()["id"] == contribution.id
    assert response.json()["reviewStatus"] == "pending"
    assert response.json()["reviewedAt"] is None
    assert response.json()["rejectionReason"] is None
    assert response.json()["hasOwner"] is True
    assert response.json()["ownerDisplayName"] == "Safe Review Name"


def test_missing_contribution_detail_returns_404(client: TestClient) -> None:
    response = client.get(
        f"{BASE_ENDPOINT}/{uuid4()}",
        headers=admin_headers(),
    )

    assert response.status_code == 404
    assert response.json()["code"] == "CONTRIBUTION_NOT_FOUND"


def test_detail_excludes_paths_identity_and_secrets(
    client: TestClient,
    db_session: Session,
) -> None:
    profile = add_review_profile(db_session)
    contribution = add_review_contribution(db_session, user_id=profile.id)

    response = client.get(
        f"{BASE_ENDPOINT}/{contribution.id}",
        headers=admin_headers(),
    )
    response_text = response.text.lower()

    for forbidden in [
        contribution.audio_storage_key.lower(),
        profile.id.lower(),
        "private@example.com",
        "audio_storage_key",
        "access_token",
        "refresh_token",
        "admin_api_key",
        admin_headers()["X-Admin-Key"].lower(),
    ]:
        assert forbidden not in response_text


def test_audio_missing_admin_key_is_rejected(
    client: TestClient,
    db_session: Session,
) -> None:
    contribution = add_review_contribution(db_session, with_audio=True)

    response = client.get(f"{BASE_ENDPOINT}/{contribution.id}/audio")

    assert response.status_code == 401


def test_audio_invalid_admin_key_is_rejected(
    client: TestClient,
    db_session: Session,
) -> None:
    contribution = add_review_contribution(db_session, with_audio=True)

    response = client.get(
        f"{BASE_ENDPOINT}/{contribution.id}/audio",
        headers={"X-Admin-Key": "wrong-key"},
    )

    assert response.status_code == 403


@pytest.mark.parametrize(
    ("extension", "mime_type", "content"),
    [
        ("webm", "audio/webm", b"webm-review-audio"),
        ("ogg", "audio/ogg", b"ogg-review-audio"),
        ("wav", "audio/wav", b"wav-review-audio"),
        ("wav", "audio/x-wav", b"x-wav-review-audio"),
        ("mp3", "audio/mpeg", b"mp3-review-audio"),
        ("m4a", "audio/mp4", b"mp4-review-audio"),
    ],
)
def test_supported_audio_is_returned_with_correct_mime_type(
    extension: str,
    mime_type: str,
    content: bytes,
    client: TestClient,
    db_session: Session,
) -> None:
    contribution = add_review_contribution(
        db_session,
        with_audio=True,
        extension=extension,
        mime_type=mime_type,
        audio_content=content,
    )

    response = client.get(
        f"{BASE_ENDPOINT}/{contribution.id}/audio",
        headers=admin_headers(),
    )

    assert response.status_code == 200
    assert response.content == content
    assert response.headers["content-type"] == mime_type
    assert "inline" in response.headers["content-disposition"]
    assert "contribution-audio" in response.headers["content-disposition"]


def test_missing_contribution_audio_returns_404(client: TestClient) -> None:
    response = client.get(
        f"{BASE_ENDPOINT}/{uuid4()}/audio",
        headers=admin_headers(),
    )

    assert response.status_code == 404
    assert response.json()["code"] == "CONTRIBUTION_NOT_FOUND"


def test_missing_audio_file_returns_safe_404(
    client: TestClient,
    db_session: Session,
) -> None:
    contribution = add_review_contribution(db_session, with_audio=False)

    response = client.get(
        f"{BASE_ENDPOINT}/{contribution.id}/audio",
        headers=admin_headers(),
    )

    assert response.status_code == 404
    assert response.json() == {
        "message": "The contribution audio file was not found.",
        "code": "CONTRIBUTION_AUDIO_NOT_FOUND",
    }


@pytest.mark.parametrize(
    "unsafe_key",
    [
        "/tmp/private-recording.webm",
        "audio/2026/07/../../private-recording.webm",
        r"audio\2026\07\16\private-recording.webm",
    ],
)
def test_unsafe_audio_storage_key_is_rejected_without_path_exposure(
    unsafe_key: str,
    client: TestClient,
    db_session: Session,
) -> None:
    contribution = add_review_contribution(
        db_session,
        audio_storage_key=unsafe_key,
    )

    response = client.get(
        f"{BASE_ENDPOINT}/{contribution.id}/audio",
        headers=admin_headers(),
    )

    assert response.status_code == 500
    assert response.json()["code"] == "UNSAFE_AUDIO_PATH"
    assert unsafe_key not in response.text
    assert "/tmp" not in response.text


def test_audio_symlink_escape_is_rejected(
    client: TestClient,
    db_session: Session,
    tmp_path: Path,
) -> None:
    outside_file = tmp_path / "outside.webm"
    outside_file.write_bytes(b"outside-private-audio")
    contribution = add_review_contribution(db_session)
    expected_path = resolve_audio_storage_path(contribution.audio_storage_key)
    expected_path.parent.mkdir(parents=True, exist_ok=True)
    expected_path.symlink_to(outside_file)

    response = client.get(
        f"{BASE_ENDPOINT}/{contribution.id}/audio",
        headers=admin_headers(),
    )

    assert response.status_code == 500
    assert response.json()["code"] == "UNSAFE_AUDIO_PATH"
    assert str(outside_file) not in response.text


def test_arbitrary_path_query_cannot_replace_contribution_audio(
    client: TestClient,
    db_session: Session,
    tmp_path: Path,
) -> None:
    safe_content = b"safe-contribution-audio"
    outside_file = tmp_path / "outside.webm"
    outside_file.write_bytes(b"outside-private-audio")
    contribution = add_review_contribution(
        db_session,
        with_audio=True,
        audio_content=safe_content,
    )

    response = client.get(
        f"{BASE_ENDPOINT}/{contribution.id}/audio",
        params={"path": str(outside_file)},
        headers=admin_headers(),
    )

    assert response.status_code == 200
    assert response.content == safe_content
    assert response.content != outside_file.read_bytes()


def test_audio_errors_never_expose_keys_or_tokens(
    client: TestClient,
    db_session: Session,
) -> None:
    contribution = add_review_contribution(
        db_session,
        audio_storage_key="unsafe/private-access-token/recording.webm",
    )

    response = client.get(
        f"{BASE_ENDPOINT}/{contribution.id}/audio",
        headers=admin_headers(),
    )

    response_text = response.text.lower()
    assert response.status_code == 500
    for forbidden in [
        contribution.audio_storage_key.lower(),
        "private-access-token",
        admin_headers()["X-Admin-Key"].lower(),
    ]:
        assert forbidden not in response_text
