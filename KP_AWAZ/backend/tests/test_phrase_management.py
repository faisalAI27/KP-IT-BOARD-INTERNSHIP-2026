"""Targeted A5.1 tests for phrase import, management, delivery, and linkage."""

from __future__ import annotations

import csv
import io
import json
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.orm import Session

from app.config import settings
from app.consent import CONSENT_POLICY_VERSION
from app.models import Contribution, Profile, Sentence
from app.services.contribution_service import (
    GuidedContributionInput,
    create_guided_contribution,
)
from app.services.phrase_service import update_phrase
from app.services.schema_compatibility import ensure_sentence_phrase_schema
from app.utils.text_normalization import normalize_sentence_text


ADMIN_HEADERS = {"X-Admin-Key": settings.admin_api_key}
IMPORT_ENDPOINT = "/api/admin/phrases/import"
LIST_ENDPOINT = "/api/admin/phrases"
EXPORT_ENDPOINT = "/api/admin/phrases/export"
WEBM_BYTES = b"\x1a\x45\xdf\xa3phrase-link-webm"


def upload_phrase_file(
    client: TestClient,
    *,
    filename: str,
    content: bytes,
    headers: dict[str, str] | None = None,
):
    return client.post(
        IMPORT_ENDPOINT,
        headers=ADMIN_HEADERS if headers is None else headers,
        files={"file": (filename, content, "application/octet-stream")},
    )


def add_phrase(
    database: Session,
    *,
    text_value: str = "هر غږ ارزښت لري.",
    language: str = "Pashto",
    active: bool = True,
) -> Sentence:
    phrase = Sentence(
        language=language,
        text=text_value,
        meaning=None,
        category=None,
        dialect=None,
        source=None,
        difficulty=None,
        normalized_text=normalize_sentence_text(text_value),
        source_type="manual",
        source_filename=None,
        is_active=active,
        times_assigned=0,
    )
    database.add(phrase)
    database.commit()
    return phrase


def add_profile(database: Session) -> Profile:
    profile = Profile(
        id=str(uuid4()),
        email="private-phrase-owner@example.com",
        auth_provider="email",
        display_name="Private Phrase Owner",
    )
    database.add(profile)
    database.commit()
    return profile


def add_prompted_contribution(
    database: Session,
    *,
    phrase: Sentence,
) -> Contribution:
    profile = add_profile(database)
    return create_guided_contribution(
        database,
        GuidedContributionInput(
            contributor_name="Private Contributor",
            language=phrase.language,
            sentence=phrase.text,
            sentence_source="provided",
            sentence_id=phrase.id,
            consent_given=True,
            consent_policy_version=CONSENT_POLICY_VERSION,
            audio_filename="recording.webm",
            audio_mime_type="audio/webm",
            audio_content=WEBM_BYTES,
        ),
        owner_user_id=profile.id,
    )


def test_csv_import_preserves_pashto_unicode_and_metadata(
    client: TestClient,
    db_session: Session,
) -> None:
    phrase_text = "زه خپل کلي سره مینه لرم، ځکه دا ښکلی دی!"
    payload = (
        "text,language,category,dialect,source,difficulty,active\n"
        f'"{phrase_text}",Pashto,general,,,easy,true\n'
    ).encode("utf-8")

    response = upload_phrase_file(client, filename="phrases.csv", content=payload)
    phrase = db_session.scalar(select(Sentence))

    assert response.status_code == 200
    assert response.json() == {
        "received": 1,
        "created": 1,
        "duplicates": 0,
        "invalid": 0,
    }
    assert phrase is not None
    assert phrase.text == phrase_text
    assert phrase.language == "Pashto"
    assert phrase.category == "general"
    assert phrase.dialect is None
    assert phrase.source is None
    assert phrase.difficulty == "easy"
    assert phrase.is_active is True


