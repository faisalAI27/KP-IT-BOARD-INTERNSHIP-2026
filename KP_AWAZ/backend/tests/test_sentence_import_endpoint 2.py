"""Multipart API tests for the protected sentence import endpoint."""

from pathlib import Path
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import ImportBatch, Sentence
from app.utils.text_normalization import normalize_sentence_text


ENDPOINT = "/api/admin/sentences/import"
ADMIN_HEADERS = {"X-Admin-Key": settings.admin_api_key}
TOP_LEVEL_KEYS = {
    "batchId",
    "language",
    "filesReceived",
    "totalLines",
    "imported",
    "duplicates",
    "invalid",
    "files",
}
FILE_KEYS = {"filename", "totalLines", "imported", "duplicates", "invalid"}


def upload(
    client: TestClient,
    *,
    contents: list[tuple[str, bytes]],
    language: str = "Pashto",
    headers: dict[str, str] | None = None,
):
    return client.post(
        ENDPOINT,
        data={"language": language},
        files=[
            ("files", (filename, content, "text/plain"))
            for filename, content in contents
        ],
        headers=ADMIN_HEADERS if headers is None else headers,
    )


def add_existing_sentence(database: Session, text: str) -> None:
    database.add(
        Sentence(
            language="Pashto",
            text=text,
            meaning=None,
            normalized_text=normalize_sentence_text(text),
            source_type="custom",
            source_filename=None,
            is_active=True,
        )
    )
    database.commit()


def test_missing_admin_key_returns_401(client: TestClient) -> None:
    response = upload(
        client,
        contents=[("phrases.txt", b"valid phrase")],
        headers={},
    )

    assert response.status_code == 401


def test_incorrect_admin_key_returns_403(client: TestClient) -> None:
    response = upload(
        client,
        contents=[("phrases.txt", b"valid phrase")],
        headers={"X-Admin-Key": "wrong-key"},
    )

    assert response.status_code == 403


def test_correct_admin_key_allows_import(client: TestClient) -> None:
    response = upload(client, contents=[("phrases.txt", b"valid phrase")])

    assert response.status_code == 200
    assert response.json()["imported"] == 1


def test_missing_files_returns_safe_error(client: TestClient) -> None:
    response = client.post(
        ENDPOINT,
        data={"language": "Pashto"},
        headers=ADMIN_HEADERS,
    )

    assert response.status_code == 400
    assert response.json()["code"] == "NO_IMPORT_FILES"


def test_blank_language_returns_safe_error(client: TestClient) -> None:
    response = upload(
        client,
        language="   ",
        contents=[("phrases.txt", b"valid phrase")],
    )

    assert response.status_code == 400
    assert response.json()["code"] == "BLANK_IMPORT_LANGUAGE"


def test_non_txt_file_returns_400(client: TestClient) -> None:
    response = upload(client, contents=[("phrases.csv", b"valid phrase")])

    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_TXT_EXTENSION"


def test_invalid_utf8_returns_400(client: TestClient) -> None:
    response = upload(client, contents=[("phrases.txt", b"\xff\xfe")])

    assert response.status_code == 400
    assert response.json() == {
        "message": "The import file must contain valid UTF-8 text.",
        "code": "INVALID_UTF8_FILE",
    }


def test_oversized_file_returns_413(
    client: TestClient, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "max_import_file_size_mb", 1 / (1024 * 1024))

    response = upload(client, contents=[("phrases.txt", b"aa")])

    assert response.status_code == 413
    assert response.json()["code"] == "IMPORT_FILE_TOO_LARGE"


def test_malicious_filename_is_reduced_safely(client: TestClient) -> None:
    response = upload(
        client,
        contents=[("../../phrases.txt", "هر غږ ارزښت لري.".encode("utf-8"))],
    )

    assert response.status_code == 200
    assert response.json()["files"][0]["filename"] == "phrases.txt"


def test_import_one_txt_file(client: TestClient) -> None:
    response = upload(
        client,
        contents=[
            (
                "phrases.txt",
                "زما ژبه زما پېژندنه ده.\nهر غږ ارزښت لري.".encode("utf-8"),
            )
        ],
    )

    assert response.status_code == 200
    assert response.json()["filesReceived"] == 1
    assert response.json()["imported"] == 2


