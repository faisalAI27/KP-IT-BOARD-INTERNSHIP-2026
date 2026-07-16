"""Protected, filtered admin contribution review queue tests."""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.orm import Session

from tests.admin_contribution_review_helpers import (
    add_review_contribution,
    add_review_profile,
    admin_headers,
)


ENDPOINT = "/api/admin/contributions"


def get_contributions(client: TestClient, query: str = ""):
    return client.get(f"{ENDPOINT}{query}", headers=admin_headers())


def test_missing_admin_key_is_rejected(client: TestClient) -> None:
    response = client.get(ENDPOINT)

    assert response.status_code == 401
    assert response.json() == {"detail": "Admin API key is required."}


def test_invalid_admin_key_is_rejected(client: TestClient) -> None:
    response = client.get(ENDPOINT, headers={"X-Admin-Key": "wrong-key"})

    assert response.status_code == 403
    assert response.json() == {"detail": "Invalid admin API key."}


def test_admin_key_query_parameter_is_not_accepted(client: TestClient) -> None:
    response = client.get(f"{ENDPOINT}?adminKey={admin_headers()['X-Admin-Key']}")

    assert response.status_code == 401


def test_valid_admin_key_returns_empty_pending_queue(client: TestClient) -> None:
    response = get_contributions(client)

    assert response.status_code == 200
    assert response.json() == {
        "items": [],
        "total": 0,
        "limit": 20,
        "offset": 0,
        "status": "pending",
    }


def test_default_filter_returns_only_pending(
    client: TestClient,
    db_session: Session,
) -> None:
    pending = add_review_contribution(db_session)
    add_review_contribution(db_session, review_status="approved")
    add_review_contribution(
        db_session,
        review_status="rejected",
        rejection_reason="Too noisy",
    )

    response = get_contributions(client)

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == [pending.id]
    assert response.json()["total"] == 1


@pytest.mark.parametrize("review_status", ["approved", "rejected"])
def test_explicit_filter_returns_only_requested_status(
    review_status: str,
    client: TestClient,
    db_session: Session,
) -> None:
    add_review_contribution(db_session)
    expected = add_review_contribution(
        db_session,
        review_status=review_status,
        rejection_reason="Too noisy" if review_status == "rejected" else None,
    )

    response = get_contributions(client, f"?status={review_status}")

    assert response.status_code == 200
    assert response.json()["status"] == review_status
    assert [item["id"] for item in response.json()["items"]] == [expected.id]


def test_all_filter_returns_every_review_status(
    client: TestClient,
    db_session: Session,
) -> None:
    for review_status in ["pending", "approved", "rejected"]:
        add_review_contribution(
            db_session,
            review_status=review_status,
            rejection_reason="Too noisy" if review_status == "rejected" else None,
        )

    response = get_contributions(client, "?status=all")

    assert response.status_code == 200
    assert response.json()["status"] == "all"
    assert response.json()["total"] == 3
    assert len(response.json()["items"]) == 3


def test_invalid_status_returns_safe_error(client: TestClient) -> None:
    response = get_contributions(client, "?status=published")

    assert response.status_code == 400
    assert response.json() == {
        "message": "The contribution review status is invalid.",
        "code": "INVALID_REVIEW_STATUS",
    }


def test_limit_and_offset_are_applied(
    client: TestClient,
    db_session: Session,
) -> None:
    now = datetime.now(timezone.utc)
    contributions = [
        add_review_contribution(
            db_session,
            created_at=now + timedelta(seconds=index),
        )
        for index in range(3)
    ]

    response = get_contributions(client, "?limit=1&offset=1")

    assert response.status_code == 200
    assert response.json()["total"] == 3
    assert response.json()["limit"] == 1
    assert response.json()["offset"] == 1
    assert response.json()["items"][0]["id"] == contributions[1].id


def test_maximum_limit_is_accepted(client: TestClient) -> None:
    response = get_contributions(client, "?limit=100")

    assert response.status_code == 200
    assert response.json()["limit"] == 100


@pytest.mark.parametrize("query", ["?limit=0", "?limit=101", "?limit=nope"])
def test_invalid_limit_is_rejected(query: str, client: TestClient) -> None:
    assert get_contributions(client, query).status_code == 422


@pytest.mark.parametrize("query", ["?offset=-1", "?offset=nope"])
def test_invalid_offset_is_rejected(query: str, client: TestClient) -> None:
    assert get_contributions(client, query).status_code == 422


def test_newest_submission_and_stable_id_ordering(
    client: TestClient,
    db_session: Session,
) -> None:
    timestamp = datetime.now(timezone.utc)
    lower_id = "11111111-1111-4111-8111-111111111111"
    higher_id = "99999999-9999-4999-8999-999999999999"
    older = add_review_contribution(
        db_session,
        contribution_id="55555555-5555-4555-8555-555555555555",
        created_at=timestamp - timedelta(seconds=1),
    )
    add_review_contribution(
        db_session,
        contribution_id=lower_id,
        created_at=timestamp,
    )
    add_review_contribution(
        db_session,
        contribution_id=higher_id,
        created_at=timestamp,
    )

    response = get_contributions(client)

    assert [item["id"] for item in response.json()["items"]] == [
        higher_id,
        lower_id,
        older.id,
    ]


def test_legacy_and_owned_contributions_are_both_reviewable(
    client: TestClient,
    db_session: Session,
) -> None:
    profile = add_review_profile(db_session, display_name="Safe Display Name")
    legacy = add_review_contribution(db_session, user_id=None)
    owned = add_review_contribution(db_session, user_id=profile.id)

    response = get_contributions(client)
    items = {item["id"]: item for item in response.json()["items"]}

    assert items[legacy.id]["hasOwner"] is False
    assert items[legacy.id]["ownerDisplayName"] is None
    assert items[owned.id]["hasOwner"] is True
    assert items[owned.id]["ownerDisplayName"] == "Safe Display Name"


def test_list_response_contains_only_safe_review_metadata(
    client: TestClient,
    db_session: Session,
) -> None:
    profile = add_review_profile(db_session)
    contribution = add_review_contribution(db_session, user_id=profile.id)

    response = get_contributions(client)
    item = response.json()["items"][0]

    assert set(item) == {
        "id",
        "contributionType",
        "language",
        "sentenceText",
        "topic",
        "originalFilename",
        "mimeType",
        "durationSeconds",
        "createdAt",
        "reviewStatus",
        "reviewedAt",
        "rejectionReason",
        "hasOwner",
        "ownerDisplayName",
    }
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
        "_sa_instance_state",
    ]:
        assert forbidden not in response_text


def test_status_filter_is_applied_inside_sql(
    client: TestClient,
    db_session: Session,
) -> None:
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
        response = get_contributions(client, "?status=approved")
    finally:
        event.remove(bind, "before_cursor_execute", capture_statement)

    assert response.status_code == 200
    assert statements
    assert all("where contributions.review_status = ?" in sql for sql in statements)
