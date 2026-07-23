"""Append-only point ledger model, relationship, and response tests."""

from datetime import datetime, timezone
from uuid import UUID

import pytest
from pydantic import ValidationError
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Contribution, PointLedgerEntry, Profile
from app.models.point_ledger_entry import PointLedgerImmutabilityError
from app.schemas import PointLedgerItemResponse
from app.services.points_ledger_service import get_personal_points
from tests.points_ledger_helpers import (
    add_point_entry,
    add_points_contribution,
    add_points_profile,
)


USER_ID = "0d5dd8f5-93df-462b-b234-a16973089092"


def setup_owner_and_contribution(
    database: Session,
) -> tuple[Profile, Contribution]:
    profile = add_points_profile(database, profile_id=USER_ID)
    contribution = add_points_contribution(
        database,
        user_id=profile.id,
        review_status="approved",
        review_revision=1,
    )
    return profile, contribution


def test_valid_point_entry_is_created(db_session: Session) -> None:
    profile, contribution = setup_owner_and_contribution(db_session)

    entry = add_point_entry(
        db_session,
        user_id=profile.id,
        contribution_id=contribution.id,
        review_revision=1,
        entry_type="approval_award",
        points_delta=1,
    )

    assert db_session.get(PointLedgerEntry, entry.id) is entry
    assert entry.points_delta == 1


def test_point_entry_id_is_generated_locally(db_session: Session) -> None:
    profile, contribution = setup_owner_and_contribution(db_session)
    entry = PointLedgerEntry(
        user_id=profile.id,
        contribution_id=contribution.id,
        review_revision=1,
        entry_type="approval_award",
        points_delta=1,
    )
    db_session.add(entry)
    db_session.commit()

    assert str(UUID(entry.id)) == entry.id


@pytest.mark.parametrize("field", ["user_id", "contribution_id", "review_revision"])
def test_required_ledger_fields_are_enforced(
    field: str,
    db_session: Session,
) -> None:
    profile, contribution = setup_owner_and_contribution(db_session)
    values: dict[str, object] = {
        "user_id": profile.id,
        "contribution_id": contribution.id,
        "review_revision": 1,
        "entry_type": "approval_award",
        "points_delta": 1,
    }
    values[field] = None
    db_session.add(PointLedgerEntry(**values))

    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_entry_type_is_normalized_before_insert(db_session: Session) -> None:
    profile, contribution = setup_owner_and_contribution(db_session)

    entry = add_point_entry(
        db_session,
        user_id=profile.id,
        contribution_id=contribution.id,
        review_revision=1,
        entry_type="  APPROVAL_AWARD  ",
        points_delta=1,
    )

    assert entry.entry_type == "approval_award"


@pytest.mark.parametrize(
    ("entry_type", "points_delta"),
    [
        ("approval_award", 1),
        ("approved_backfill", 1),
        ("approval_reversal", -1),
    ],
)
def test_allowed_entry_type_and_delta_pairs(
    entry_type: str,
    points_delta: int,
    db_session: Session,
) -> None:
    profile, contribution = setup_owner_and_contribution(db_session)

    entry = add_point_entry(
        db_session,
        user_id=profile.id,
        contribution_id=contribution.id,
        review_revision=1,
        entry_type=entry_type,
        points_delta=points_delta,
    )

    assert entry.points_delta == points_delta


@pytest.mark.parametrize(
    ("entry_type", "points_delta"),
    [("manual_adjustment", 1), ("approval_award", -1), ("approval_reversal", 1)],
)
def test_invalid_entry_type_or_delta_is_rejected(
    entry_type: str,
    points_delta: int,
    db_session: Session,
) -> None:
    profile, contribution = setup_owner_and_contribution(db_session)
    db_session.add(
        PointLedgerEntry(
            user_id=profile.id,
            contribution_id=contribution.id,
            review_revision=1,
            entry_type=entry_type,
            points_delta=points_delta,
        )
    )

    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_created_timestamp_is_populated(db_session: Session) -> None:
    profile, contribution = setup_owner_and_contribution(db_session)
    entry = add_point_entry(
        db_session,
        user_id=profile.id,
        contribution_id=contribution.id,
        review_revision=1,
        entry_type="approval_award",
        points_delta=1,
    )

    assert entry.created_at is not None


def test_profile_and_contribution_relationships_work(db_session: Session) -> None:
    profile, contribution = setup_owner_and_contribution(db_session)
    entry = add_point_entry(
        db_session,
        user_id=profile.id,
        contribution_id=contribution.id,
        review_revision=1,
        entry_type="approval_award",
        points_delta=1,
    )

    assert entry.profile is profile
    assert entry.contribution is contribution
    assert profile.point_ledger_entries == [entry]
    assert contribution.point_ledger_entries == [entry]


