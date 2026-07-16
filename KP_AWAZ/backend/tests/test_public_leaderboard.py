"""Privacy-safe public leaderboard endpoint tests."""

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import event
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.routes import leaderboard
from app.schemas import PublicLeaderboardItem
from app.services.contribution_statistics_service import (
    LeaderboardQueryError,
    list_public_leaderboard,
)
from tests.leaderboard_helpers import (
    add_approved_contributions,
    add_statistics_contribution,
    add_statistics_profile,
)


ENDPOINT = "/api/leaderboard"
PROFILE_IDS = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
    "44444444-4444-4444-8444-444444444444",
    "55555555-5555-4555-8555-555555555555",
    "66666666-6666-4666-8666-666666666666",
]
PUBLIC_ITEM_FIELDS = {"rank", "displayName", "approvedContributions"}


def add_profile(
    database: Session,
    index: int,
    *,
    name: str,
    opt_in: bool = True,
) -> str:
    profile_id = PROFILE_IDS[index]
    add_statistics_profile(
        database,
        profile_id=profile_id,
        display_name=name,
        leaderboard_opt_in=opt_in,
        email=f"private-{index}@example.com",
        provider="google",
    )
    return profile_id


def test_leaderboard_is_public_without_authentication(client: TestClient) -> None:
    response = client.get(ENDPOINT)

    assert response.status_code == 200
    assert response.json() == {"items": [], "total": 0, "limit": 20, "offset": 0}


def test_authorization_header_is_not_required_or_reflected(client: TestClient) -> None:
    response = client.get(
        ENDPOINT,
        headers={"Authorization": "Bearer irrelevant-public-token"},
    )

    assert response.status_code == 200
    assert "irrelevant-public-token" not in response.text


def test_only_approved_contributions_count(
    client: TestClient,
    db_session: Session,
) -> None:
    profile_id = add_profile(db_session, 0, name="Eligible Contributor")
    for status in ["approved", "approved", "pending", "rejected"]:
        add_statistics_contribution(
            db_session,
            user_id=profile_id,
            review_status=status,
        )

    response = client.get(ENDPOINT)

    assert response.json()["items"] == [
        {
            "rank": 1,
            "displayName": "Eligible Contributor",
            "approvedContributions": 2,
        }
    ]


def test_pending_only_profile_does_not_appear(
    client: TestClient,
    db_session: Session,
) -> None:
    profile_id = add_profile(db_session, 0, name="Pending Contributor")
    add_statistics_contribution(
        db_session,
        user_id=profile_id,
        review_status="pending",
    )

    assert client.get(ENDPOINT).json()["items"] == []


def test_rejected_only_profile_does_not_appear(
    client: TestClient,
    db_session: Session,
) -> None:
    profile_id = add_profile(db_session, 0, name="Rejected Contributor")
    add_statistics_contribution(
        db_session,
        user_id=profile_id,
        review_status="rejected",
    )

    assert client.get(ENDPOINT).json()["items"] == []


def test_legacy_approved_contribution_does_not_appear(
    client: TestClient,
    db_session: Session,
) -> None:
    add_statistics_contribution(
        db_session,
        user_id=None,
        review_status="approved",
    )

    response = client.get(ENDPOINT)

    assert response.json()["items"] == []
    assert response.json()["total"] == 0


def test_opted_out_approved_profile_does_not_appear(
    client: TestClient,
    db_session: Session,
) -> None:
    profile_id = add_profile(
        db_session,
        0,
        name="Private Contributor",
        opt_in=False,
    )
    add_approved_contributions(db_session, user_id=profile_id, count=2)

    assert client.get(ENDPOINT).json()["items"] == []


def test_opted_in_profile_with_zero_contributions_does_not_appear(
    client: TestClient,
    db_session: Session,
) -> None:
    add_profile(db_session, 0, name="No Contributions")

    assert client.get(ENDPOINT).json()["items"] == []


def test_eligible_profile_appears_with_exact_public_fields(
    client: TestClient,
    db_session: Session,
) -> None:
    profile_id = add_profile(db_session, 0, name="Public Contributor")
    add_approved_contributions(db_session, user_id=profile_id, count=1)

    response = client.get(ENDPOINT)
    item = response.json()["items"][0]

    assert response.status_code == 200
    assert set(item) == PUBLIC_ITEM_FIELDS
    assert item == {
        "rank": 1,
        "displayName": "Public Contributor",
        "approvedContributions": 1,
    }


