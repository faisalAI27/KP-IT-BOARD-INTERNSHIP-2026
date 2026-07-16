"""Point balance invariants across privacy, identity, and public ranking changes."""

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.main import app
from app.models import Contribution, PointLedgerEntry, Profile
from app.services.admin_contribution_review_service import apply_contribution_review
from app.services.points_ledger_service import (
    backfill_approved_contribution_points,
    get_personal_points,
)
from tests.points_ledger_helpers import (
    add_points_contribution,
    add_points_profile,
)


USER_A = "0d5dd8f5-93df-462b-b234-a16973089092"
USER_B = "93cdf86e-2d29-4b4f-a665-90b25b9d5f31"


def point_balance(database: Session, user_id: str) -> int:
    return get_personal_points(
        database=database,
        owner_user_id=user_id,
        limit=100,
        offset=0,
    ).balance


def test_backfilled_balance_equals_current_approved_owned_count(
    db_session: Session,
) -> None:
    add_points_profile(db_session, profile_id=USER_A)
    for status, revision in [
        ("approved", 1),
        ("approved", 1),
        ("pending", 0),
        ("rejected", 1),
    ]:
        add_points_contribution(
            db_session,
            user_id=USER_A,
            review_status=status,
            review_revision=revision,
        )
    add_points_contribution(
        db_session,
        user_id=None,
        review_status="approved",
        review_revision=1,
    )

    assert backfill_approved_contribution_points(db_session) == 2
    approved_owned = db_session.scalar(
        select(func.count())
        .select_from(Contribution)
        .where(
            Contribution.user_id == USER_A,
            Contribution.review_status == "approved",
        )
    )

    assert point_balance(db_session, USER_A) == approved_owned == 2


def test_approval_rejection_and_reapproval_track_current_state(
    db_session: Session,
) -> None:
    add_points_profile(db_session, profile_id=USER_A)
    contribution = add_points_contribution(
        db_session,
        user_id=USER_A,
        review_status="pending",
    )

    assert point_balance(db_session, USER_A) == 0
    apply_contribution_review(
        database=db_session,
        contribution_id=contribution.id,
        review_status="approved",
        rejection_reason=None,
    )
    assert point_balance(db_session, USER_A) == 1
    apply_contribution_review(
        database=db_session,
        contribution_id=contribution.id,
        review_status="rejected",
        rejection_reason="Correction",
    )
    assert point_balance(db_session, USER_A) == 0
    apply_contribution_review(
        database=db_session,
        contribution_id=contribution.id,
        review_status="approved",
        rejection_reason=None,
    )
    assert point_balance(db_session, USER_A) == 1


def test_leaderboard_opt_out_and_back_in_do_not_change_points(
    db_session: Session,
) -> None:
    profile = add_points_profile(
        db_session,
        profile_id=USER_A,
        leaderboard_opt_in=True,
    )
    add_points_contribution(
        db_session,
        user_id=USER_A,
        review_status="approved",
        review_revision=1,
    )
    backfill_approved_contribution_points(db_session)
    entry_ids = list(db_session.scalars(select(PointLedgerEntry.id)).all())

    profile.leaderboard_opt_in = False
    db_session.commit()
    opted_out_balance = point_balance(db_session, USER_A)
    profile.leaderboard_opt_in = True
    db_session.commit()

    assert opted_out_balance == point_balance(db_session, USER_A) == 1
    assert list(db_session.scalars(select(PointLedgerEntry.id)).all()) == entry_ids


def test_display_name_and_verified_identity_changes_do_not_change_points(
    db_session: Session,
) -> None:
    profile = add_points_profile(db_session, profile_id=USER_A)
    add_points_contribution(
        db_session,
        user_id=USER_A,
        review_status="approved",
        review_revision=1,
    )
    backfill_approved_contribution_points(db_session)
    entry_ids = list(db_session.scalars(select(PointLedgerEntry.id)).all())

    profile.display_name = "Renamed Contributor"
    profile.email = "new-verified@example.com"
    profile.auth_provider = "google"
    db_session.commit()

    assert point_balance(db_session, USER_A) == 1
    assert list(db_session.scalars(select(PointLedgerEntry.id)).all()) == entry_ids


def test_duplicate_display_names_do_not_merge_private_balances(
    db_session: Session,
) -> None:
    add_points_profile(db_session, profile_id=USER_A, display_name="Same Name")
    add_points_profile(db_session, profile_id=USER_B, display_name="Same Name")
    add_points_contribution(
        db_session,
        user_id=USER_A,
        review_status="approved",
        review_revision=1,
    )
    for _ in range(2):
        add_points_contribution(
            db_session,
            user_id=USER_B,
            review_status="approved",
            review_revision=1,
        )
    backfill_approved_contribution_points(db_session)

    assert point_balance(db_session, USER_A) == 1
    assert point_balance(db_session, USER_B) == 2


def test_legacy_approved_contributions_never_affect_balance(
    db_session: Session,
) -> None:
    add_points_profile(db_session, profile_id=USER_A)
    add_points_contribution(
        db_session,
        user_id=None,
        review_status="approved",
        review_revision=1,
    )

    assert backfill_approved_contribution_points(db_session) == 0
    assert point_balance(db_session, USER_A) == 0


def test_public_leaderboard_remains_approved_count_based(
    client: TestClient,
    db_session: Session,
) -> None:
    add_points_profile(
        db_session,
        profile_id=USER_A,
        display_name="One Approval",
        leaderboard_opt_in=True,
    )
    add_points_profile(
        db_session,
        profile_id=USER_B,
        display_name="Two Approvals",
        leaderboard_opt_in=True,
    )
    add_points_contribution(
        db_session,
        user_id=USER_A,
        review_status="approved",
        review_revision=1,
    )
    for _ in range(2):
        add_points_contribution(
            db_session,
            user_id=USER_B,
            review_status="approved",
            review_revision=1,
        )
    backfill_approved_contribution_points(db_session)

    response = client.get("/api/leaderboard")

    assert response.status_code == 200
    assert [item["approvedContributions"] for item in response.json()["items"]] == [
        2,
        1,
    ]
    assert all(
        set(item) == {"rank", "displayName", "approvedContributions"}
        for item in response.json()["items"]
    )
    assert "point" not in response.text.lower()


def test_profiles_and_statistics_have_no_mutable_point_counter() -> None:
    profile_columns = set(Profile.__table__.columns.keys())

    for forbidden in ["points", "point_balance", "points_balance", "total_points"]:
        assert forbidden not in profile_columns


def test_no_public_or_mutating_points_routes_are_registered() -> None:
    points_routes = [route for route in app.routes if "points" in route.path]

    assert [(route.path, route.methods) for route in points_routes] == [
        ("/api/profile/me/points", {"GET"})
    ]
    for forbidden in [
        "/api/profile/{user_id}/points",
        "/api/users/{user_id}/points",
        "/api/points/user/{user_id}",
    ]:
        assert not any(route.path == forbidden for route in app.routes)
