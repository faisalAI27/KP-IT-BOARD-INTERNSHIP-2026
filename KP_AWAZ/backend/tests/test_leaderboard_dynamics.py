"""Immediate privacy and review-decision effects on dynamic leaderboard data."""

from datetime import datetime, timezone

from fastapi.testclient import TestClient
from sqlalchemy import func, inspect, select
from sqlalchemy.orm import Session

from app.models import Contribution, Profile
from app.services.admin_contribution_review_service import apply_contribution_review
from app.services.contribution_statistics_service import (
    get_profile_contribution_statistics,
    list_public_leaderboard,
)
from tests.conftest import TEST_AUTHORIZATION, TEST_USER_ID, authenticate_test_user
from tests.leaderboard_helpers import (
    add_approved_contributions,
    add_statistics_contribution,
    add_statistics_profile,
)


OTHER_USER_ID = "93cdf86e-2d29-4b4f-a665-90b25b9d5f31"


def test_privacy_toggle_removes_and_restores_profile_without_data_changes(
    client: TestClient,
    db_session: Session,
) -> None:
    profile = add_statistics_profile(
        db_session,
        profile_id=TEST_USER_ID,
        display_name="Privacy Contributor",
        leaderboard_opt_in=True,
    )
    contribution = add_statistics_contribution(
        db_session,
        user_id=TEST_USER_ID,
        review_status="approved",
    )
    original_ownership = contribution.user_id
    original_review_status = contribution.review_status
    authenticate_test_user()

    visible = client.get("/api/leaderboard")
    disabled = client.patch(
        "/api/profile/me",
        headers=TEST_AUTHORIZATION,
        json={"leaderboardOptIn": False},
    )
    hidden = client.get("/api/leaderboard")
    private_statistics = client.get(
        "/api/profile/me/statistics",
        headers=TEST_AUTHORIZATION,
    )
    restored = client.patch(
        "/api/profile/me",
        headers=TEST_AUTHORIZATION,
        json={"leaderboardOptIn": True},
    )
    visible_again = client.get("/api/leaderboard")
    db_session.expire_all()

    assert visible.json()["total"] == 1
    assert disabled.json()["leaderboardOptIn"] is False
    assert hidden.json()["items"] == []
    assert private_statistics.json()["approvedContributions"] == 1
    assert private_statistics.json()["leaderboardEligible"] is False
    assert private_statistics.json()["publicRank"] is None
    assert restored.json()["leaderboardOptIn"] is True
    assert visible_again.json()["total"] == 1
    assert db_session.scalar(select(func.count()).select_from(Profile)) == 1
    stored = db_session.get(Contribution, contribution.id)
    assert stored is not None
    assert stored.user_id == original_ownership
    assert stored.review_status == original_review_status
    assert db_session.get(Profile, profile.id) is not None


def test_review_changes_update_counts_eligibility_and_rank_without_sync(
    db_session: Session,
) -> None:
    current = add_statistics_profile(
        db_session,
        profile_id=TEST_USER_ID,
        display_name="Dynamic Contributor",
        leaderboard_opt_in=True,
    )
    other = add_statistics_profile(
        db_session,
        profile_id=OTHER_USER_ID,
        display_name="Other Contributor",
        leaderboard_opt_in=True,
    )
    contribution = add_statistics_contribution(
        db_session,
        user_id=current.id,
        review_status="pending",
        audio_storage_key="audio/private/preserve-this.webm",
        original_filename="preserve-this.webm",
    )
    add_approved_contributions(db_session, user_id=other.id, count=2)
    original_owner = contribution.user_id
    original_audio = (
        contribution.audio_storage_key,
        contribution.original_filename,
        contribution.mime_type,
        contribution.file_size,
    )

    initial = get_profile_contribution_statistics(database=db_session, profile=current)
    apply_contribution_review(
        database=db_session,
        contribution_id=contribution.id,
        review_status="approved",
        rejection_reason=None,
    )
    after_approval = get_profile_contribution_statistics(
        database=db_session,
        profile=current,
    )
    apply_contribution_review(
        database=db_session,
        contribution_id=contribution.id,
        review_status="rejected",
        rejection_reason="Review changed",
    )
    after_rejection = get_profile_contribution_statistics(
        database=db_session,
        profile=current,
    )
    hidden_page = list_public_leaderboard(database=db_session, limit=20, offset=0)
    apply_contribution_review(
        database=db_session,
        contribution_id=contribution.id,
        review_status="approved",
        rejection_reason=None,
    )
    restored = get_profile_contribution_statistics(database=db_session, profile=current)
    restored_page = list_public_leaderboard(database=db_session, limit=20, offset=0)
    db_session.expire_all()
    stored = db_session.get(Contribution, contribution.id)

    assert initial.approved_contributions == 0
    assert initial.leaderboard_eligible is False
    assert after_approval.approved_contributions == 1
    assert after_approval.leaderboard_eligible is True
    assert after_approval.public_rank == 2
    assert after_rejection.approved_contributions == 0
    assert after_rejection.rejected_contributions == 1
    assert after_rejection.leaderboard_eligible is False
    assert all(item.display_name != current.display_name for item in hidden_page.items)
    assert restored.approved_contributions == 1
    assert restored.public_rank == 2
    assert {item.display_name for item in restored_page.items} == {
        current.display_name,
        other.display_name,
    }
    assert stored is not None
    assert stored.user_id == original_owner
    assert (
        stored.audio_storage_key,
        stored.original_filename,
        stored.mime_type,
        stored.file_size,
    ) == original_audio


def test_profile_has_no_denormalized_contribution_or_points_counters() -> None:
    columns = set(Profile.__table__.columns.keys())

    for forbidden in [
        "approved_count",
        "approved_contributions",
        "pending_count",
        "rejected_count",
        "total_contributions",
        "total_points",
        "points",
    ]:
        assert forbidden not in columns


def test_composite_review_owner_index_supports_dynamic_aggregation(
    db_session: Session,
) -> None:
    indexes = inspect(db_session.get_bind()).get_indexes("contributions")

    assert any(
        index["column_names"] == ["review_status", "user_id"]
        and index["name"] == "ix_contributions_review_status_user_id"
        for index in indexes
    )