def test_higher_approved_count_appears_first(
    client: TestClient,
    db_session: Session,
) -> None:
    lower = add_profile(db_session, 0, name="Lower")
    higher = add_profile(db_session, 1, name="Higher")
    add_approved_contributions(db_session, user_id=lower, count=1)
    add_approved_contributions(db_session, user_id=higher, count=3)

    items = client.get(ENDPOINT).json()["items"]

    assert [item["displayName"] for item in items] == ["Higher", "Lower"]
    assert [item["approvedContributions"] for item in items] == [3, 1]


def test_equal_counts_receive_equal_dense_rank_without_gaps(
    client: TestClient,
    db_session: Session,
) -> None:
    names = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"]
    counts = [5, 5, 3, 3, 1]
    for index, (name, count) in enumerate(zip(names, counts, strict=True)):
        profile_id = add_profile(db_session, index, name=name)
        add_approved_contributions(db_session, user_id=profile_id, count=count)

    items = client.get(ENDPOINT).json()["items"]

    assert [item["rank"] for item in items] == [1, 1, 2, 2, 3]


def test_tie_order_uses_normalized_display_name_ascending(
    client: TestClient,
    db_session: Session,
) -> None:
    names = ["charlie", "Alpha", "bravo"]
    for index, name in enumerate(names):
        profile_id = add_profile(db_session, index, name=name)
        add_approved_contributions(db_session, user_id=profile_id, count=2)

    items = client.get(ENDPOINT).json()["items"]

    assert [item["displayName"] for item in items] == ["Alpha", "bravo", "charlie"]
    assert {item["rank"] for item in items} == {1}


def test_duplicate_display_names_remain_separate_entries(
    client: TestClient,
    db_session: Session,
) -> None:
    for index in [0, 1]:
        profile_id = add_profile(db_session, index, name="Faisal Imran")
        add_approved_contributions(db_session, user_id=profile_id, count=1)

    response = client.get(ENDPOINT)

    assert response.json()["total"] == 2
    assert response.json()["items"] == [
        {"rank": 1, "displayName": "Faisal Imran", "approvedContributions": 1},
        {"rank": 1, "displayName": "Faisal Imran", "approvedContributions": 1},
    ]


def test_public_response_excludes_all_private_and_audio_metadata(
    client: TestClient,
    db_session: Session,
) -> None:
    profile_id = add_profile(db_session, 0, name="Safe Public Name")
    add_statistics_contribution(
        db_session,
        user_id=profile_id,
        review_status="approved",
        audio_storage_key="audio/private/secret-recording.webm",
        original_filename="secret-filename.webm",
    )

    response = client.get(ENDPOINT)
    serialized = response.text.lower()

    assert set(response.json()["items"][0]) == PUBLIC_ITEM_FIELDS
    for forbidden in [
        profile_id.lower(),
        "private-0@example.com",
        "email",
        "authprovider",
        "preferredlanguage",
        "leaderboardoptin",
        "pending",
        "rejected",
        "secret-recording",
        "secret-filename",
        "audio",
        "access_token",
        "refresh_token",
    ]:
        assert forbidden not in serialized


def test_total_counts_only_currently_eligible_profiles(
    client: TestClient,
    db_session: Session,
) -> None:
    eligible = add_profile(db_session, 0, name="Eligible")
    opted_out = add_profile(db_session, 1, name="Opted Out", opt_in=False)
    zero_approved = add_profile(db_session, 2, name="Zero Approved")
    add_approved_contributions(db_session, user_id=eligible, count=1)
    add_approved_contributions(db_session, user_id=opted_out, count=4)
    add_statistics_contribution(
        db_session,
        user_id=zero_approved,
        review_status="pending",
    )
    add_statistics_contribution(db_session, user_id=None, review_status="approved")

    response = client.get(ENDPOINT)

    assert response.json()["total"] == 1
    assert len(response.json()["items"]) == 1


