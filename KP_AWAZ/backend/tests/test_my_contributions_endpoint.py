"""Ownership-safe current-user contribution history endpoint tests."""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.models import Contribution, Profile
from tests.conftest import (
    TEST_AUTHORIZATION,
    TEST_USER_ID,
    authenticate_test_user,
    reject_test_access_token,
)


ENDPOINT = "/api/contributions/me"
OTHER_USER_ID = "93cdf86e-2d29-4b4f-a665-90b25b9d5f31"


def add_profile(database: Session, user_id: str) -> None:
    database.add(
        Profile(
            id=user_id,
            email=f"{user_id[:8]}@example.com",
            auth_provider="email",
            display_name=f"User {user_id[:4]}",
        )
    )
    database.commit()


def add_contribution(
    database: Session,
    *,
    contribution_id: str,
    user_id: str | None,
    created_at: datetime,
    contribution_type: str = "guided",
) -> Contribution:
    contribution = Contribution(
        id=contribution_id,
        user_id=user_id,
        contribution_type=contribution_type,
        contributor_name="Display Metadata Only",
        language="Pashto",
        sentence_id=None,
        sentence_text="هر غږ ارزښت لري." if contribution_type == "guided" else None,
        sentence_source="provided" if contribution_type == "guided" else None,
        topic=None if contribution_type == "guided" else "A story",
        consent_given=True,
        audio_storage_key=f"audio/private/{contribution_id}.webm",
        original_filename="recording.webm",
        mime_type="audio/webm",
        file_size=128,
        duration_seconds=3.5,
        status="queued",
        created_at=created_at,
        updated_at=created_at,
    )
    database.add(contribution)
    database.commit()
    return contribution


def get_mine(client: TestClient, query: str = ""):
    return client.get(f"{ENDPOINT}{query}", headers=TEST_AUTHORIZATION)


def test_missing_token_returns_401(client: TestClient) -> None:
    response = client.get(ENDPOINT)

    assert response.status_code == 401
    assert response.json()["code"] == "AUTHENTICATION_REQUIRED"


def test_invalid_token_returns_401(client: TestClient) -> None:
    reject_test_access_token()

    response = get_mine(client)

    assert response.status_code == 401
    assert response.json()["code"] == "INVALID_ACCESS_TOKEN"


def test_empty_current_user_result_is_safe(client: TestClient) -> None:
    authenticate_test_user()

    response = get_mine(client)

    assert response.status_code == 200
    assert response.json() == {"items": [], "total": 0, "limit": 20, "offset": 0}


def test_only_current_user_rows_are_returned(
    client: TestClient,
    db_session: Session,
) -> None:
    authenticate_test_user()
    add_profile(db_session, TEST_USER_ID)
    add_profile(db_session, OTHER_USER_ID)
    now = datetime.now(timezone.utc)
    mine = add_contribution(
        db_session,
        contribution_id="11111111-1111-4111-8111-111111111111",
        user_id=TEST_USER_ID,
        created_at=now,
    )
    add_contribution(
        db_session,
        contribution_id="22222222-2222-4222-8222-222222222222",
        user_id=OTHER_USER_ID,
        created_at=now,
    )
    add_contribution(
        db_session,
        contribution_id="33333333-3333-4333-8333-333333333333",
        user_id=None,
        created_at=now,
    )

    response = get_mine(client)

    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert [item["id"] for item in response.json()["items"]] == [mine.id]


def test_response_uses_safe_camel_case_fields(
    client: TestClient,
    db_session: Session,
) -> None:
    authenticate_test_user()
    add_profile(db_session, TEST_USER_ID)
    contribution = add_contribution(
        db_session,
        contribution_id="11111111-1111-4111-8111-111111111111",
        user_id=TEST_USER_ID,
        created_at=datetime.now(timezone.utc),
    )

    response = get_mine(client)
    item = response.json()["items"][0]

    assert set(item) == {
        "id",
        "contributionType",
        "sentenceId",
        "sentenceText",
        "topic",
        "language",
        "originalFilename",
        "mimeType",
        "durationSeconds",
        "status",
        "createdAt",
    }
    assert item["id"] == contribution.id
    assert item["createdAt"].endswith("Z")
    serialized = response.text.lower()
    for forbidden in [
        TEST_USER_ID.lower(),
        "audio_storage_key",
        "audio/private",
        "access_token",
        "refresh_token",
        "_sa_instance_state",
        "reviewstatus",
        "reviewedat",
        "rejectionreason",
    ]:
        assert forbidden not in serialized


