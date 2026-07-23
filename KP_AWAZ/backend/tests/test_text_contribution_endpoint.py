"""Authenticated written-text contribution endpoint tests."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import TextContribution
from tests.conftest import TEST_AUTHORIZATION, authenticate_test_user


ENDPOINT = "/api/contributions/text"


@pytest.fixture(autouse=True)
def authenticated_contributor() -> None:
    authenticate_test_user()


def valid_data() -> dict[str, str]:
    return {
        "contributorName": "Faisal Imran",
        "language": "Pashto",
        "textType": "sentence",
        "text": "زما ژبه زما پېژندنه ده.",
    }


def test_manual_pashto_text_is_stored_pending(
    client: TestClient,
    db_session: Session,
) -> None:
    response = client.post(
        ENDPOINT,
        headers=TEST_AUTHORIZATION,
        data=valid_data(),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["itemCount"] == 1
    assert body["status"] == "queued"
    contribution = db_session.get(TextContribution, body["ids"][0])
    assert contribution is not None
    assert contribution.submission_method == "manual"
    assert contribution.text_type == "sentence"
    assert contribution.language == "Pashto"
    assert contribution.status == "queued"


def test_manual_and_file_text_are_committed_as_one_batch(
    client: TestClient,
    db_session: Session,
) -> None:
    response = client.post(
        ENDPOINT,
        headers=TEST_AUTHORIZATION,
        data=valid_data(),
        files=[
            (
                "files",
                (
                    "phrases.txt",
                    "هر غږ ارزښت لري.\nپښتو زموږ ګډ کور دی.".encode(),
                    "text/plain",
                ),
            )
        ],
    )

    assert response.status_code == 201
    assert response.json()["itemCount"] == 2
    contributions = list(
        db_session.scalars(select(TextContribution).order_by(TextContribution.id))
    )
    assert {item.submission_method for item in contributions} == {"manual", "file"}
    uploaded = next(item for item in contributions if item.submission_method == "file")
    assert uploaded.original_filename == "phrases.txt"
    assert uploaded.file_size is not None
    assert uploaded.text_type == "file_batch"


def test_text_contribution_requires_authentication(client: TestClient) -> None:
    response = client.post(ENDPOINT, data=valid_data())

    assert response.status_code == 401
    assert response.json()["code"] == "AUTHENTICATION_REQUIRED"


def test_text_contribution_rejects_empty_request(client: TestClient) -> None:
    data = valid_data()
    data.pop("text")
    response = client.post(
        ENDPOINT,
        headers=TEST_AUTHORIZATION,
        data=data,
    )

    assert response.status_code == 400
    assert response.json()["code"] == "TEXT_CONTRIBUTION_FAILED"


def test_text_contribution_rejects_unsupported_file(client: TestClient) -> None:
    data = valid_data()
    data.pop("text")
    response = client.post(
        ENDPOINT,
        headers=TEST_AUTHORIZATION,
        data=data,
        files={"files": ("notes.pdf", b"not-a-pdf", "application/pdf")},
    )

    assert response.status_code == 415
    assert response.json()["code"] == "UNSUPPORTED_TEXT_FILE"


def test_text_contribution_sanitizes_upload_filename(
    client: TestClient,
    db_session: Session,
) -> None:
    data = valid_data()
    data.pop("text")
    response = client.post(
        ENDPOINT,
        headers=TEST_AUTHORIZATION,
        data=data,
        files={"files": ("../../phrases.txt", b"valid phrase", "text/plain")},
    )

    assert response.status_code == 201
    contribution = db_session.get(TextContribution, response.json()["ids"][0])
    assert contribution is not None
    assert contribution.original_filename == "phrases.txt"