def test_duplicate_contribution_revision_is_rejected(db_session: Session) -> None:
    profile, contribution = setup_owner_and_contribution(db_session)
    add_point_entry(
        db_session,
        user_id=profile.id,
        contribution_id=contribution.id,
        review_revision=1,
        entry_type="approval_award",
        points_delta=1,
    )
    db_session.add(
        PointLedgerEntry(
            user_id=profile.id,
            contribution_id=contribution.id,
            review_revision=1,
            entry_type="approved_backfill",
            points_delta=1,
        )
    )

    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_required_indexes_and_uniqueness_are_present(db_session: Session) -> None:
    inspector = inspect(db_session.get_bind())
    indexes = inspector.get_indexes("point_ledger_entries")
    unique_constraints = inspector.get_unique_constraints("point_ledger_entries")

    assert any(index["column_names"] == ["user_id"] for index in indexes)
    assert any(index["column_names"] == ["contribution_id"] for index in indexes)
    assert any(
        index["column_names"] == ["user_id", "created_at", "id"]
        for index in indexes
    )
    assert any(
        constraint["column_names"] == ["contribution_id", "review_revision"]
        for constraint in unique_constraints
    )


def test_relationships_have_no_destructive_delete_cascade() -> None:
    profile_relationship = inspect(Profile).relationships.point_ledger_entries
    contribution_relationship = inspect(Contribution).relationships.point_ledger_entries

    assert "delete" not in profile_relationship.cascade
    assert "delete-orphan" not in profile_relationship.cascade
    assert "delete" not in contribution_relationship.cascade
    assert "delete-orphan" not in contribution_relationship.cascade
    user_foreign_key = next(iter(PointLedgerEntry.__table__.c.user_id.foreign_keys))
    contribution_foreign_key = next(
        iter(PointLedgerEntry.__table__.c.contribution_id.foreign_keys)
    )
    assert user_foreign_key.ondelete is None
    assert contribution_foreign_key.ondelete is None


def test_persisted_entry_cannot_be_updated(db_session: Session) -> None:
    profile, contribution = setup_owner_and_contribution(db_session)
    entry = add_point_entry(
        db_session,
        user_id=profile.id,
        contribution_id=contribution.id,
        review_revision=1,
        entry_type="approval_award",
        points_delta=1,
    )
    entry.description = "Attempted edit"

    with pytest.raises(PointLedgerImmutabilityError):
        db_session.commit()
    db_session.rollback()


def test_persisted_entry_cannot_be_deleted(db_session: Session) -> None:
    profile, contribution = setup_owner_and_contribution(db_session)
    entry = add_point_entry(
        db_session,
        user_id=profile.id,
        contribution_id=contribution.id,
        review_revision=1,
        entry_type="approval_award",
        points_delta=1,
    )
    db_session.delete(entry)

    with pytest.raises(PointLedgerImmutabilityError):
        db_session.commit()
    db_session.rollback()


def test_private_response_uses_camel_case_and_utc_z(db_session: Session) -> None:
    profile, contribution = setup_owner_and_contribution(db_session)
    add_point_entry(
        db_session,
        user_id=profile.id,
        contribution_id=contribution.id,
        review_revision=1,
        entry_type="approval_award",
        points_delta=1,
        created_at=datetime(2026, 7, 16, 10, 0, tzinfo=timezone.utc),
    )

    page = get_personal_points(
        database=db_session,
        owner_user_id=profile.id,
        limit=20,
        offset=0,
    )
    response = PointLedgerItemResponse.model_validate(page.items[0]).model_dump(
        mode="json"
    )

    assert response == {
        "id": page.items[0].id,
        "entryType": "approvalAward",
        "pointsDelta": 1,
        "contributionId": contribution.id,
        "createdAt": "2026-07-16T10:00:00Z",
    }


def test_point_item_schema_forbids_private_fields() -> None:
    with pytest.raises(ValidationError):
        PointLedgerItemResponse.model_validate(
            {
                "id": "11111111-1111-4111-8111-111111111111",
                "entryType": "approvalAward",
                "pointsDelta": 1,
                "contributionId": "22222222-2222-4222-8222-222222222222",
                "createdAt": "2026-07-16T10:00:00Z",
                "userId": USER_ID,
                "email": "private@example.com",
                "accessToken": "private-token",
            }
        )
