"""Sentence endpoint, storage, and duplicate-prevention tests."""

from collections.abc import Iterable

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Sentence
from app.utils.text_normalization import normalize_sentence_text


PUBLIC_FIELDS = {"id", "language", "text", "meaning"}
PRIVATE_FIELDS = {
    "normalized_text",
    "source_type",
    "source_filename",
    "is_active",
    "created_at",
}


def make_sentence(
    *,
    language: str = "Pashto",
    text: str = "هر غږ ارزښت لري.",
    meaning: str | None = "Every voice has value.",
    is_active: bool = True,
) -> Sentence:
    """Build a valid sentence model for database and endpoint tests."""

    return Sentence(
        language=language,
        text=text,
        meaning=meaning,
        normalized_text=normalize_sentence_text(text),
        source_type="custom",
        source_filename=None,
        is_active=is_active,
    )


def insert_sentences(database: Session, sentences: Iterable[Sentence]) -> None:
    database.add_all(sentences)
    database.commit()


def test_empty_database_returns_empty_data(client: TestClient) -> None:
    response = client.get("/api/sentences")

    assert response.status_code == 200
    assert response.json() == {"data": []}


def test_retrieve_pashto_sentences(
    client: TestClient, db_session: Session
) -> None:
    records = [
        make_sentence(text="زما ژبه زما پېژندنه ده."),
        make_sentence(text="هر غږ ارزښت لري."),
    ]
    insert_sentences(db_session, records)

    response = client.get("/api/sentences?language=Pashto")
    response_data = response.json()["data"]

    assert response.status_code == 200
    assert {item["id"] for item in response_data} == {
        record.id for record in records
    }
    assert all(set(item) == PUBLIC_FIELDS for item in response_data)


def test_language_filtering(client: TestClient, db_session: Session) -> None:
    insert_sentences(
        db_session,
        [
            make_sentence(language="Pashto", text="پښتو جمله"),
            make_sentence(language="Urdu", text="اردو جملہ"),
            make_sentence(language="Hindko", text="ہندکو جملہ"),
        ],
    )

    response = client.get("/api/sentences?language=Pashto")

    assert response.status_code == 200
    assert [item["language"] for item in response.json()["data"]] == ["Pashto"]


@pytest.mark.parametrize("language", ["pashto", "PASHTO", "Pashto"])
def test_language_filtering_is_case_insensitive(
    language: str, client: TestClient, db_session: Session
) -> None:
    insert_sentences(db_session, [make_sentence()])

    response = client.get("/api/sentences", params={"language": language})

    assert response.status_code == 200
    assert len(response.json()["data"]) == 1


def test_language_filter_trims_surrounding_whitespace(
    client: TestClient, db_session: Session
) -> None:
    insert_sentences(db_session, [make_sentence()])

    response = client.get("/api/sentences", params={"language": "  Pashto  "})

    assert response.status_code == 200
    assert len(response.json()["data"]) == 1


def test_limit_restricts_result_count(
    client: TestClient, db_session: Session
) -> None:
    insert_sentences(
        db_session,
        [make_sentence(text=f"ازموینې جمله {number}") for number in range(5)],
    )

    response = client.get("/api/sentences?limit=2")

    assert response.status_code == 200
    assert len(response.json()["data"]) == 2


@pytest.mark.parametrize("limit", [0, 101])
def test_limit_validation(limit: int, client: TestClient) -> None:
    response = client.get("/api/sentences", params={"limit": limit})

    assert response.status_code == 422


def test_blank_language_is_rejected(client: TestClient) -> None:
    response = client.get("/api/sentences", params={"language": "   "})

    assert response.status_code == 422


def test_language_longer_than_maximum_is_rejected(client: TestClient) -> None:
    response = client.get("/api/sentences", params={"language": "x" * 101})

    assert response.status_code == 422


def test_inactive_sentences_are_not_returned(
    client: TestClient, db_session: Session
) -> None:
    insert_sentences(
        db_session,
        [
            make_sentence(text="فعاله جمله", is_active=True),
            make_sentence(text="غیر فعاله جمله", is_active=False),
        ],
    )

    response = client.get("/api/sentences")

    assert response.status_code == 200
    assert [item["text"] for item in response.json()["data"]] == ["فعاله جمله"]


def test_public_response_does_not_expose_private_fields(
    client: TestClient, db_session: Session
) -> None:
    insert_sentences(db_session, [make_sentence()])

    response_item = client.get("/api/sentences").json()["data"][0]

    assert set(response_item) == PUBLIC_FIELDS
    assert PRIVATE_FIELDS.isdisjoint(response_item)


def test_pashto_unicode_is_returned_exactly(
    client: TestClient, db_session: Session
) -> None:
    pashto_text = "زما ژبه زما پېژندنه ده."
    insert_sentences(db_session, [make_sentence(text=pashto_text)])

    response = client.get("/api/sentences")

    assert response.status_code == 200
    assert response.json()["data"][0]["text"] == pashto_text


def test_identical_sentence_in_same_language_is_rejected(
    db_session: Session,
) -> None:
    insert_sentences(db_session, [make_sentence()])
    db_session.add(make_sentence())

    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


@pytest.mark.parametrize(
    "duplicate_text",
    ["هر   غږ ارزښت لري.", "  هر غږ ارزښت لري.  "],
)
def test_whitespace_only_sentence_difference_is_rejected(
    duplicate_text: str, db_session: Session
) -> None:
    insert_sentences(db_session, [make_sentence()])
    db_session.add(make_sentence(text=duplicate_text))

    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_same_sentence_can_exist_in_different_languages(
    db_session: Session,
) -> None:
    insert_sentences(
        db_session,
        [
            make_sentence(language="Pashto"),
            make_sentence(language="Urdu"),
        ],
    )

    assert db_session.query(Sentence).count() == 2


def test_language_casing_does_not_allow_duplicates(db_session: Session) -> None:
    insert_sentences(db_session, [make_sentence(language="Pashto")])
    db_session.add(make_sentence(language=" PASHTO "))

    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_storage_normalizes_language_and_only_trims_original_text(
    db_session: Session,
) -> None:
    record = make_sentence(
        language="  pASHTO  ",
        text="  زما   ژبه\tزما پېژندنه ده.  ",
    )
    insert_sentences(db_session, [record])

    assert record.language == "Pashto"
    assert record.text == "زما   ژبه\tزما پېژندنه ده."
    assert record.normalized_text == "زما ژبه زما پېژندنه ده."
