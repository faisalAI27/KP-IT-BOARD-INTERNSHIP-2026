"""Authenticated owner-filtered point balance and history endpoint tests."""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.routes import profiles
from app.services.points_ledger_service import PointsQueryError
from tests.conftest import (
    TEST_AUTHORIZATION,
    TEST_USER_ID,
    authenticate_test_user,
    reject_test_access_token,
)
from tests.points_ledger_helpers import (
    add_point_entry,
    add_points_contribution,
    add_points_profile,
)


ENDPOINT = "/api/profile/me/points"
OTHER_USER_ID = "93cdf86e-2d29-4b4f-a665-90b25b9d5f31"
EXACT_ITEM_FIELDS = {
    "id",
    "entryType",
    "pointsDelta",
    "contributionId",
    "createdAt",
}


def get_points(client: TestClient, query: str = ""):
    return client.get(f"{ENDPOINT}{query}", headers=TEST_AUTHORIZATION)


def setup_profile(database: Session, user_id: str = TEST_USER_ID) -> None:
    add_points_profile(database, profile_id=user_id)


def add_user_entry(
    database: Session,
    *,
    user_id: str = TEST_USER_ID,
    review_revision: int = 1,
    entry_type: str = "approval_award",
    points_delta: int = 1,
    created_at: datetime | None = None,
    entry_id: str | None = None,
):
    contribution = add_points_contribution(
        database,
        user_id=user_id,
        review_status="approved" if points_delta > 0 else "rejected",
        review_revision=review_revision,
    )
    entry = add_point_entry(
        database,
        user_id=user_id,
        contribution_id=contribution.id,
        review_revision=review_revision,
        entry_type=entry_type,
        points_delta=points_delta,
        created_at=created_at,
        entry_id=entry_id,
    )
    return contribution, entry


def test_missing_token_returns_401(client: TestClient) -> None:
    response = client.get(ENDPOINT)

    assert response.status_code == 401
    assert response.json()["code"] == "AUTHENTICATION_REQUIRED"


def test_invalid_token_returns_401(client: TestClient) -> None:
    reject_test_access_token()

    response = get_points(client)

    assert response.status_code == 401
    assert response.json()["code"] == "INVALID_ACCESS_TOKEN"


def test_valid_user_with_no_entries_receives_zero_balance(
    client: TestClient,
) -> None:
    authenticate_test_user()

    response = get_points(client)

    assert response.status_code == 200
    assert response.json() == {
        "balance": 0,
        "items": [],
        "total": 0,
        "limit": 20,
        "offset": 0,
    }


def test_balance_sums_positive_and_negative_entries(
    client: TestClient,
    db_session: Session,
) -> None:
    setup_profile(db_session)
    add_user_entry(db_session, review_revision=1)
    add_user_entry(
        db_session,
        review_revision=2,
        entry_type="approval_reversal",
        points_delta=-1,
    )
    add_user_entry(db_session, review_revision=3)
    authenticate_test_user()

    response = get_points(client)

    assert response.json()["balance"] == 1
    assert response.json()["total"] == 3


def test_only_authenticated_users_entries_appear(
    client: TestClient,
    db_session: Session,
) -> None:
    setup_profile(db_session)
    setup_profile(db_session, OTHER_USER_ID)
    mine, _mine_entry = add_user_entry(db_session)
    other, _other_entry = add_user_entry(db_session, user_id=OTHER_USER_ID)
    authenticate_test_user()

    response = get_points(client)

    assert response.json()["total"] == 1
    assert response.json()["items"][0]["contributionId"] == mine.id
    assert other.id not in response.text


def test_supplied_user_id_cannot_change_points_scope(
    client: TestClient,
    db_session: Session,
) -> None:
    setup_profile(db_session)
    setup_profile(db_session, OTHER_USER_ID)
    add_user_entry(db_session, user_id=OTHER_USER_ID)
    authenticate_test_user()

    response = get_points(client, f"?userId={OTHER_USER_ID}")

    assert response.status_code == 200
    assert response.json()["balance"] == 0
    assert response.json()["items"] == []


def test_legacy_contribution_generates_no_private_entry(
    client: TestClient,
    db_session: Session,
) -> None:
    setup_profile(db_session)
    add_points_contribution(
        db_session,
        user_id=None,
        review_status="approved",
        review_revision=1,
    )
    authenticate_test_user()

    response = get_points(client)

    assert response.json()["balance"] == 0
    assert response.json()["total"] == 0


def test_newest_entries_appear_first(client: TestClient, db_session: Session) -> None:
    setup_profile(db_session)
    now = datetime(2026, 7, 16, 10, 0, tzinfo=timezone.utc)
    _older_contribution, older = add_user_entry(
        db_session,
        review_revision=1,
        created_at=now,
    )
    _newer_contribution, newer = add_user_entry(
        db_session,
        review_revision=2,
        created_at=now + timedelta(minutes=1),
    )
    authenticate_test_user()

    items = get_points(client).json()["items"]

    assert [item["id"] for item in items] == [newer.id, older.id]