def test_rejection_reason_remains_admin_only(
    client: TestClient,
    db_session: Session,
) -> None:
    authenticate_test_user()
    add_profile(db_session, TEST_USER_ID)
    contribution = add_contribution(
        db_session,
        contribution_id="11111111-1111-4111-8111-111111111111",
        user_id=TEST_USER_ID,
        created_at=datetime.now(timezone.utc),
    )
    contribution.review_status = "rejected"
    contribution.reviewed_at = datetime.now(timezone.utc)
    contribution.rejection_reason = "Administrative reason"
    db_session.commit()

    response = get_mine(client)

    assert response.status_code == 200
    assert "Administrative reason" not in response.text
    assert "rejectionReason" not in response.text
    assert "reviewStatus" not in response.text


def test_limit_offset_total_and_newest_first(
    client: TestClient,
    db_session: Session,
) -> None:
    authenticate_test_user()
    add_profile(db_session, TEST_USER_ID)
    now = datetime.now(timezone.utc)
    identifiers = [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
    ]
    for index, contribution_id in enumerate(identifiers):
        add_contribution(
            db_session,
            contribution_id=contribution_id,
            user_id=TEST_USER_ID,
            created_at=now + timedelta(seconds=index),
        )

    response = get_mine(client, "?limit=1&offset=1")

    assert response.status_code == 200
    assert response.json()["total"] == 3
    assert response.json()["limit"] == 1
    assert response.json()["offset"] == 1
    assert [item["id"] for item in response.json()["items"]] == [identifiers[1]]


def test_stable_secondary_id_ordering(client: TestClient, db_session: Session) -> None:
    authenticate_test_user()
    add_profile(db_session, TEST_USER_ID)
    timestamp = datetime.now(timezone.utc)
    lower_id = "11111111-1111-4111-8111-111111111111"
    higher_id = "99999999-9999-4999-8999-999999999999"
    add_contribution(
        db_session,
        contribution_id=lower_id,
        user_id=TEST_USER_ID,
        created_at=timestamp,
    )
    add_contribution(
        db_session,
        contribution_id=higher_id,
        user_id=TEST_USER_ID,
        created_at=timestamp,
    )

    response = get_mine(client)

    assert [item["id"] for item in response.json()["items"]] == [
        higher_id,
        lower_id,
    ]


def test_maximum_limit_is_accepted(client: TestClient) -> None:
    authenticate_test_user()

    response = get_mine(client, "?limit=100")

    assert response.status_code == 200
    assert response.json()["limit"] == 100


@pytest.mark.parametrize("query", ["?limit=0", "?limit=101", "?limit=nope"])
def test_invalid_limit_is_rejected(query: str, client: TestClient) -> None:
    authenticate_test_user()

    assert get_mine(client, query).status_code == 422


@pytest.mark.parametrize("query", ["?offset=-1", "?offset=nope"])
def test_invalid_offset_is_rejected(query: str, client: TestClient) -> None:
    authenticate_test_user()

    assert get_mine(client, query).status_code == 422


def test_supplied_user_id_cannot_change_scope(
    client: TestClient,
    db_session: Session,
) -> None:
    authenticate_test_user()
    add_profile(db_session, OTHER_USER_ID)
    add_contribution(
        db_session,
        contribution_id="22222222-2222-4222-8222-222222222222",
        user_id=OTHER_USER_ID,
        created_at=datetime.now(timezone.utc),
    )

    response = get_mine(client, f"?userId={OTHER_USER_ID}")

    assert response.status_code == 200
    assert response.json()["items"] == []
    assert response.json()["total"] == 0


def test_query_filters_ownership_in_sql(
    client: TestClient,
    db_session: Session,
) -> None:
    authenticate_test_user()
    statements: list[str] = []

    def capture_statement(
        _connection,
        _cursor,
        statement,
        _parameters,
        _context,
        _executemany,
    ) -> None:
        if "contributions" in statement.lower():
            statements.append(" ".join(statement.lower().split()))

    bind = db_session.get_bind()
    event.listen(bind, "before_cursor_execute", capture_statement)
    try:
        response = get_mine(client)
    finally:
        event.remove(bind, "before_cursor_execute", capture_statement)

    assert response.status_code == 200
    assert statements
    assert all("where contributions.user_id = ?" in sql for sql in statements)