def test_json_import_preserves_pashto_unicode(
    client: TestClient,
    db_session: Session,
) -> None:
    phrase_text = "پښتو زموږ د کلتور ژوندی غږ دی."
    payload = json.dumps(
        [{"text": phrase_text, "language": "Pashto", "active": True}],
        ensure_ascii=False,
    ).encode("utf-8")

    response = upload_phrase_file(client, filename="phrases.json", content=payload)

    assert response.status_code == 200
    assert response.json()["created"] == 1
    assert db_session.scalar(select(Sentence.text)) == phrase_text


def test_text_import_uses_one_nonblank_line_per_phrase(
    client: TestClient,
    db_session: Session,
) -> None:
    payload = "لومړۍ پښتو جمله\n\n   \nدويمه پښتو جمله\n".encode("utf-8")

    response = upload_phrase_file(client, filename="phrases.txt", content=payload)
    phrases = list(db_session.scalars(select(Sentence).order_by(Sentence.text)).all())

    assert response.status_code == 200
    assert response.json() == {
        "received": 2,
        "created": 2,
        "duplicates": 0,
        "invalid": 0,
    }
    assert {phrase.text for phrase in phrases} == {
        "لومړۍ پښتو جمله",
        "دويمه پښتو جمله",
    }
    assert all(phrase.language == "Pashto" for phrase in phrases)
    assert all(phrase.is_active is True for phrase in phrases)


def test_duplicate_text_and_language_are_not_inserted_twice(
    client: TestClient,
    db_session: Session,
) -> None:
    add_phrase(db_session, text_value="هر غږ ارزښت لري.")
    payload = (
        "هر   غږ ارزښت لري.\n"
        "هر غږ ارزښت لري.\n"
        "نوې پښتو جمله"
    ).encode("utf-8")

    response = upload_phrase_file(client, filename="phrases.txt", content=payload)

    assert response.status_code == 200
    assert response.json() == {
        "received": 3,
        "created": 1,
        "duplicates": 2,
        "invalid": 0,
    }
    assert len(list(db_session.scalars(select(Sentence)).all())) == 2


def test_invalid_import_rows_are_reported_without_rejecting_valid_rows(
    client: TestClient,
    db_session: Session,
) -> None:
    payload = (
        "text,language,active\n"
        '"",Pashto,true\n'
        '"سمه پښتو جمله",Pashto,maybe\n'
        '"بله سمه پښتو جمله",,false\n'
    ).encode("utf-8")

    response = upload_phrase_file(client, filename="phrases.csv", content=payload)
    phrase = db_session.scalar(select(Sentence))

    assert response.status_code == 200
    assert response.json() == {
        "received": 3,
        "created": 1,
        "duplicates": 0,
        "invalid": 2,
    }
    assert phrase is not None
    assert phrase.language == "Pashto"
    assert phrase.is_active is False


def test_empty_phrase_file_returns_safe_error(client: TestClient) -> None:
    response = upload_phrase_file(client, filename="empty.txt", content=b"\n  \n")

    assert response.status_code == 400
    assert response.json() == {
        "message": "The selected file does not contain any usable phrases.",
        "code": "EMPTY_PHRASE_FILE",
    }


def test_admin_key_is_required_for_phrase_import(client: TestClient) -> None:
    response = upload_phrase_file(
        client,
        filename="phrases.txt",
        content="پښتو جمله".encode("utf-8"),
        headers={},
    )

    assert response.status_code == 401


def test_admin_key_is_required_for_phrase_export(client: TestClient) -> None:
    response = client.get(EXPORT_ENDPOINT, params={"format": "csv"})

    assert response.status_code == 401


def test_public_user_cannot_edit_phrase(
    client: TestClient,
    db_session: Session,
) -> None:
    phrase = add_phrase(db_session)

    response = client.patch(
        f"{LIST_ENDPOINT}/{phrase.id}",
        json={"active": False},
    )

    assert response.status_code == 401
    db_session.refresh(phrase)
    assert phrase.is_active is True