def test_equal_timestamps_use_descending_id_order(
    client: TestClient,
    db_session: Session,
) -> None:
    setup_profile(db_session)
    timestamp = datetime(2026, 7, 16, 10, 0, tzinfo=timezone.utc)
    lower_id = "11111111-1111-4111-8111-111111111111"
    higher_id = "99999999-9999-4999-8999-999999999999"
    add_user_entry(
        db_session,
        review_revision=1,
        created_at=timestamp,
        entry_id=lower_id,
    )
    add_user_entry(
        db_session,
        review_revision=2,
        created_at=timestamp,
        entry_id=higher_id,
    )
    authenticate_test_user()

    items = get_points(client).json()["items"]

    assert [item["id"] for item in items] == [higher_id, lower_id]


def test_response_uses_exact_camel_case_private_fields(
    client: TestClient,
    db_session: Session,
) -> None:
    setup_profile(db_session)
    contribution, _entry = add_user_entry(db_session)
    authenticate_test_user()

    response = get_points(client)
    item = response.json()["items"][0]

    assert set(response.json()) == {"balance", "items", "total", "limit", "offset"}
    assert set(item) == EXACT_ITEM_FIELDS
    assert item["entryType"] == "approvalAward"
    assert item["pointsDelta"] == 1
    assert item["contributionId"] == contribution.id
    assert item["createdAt"].endswith("Z")


@pytest.mark.parametrize(
    ("stored_type", "api_type", "delta"),
    [
        ("approval_award", "approvalAward", 1),
        ("approval_reversal", "approvalReversal", -1),
        ("approved_backfill", "approvedBackfill", 1),
    ],
)
def test_all_entry_types_use_consistent_api_format(
    stored_type: str,
    api_type: str,
    delta: int,
    client: TestClient,
    db_session: Session,
) -> None:
    setup_profile(db_session)
    add_user_entry(
        db_session,
        entry_type=stored_type,
        points_delta=delta,
    )
    authenticate_test_user()

    assert get_points(client).json()["items"][0]["entryType"] == api_type


def test_response_exposes_no_owner_identity_audio_review_or_tokens(
    client: TestClient,
    db_session: Session,
) -> None:
    setup_profile(db_session)
    add_user_entry(db_session)
    authenticate_test_user()

    response = get_points(client)
    serialized = response.text.lower()

    for forbidden in [
        TEST_USER_ID.lower(),
        "person@example.com",
        "userid",
        "user_id",
        "email",
        "authprovider",
        "admin",
        "access_token",
        "refresh_token",
        "audio",
        "filename",
        "rejection",
        "reviewrevision",
        "description",
    ]:
        assert forbidden not in serialized


def test_total_limit_and_offset_are_correct(
    client: TestClient,
    db_session: Session,
) -> None:
    setup_profile(db_session)
    for revision in [1, 2, 3]:
        add_user_entry(db_session, review_revision=revision)
    authenticate_test_user()

    first = get_points(client, "?limit=1&offset=0").json()
    second = get_points(client, "?limit=1&offset=1").json()

    assert first["total"] == second["total"] == 3
    assert first["limit"] == second["limit"] == 1
    assert first["offset"] == 0
    assert second["offset"] == 1
    assert len(first["items"]) == len(second["items"]) == 1
    assert first["items"][0]["id"] != second["items"][0]["id"]


def test_maximum_limit_is_accepted(client: TestClient) -> None:
    authenticate_test_user()

    response = get_points(client, "?limit=100")

    assert response.status_code == 200
    assert response.json()["limit"] == 100


@pytest.mark.parametrize("query", ["?limit=0", "?limit=101", "?limit=nope"])
def test_invalid_limit_is_rejected(query: str, client: TestClient) -> None:
    authenticate_test_user()

    assert get_points(client, query).status_code == 422


@pytest.mark.parametrize("query", ["?offset=-1", "?offset=nope"])
def test_invalid_offset_is_rejected(query: str, client: TestClient) -> None:
    authenticate_test_user()

    assert get_points(client, query).status_code == 422


def test_query_filters_owner_in_every_ledger_sql_statement(
    client: TestClient,
    db_session: Session,
) -> None:
    setup_profile(db_session)
    add_user_entry(db_session)
    authenticate_test_user()
    statements: list[str] = []

    def capture(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: object,
    ) -> None:
        normalized = " ".join(statement.lower().split())
        if "point_ledger_entries" in normalized:
            statements.append(normalized)

    bind = db_session.get_bind()
    event.listen(bind, "before_cursor_execute", capture)
    try:
        response = get_points(client)
    finally:
        event.remove(bind, "before_cursor_execute", capture)

    assert response.status_code == 200
    assert len(statements) == 3
    assert all("point_ledger_entries.user_id = ?" in sql for sql in statements)
    assert "limit ? offset ?" in statements[-1]


def test_sql_failure_returns_safe_error(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    authenticate_test_user()

    def fail_safely(**_arguments: object):
        raise PointsQueryError() from RuntimeError(
            "SELECT token FROM /private/database/path"
        )

    monkeypatch.setattr(profiles, "get_personal_points", fail_safely)

    response = get_points(client)

    assert response.status_code == 500
    assert response.json() == {
        "message": "Contribution points could not be loaded.",
        "code": "POINTS_QUERY_FAILED",
    }
    assert "select" not in response.text.lower()
    assert "private" not in response.text.lower()