def test_default_pagination_is_twenty_and_zero(client: TestClient) -> None:
    response = client.get(ENDPOINT)

    assert response.json()["limit"] == 20
    assert response.json()["offset"] == 0


def test_limit_and_offset_page_without_changing_total_or_ranks(
    client: TestClient,
    db_session: Session,
) -> None:
    for index, count in enumerate([3, 2, 1]):
        profile_id = add_profile(db_session, index, name=f"Contributor {index}")
        add_approved_contributions(db_session, user_id=profile_id, count=count)

    first = client.get(f"{ENDPOINT}?limit=1&offset=0").json()
    second = client.get(f"{ENDPOINT}?limit=1&offset=1").json()

    assert first["total"] == second["total"] == 3
    assert first["limit"] == second["limit"] == 1
    assert first["items"][0]["rank"] == 1
    assert second["items"][0]["rank"] == 2


def test_maximum_limit_is_accepted(client: TestClient) -> None:
    response = client.get(f"{ENDPOINT}?limit=100")

    assert response.status_code == 200
    assert response.json()["limit"] == 100


@pytest.mark.parametrize("query", ["?limit=0", "?limit=101", "?limit=nope"])
def test_invalid_limit_is_rejected(query: str, client: TestClient) -> None:
    assert client.get(f"{ENDPOINT}{query}").status_code == 422


@pytest.mark.parametrize("query", ["?offset=-1", "?offset=nope"])
def test_invalid_offset_is_rejected(query: str, client: TestClient) -> None:
    assert client.get(f"{ENDPOINT}{query}").status_code == 422


def test_empty_leaderboard_is_safe(client: TestClient) -> None:
    assert client.get(ENDPOINT).json() == {
        "items": [],
        "total": 0,
        "limit": 20,
        "offset": 0,
    }


def test_leaderboard_database_failure_returns_safe_error(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_safely(**_arguments: object):
        raise LeaderboardQueryError() from RuntimeError(
            "SELECT private_column FROM /private/database"
        )

    monkeypatch.setattr(leaderboard, "list_public_leaderboard", fail_safely)

    response = client.get(ENDPOINT)

    assert response.status_code == 500
    assert response.json() == {
        "message": "The public leaderboard could not be loaded.",
        "code": "LEADERBOARD_QUERY_FAILED",
    }
    assert "select" not in response.text.lower()
    assert "database" not in response.text.lower()


def test_leaderboard_service_converts_sqlalchemy_failure_to_safe_error(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_query(*_arguments: object, **_keywords: object):
        raise SQLAlchemyError("SELECT email FROM profiles")

    monkeypatch.setattr(db_session, "scalar", fail_query)

    with pytest.raises(LeaderboardQueryError) as captured:
        list_public_leaderboard(database=db_session, limit=20, offset=0)

    assert str(captured.value) == "The public leaderboard could not be loaded."
    assert "select" not in str(captured.value).lower()


def test_public_item_schema_forbids_internal_fields() -> None:
    with pytest.raises(ValidationError):
        PublicLeaderboardItem.model_validate(
            {
                "rank": 1,
                "displayName": "Safe Name",
                "approvedContributions": 2,
                "profileId": PROFILE_IDS[0],
            }
        )


def test_leaderboard_filters_and_aggregates_in_bounded_sql_queries(
    client: TestClient,
    db_session: Session,
) -> None:
    profile_id = add_profile(db_session, 0, name="SQL Contributor")
    add_approved_contributions(db_session, user_id=profile_id, count=1)
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
        if "eligible_profile_counts" in normalized:
            statements.append(normalized)

    bind = db_session.get_bind()
    event.listen(bind, "before_cursor_execute", capture)
    try:
        response = client.get(f"{ENDPOINT}?limit=1&offset=0")
    finally:
        event.remove(bind, "before_cursor_execute", capture)

    assert response.status_code == 200
    assert len(statements) == 2
    assert all("contributions.review_status = ?" in sql for sql in statements)
    assert all("contributions.user_id is not null" in sql for sql in statements)
    assert all("profiles.leaderboard_opt_in is 1" in sql for sql in statements)
    assert all("group by profiles.id, profiles.display_name" in sql for sql in statements)
    assert "limit ? offset ?" in statements[1]