def test_public_delivery_returns_active_and_excludes_inactive_phrases(
    client: TestClient,
    db_session: Session,
) -> None:
    active_phrase = add_phrase(db_session, text_value="فعاله پښتو جمله")
    inactive_phrase = add_phrase(
        db_session,
        text_value="غیر فعاله پښتو جمله",
        active=False,
    )

    response = client.get("/api/sentences", params={"language": "Pashto"})

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["data"]] == [active_phrase.id]
    db_session.refresh(active_phrase)
    db_session.refresh(inactive_phrase)
    assert active_phrase.times_assigned == 1
    assert inactive_phrase.times_assigned == 0


def test_admin_listing_supports_filters_and_safe_usage_statistics(
    client: TestClient,
    db_session: Session,
) -> None:
    phrase = add_phrase(db_session, text_value="د کلي فعاله جمله")
    add_phrase(db_session, text_value="بله غیر فعاله جمله", active=False)
    contribution = add_prompted_contribution(db_session, phrase=phrase)

    response = client.get(
        LIST_ENDPOINT,
        headers=ADMIN_HEADERS,
        params={"search": "کلي", "language": "Pashto", "active": "true"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["id"] == phrase.id
    assert body["items"][0]["recordings_submitted"] == 1
    assert body["items"][0]["pending_count"] == 1
    assert body["items"][0]["approved_count"] == 0
    assert body["items"][0]["rejected_count"] == 0
    assert contribution.user_id not in response.text


def test_disabling_and_reenabling_phrase_controls_public_delivery(
    client: TestClient,
    db_session: Session,
) -> None:
    phrase = add_phrase(db_session)

    disabled = client.patch(
        f"{LIST_ENDPOINT}/{phrase.id}",
        headers=ADMIN_HEADERS,
        json={"active": False},
    )
    unavailable = client.get("/api/sentences")
    enabled = client.patch(
        f"{LIST_ENDPOINT}/{phrase.id}",
        headers=ADMIN_HEADERS,
        json={"active": True},
    )
    available = client.get("/api/sentences")

    assert disabled.status_code == 200
    assert disabled.json()["active"] is False
    assert unavailable.json() == {"data": []}
    assert enabled.status_code == 200
    assert enabled.json()["active"] is True
    assert available.json()["data"][0]["id"] == phrase.id


def test_csv_export_is_valid_utf8_quoted_and_active_only(
    client: TestClient,
    db_session: Session,
) -> None:
    active = add_phrase(db_session, text_value='هغه وویل: "زما کلی، ښکلی دی!"')
    add_phrase(db_session, text_value="غیر فعاله جمله", active=False)

    response = client.get(
        EXPORT_ENDPOINT,
        headers=ADMIN_HEADERS,
        params={"format": "csv", "active_only": "true"},
    )
    decoded = response.content.decode("utf-8")
    rows = list(csv.DictReader(io.StringIO(decoded)))

    assert response.status_code == 200
    assert response.headers["content-disposition"].startswith(
        'attachment; filename="kp_awaz_pashto_phrases_'
    )
    assert len(rows) == 1
    assert rows[0]["phrase_reference"] == active.id
    assert rows[0]["text"] == active.text
    assert rows[0]["active"] == "true"


def test_json_export_is_valid_and_can_include_inactive(
    client: TestClient,
    db_session: Session,
) -> None:
    add_phrase(db_session, text_value="فعاله جمله")
    inactive = add_phrase(db_session, text_value="غیر فعاله جمله", active=False)

    response = client.get(
        EXPORT_ENDPOINT,
        headers=ADMIN_HEADERS,
        params={"format": "json", "active_only": "false"},
    )
    payload = json.loads(response.content.decode("utf-8"))

    assert response.status_code == 200
    assert len(payload) == 2
    assert next(row for row in payload if row["phrase_reference"] == inactive.id)[
        "active"
    ] is False


def test_phrase_export_contains_no_user_or_recording_information(
    client: TestClient,
    db_session: Session,
) -> None:
    phrase = add_phrase(db_session)
    contribution = add_prompted_contribution(db_session, phrase=phrase)
    profile = db_session.get(Profile, contribution.user_id)

    response = client.get(
        EXPORT_ENDPOINT,
        headers=ADMIN_HEADERS,
        params={"format": "json", "active_only": "false"},
    )

    assert response.status_code == 200
    for private_value in (
        contribution.id,
        contribution.user_id,
        contribution.audio_storage_key,
        contribution.original_filename,
        profile.email if profile else "",
        profile.display_name if profile else "",
        settings.admin_api_key,
    ):
        assert private_value not in response.text
    assert {"user_id", "email", "audio_path", "token", "admin_key"}.isdisjoint(
        json.loads(response.text)[0]
    )


def test_prompted_contribution_stores_phrase_id_and_text_snapshot(
    db_session: Session,
) -> None:
    phrase = add_phrase(db_session, text_value="زما ژبه زما پېژندنه ده.")

    contribution = add_prompted_contribution(db_session, phrase=phrase)

    assert contribution.sentence_id == phrase.id
    assert contribution.sentence_text == "زما ژبه زما پېژندنه ده."
    assert contribution.language == "Pashto"
    assert contribution.contribution_type == "guided"


def test_editing_phrase_does_not_change_historical_contribution_snapshot(
    db_session: Session,
) -> None:
    phrase = add_phrase(db_session, text_value="اصلي پښتو جمله")
    contribution = add_prompted_contribution(db_session, phrase=phrase)

    update_phrase(
        database=db_session,
        phrase_id=phrase.id,
        updates={"text": "نوې پښتو جمله", "active": False},
    )
    db_session.refresh(contribution)

    assert contribution.sentence_id == phrase.id
    assert contribution.sentence_text == "اصلي پښتو جمله"
    assert db_session.get(Sentence, phrase.id).text == "نوې پښتو جمله"  # type: ignore[union-attr]


def test_import_preserves_existing_sentence_records(
    client: TestClient,
    db_session: Session,
) -> None:
    existing = add_phrase(db_session, text_value="له مخکې موجوده جمله")
    existing_id = existing.id

    response = upload_phrase_file(
        client,
        filename="new.txt",
        content="نوې وارد شوې جمله".encode("utf-8"),
    )
    db_session.expire_all()

    assert response.status_code == 200
    preserved = db_session.get(Sentence, existing_id)
    assert preserved is not None
    assert preserved.text == "له مخکې موجوده جمله"
    assert len(list(db_session.scalars(select(Sentence)).all())) == 2


def test_sqlite_compatibility_adds_phrase_fields_without_replacing_rows(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "legacy-phrases.db"
    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE sentences ("
                "id VARCHAR(36) PRIMARY KEY, language VARCHAR(100) NOT NULL, "
                "text TEXT NOT NULL, normalized_text TEXT NOT NULL, "
                "source_type VARCHAR(50) NOT NULL, source_filename VARCHAR(255), "
                "is_active BOOLEAN NOT NULL, created_at DATETIME NOT NULL)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO sentences VALUES "
                "('legacy-id', 'Pashto', 'پخوانۍ جمله', 'پخوانۍ جمله', "
                "'seed', NULL, 1, '2026-07-01 10:00:00')"
            )
        )

    ensure_sentence_phrase_schema(engine)
    ensure_sentence_phrase_schema(engine)

    columns = {
        column["name"] for column in inspect(engine).get_columns("sentences")
    }
    with engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT id, text, category, dialect, source, difficulty, "
                "times_assigned, updated_at FROM sentences"
            )
        ).one()
    assert {
        "category",
        "dialect",
        "source",
        "difficulty",
        "times_assigned",
        "updated_at",
    }.issubset(columns)
    assert row[:7] == (
        "legacy-id",
        "پخوانۍ جمله",
        None,
        None,
        None,
        None,
        0,
    )
    assert row.updated_at is not None
    engine.dispose()