def test_import_multiple_txt_files(client: TestClient) -> None:
    response = upload(
        client,
        contents=[
            ("one.txt", "لومړۍ جمله\nدويمه جمله".encode("utf-8")),
            ("two.txt", "دويمه جمله\nدرېيمه جمله".encode("utf-8")),
        ],
    )

    assert response.status_code == 200
    assert response.json()["filesReceived"] == 2
    assert response.json()["imported"] == 3
    assert response.json()["duplicates"] == 1
    assert [file["duplicates"] for file in response.json()["files"]] == [0, 1]


def test_response_uses_exact_camel_case_keys(client: TestClient) -> None:
    response = upload(client, contents=[("phrases.txt", b"valid phrase")])
    body = response.json()

    assert set(body) == TOP_LEVEL_KEYS
    assert set(body["files"][0]) == FILE_KEYS
    assert {"batch_id", "files_received", "total_lines"}.isdisjoint(body)


def test_response_contains_valid_batch_uuid(client: TestClient) -> None:
    response = upload(client, contents=[("phrases.txt", b"valid phrase")])
    batch_id = response.json()["batchId"]

    assert str(UUID(batch_id)) == batch_id


def test_database_contains_imported_sentences(
    client: TestClient, db_session: Session
) -> None:
    response = upload(client, contents=[("phrases.txt", b"valid phrase")])

    assert response.status_code == 200
    assert db_session.scalar(select(func.count()).select_from(Sentence)) == 1


def test_import_batch_contains_response_counters(
    client: TestClient, db_session: Session
) -> None:
    response = upload(
        client,
        contents=[("phrases.txt", b"valid phrase\nvalid phrase\nab")],
    )
    body = response.json()
    batch = db_session.get(ImportBatch, body["batchId"])

    assert batch is not None
    assert batch.status == "completed"
    assert batch.number_of_files == body["filesReceived"]
    assert batch.total_lines == body["totalLines"]
    assert batch.imported_phrases == body["imported"]
    assert batch.duplicate_phrases == body["duplicates"]
    assert batch.invalid_lines == body["invalid"]


def test_source_files_exist_under_batch_directory(
    client: TestClient, test_storage_root: Path
) -> None:
    response = upload(
        client,
        contents=[("one.txt", b"first phrase"), ("two.txt", b"second phrase")],
    )
    batch_directory = test_storage_root / "imports" / response.json()["batchId"]

    assert batch_directory.is_dir()
    assert len(list(batch_directory.iterdir())) == 2
    assert all(path.name not in {"one.txt", "two.txt"} for path in batch_directory.iterdir())


def test_response_contains_no_absolute_storage_path(
    client: TestClient, test_storage_root: Path
) -> None:
    response = upload(client, contents=[("phrases.txt", b"valid phrase")])

    assert str(test_storage_root) not in response.text
    assert "safe_storage_filename" not in response.text


def test_admin_key_is_not_exposed(client: TestClient) -> None:
    response = upload(client, contents=[("phrases.txt", b"valid phrase")])

    assert settings.admin_api_key not in response.text


def test_empty_valid_file_succeeds(client: TestClient) -> None:
    response = upload(client, contents=[("empty.txt", b"")])

    assert response.status_code == 200
    assert response.json()["totalLines"] == 0
    assert response.json()["imported"] == 0
    assert response.json()["duplicates"] == 0
    assert response.json()["invalid"] == 0


def test_file_with_all_database_duplicates_succeeds(
    client: TestClient, db_session: Session
) -> None:
    add_existing_sentence(db_session, "هر غږ ارزښت لري.")

    response = upload(
        client,
        contents=[("duplicates.txt", "هر غږ ارزښت لري.".encode("utf-8"))],
    )

    assert response.status_code == 200
    assert response.json()["imported"] == 0
    assert response.json()["duplicates"] == 1


def test_file_with_all_invalid_phrases_succeeds(client: TestClient) -> None:
    response = upload(
        client,
        contents=[("invalid.txt", f"a\n{'x' * 501}".encode())],
    )

    assert response.status_code == 200
    assert response.json()["imported"] == 0
    assert response.json()["invalid"] == 2


def test_existing_routes_continue_working(client: TestClient) -> None:
    health_response = client.get("/api/health")
    sentences_response = client.get("/api/sentences")
    admin_health_response = client.get("/api/admin/health", headers=ADMIN_HEADERS)

    assert health_response.status_code == 200
    assert sentences_response.status_code == 200
    assert admin_health_response.status_code == 200
