"""Dataset export eligibility excludes unresolved and approved withdrawals."""

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.services.dataset_export_service import (
    is_contribution_export_eligible,
    list_export_eligible_contributions,
)
from tests.withdrawal_helpers import (
    add_withdrawal_contribution,
    add_withdrawal_profile,
    add_withdrawal_request,
)


def prepare(database: Session):
    add_withdrawal_profile(database)
    return add_withdrawal_contribution(database)


def test_approved_structured_consent_is_export_eligible(db_session: Session) -> None:
    contribution = prepare(db_session)

    assert is_contribution_export_eligible(
        database=db_session,
        contribution_id=contribution.id,
    ) is True


def test_requested_contribution_withdrawal_is_excluded(db_session: Session) -> None:
    contribution = prepare(db_session)
    add_withdrawal_request(db_session, contribution_id=contribution.id)

    assert is_contribution_export_eligible(
        database=db_session,
        contribution_id=contribution.id,
    ) is False


def test_approved_withdrawal_remains_excluded(db_session: Session) -> None:
    contribution = prepare(db_session)
    add_withdrawal_request(
        db_session,
        contribution_id=contribution.id,
        status="approved",
        resolution_reason="Approved exclusion.",
    )

    assert is_contribution_export_eligible(
        database=db_session,
        contribution_id=contribution.id,
    ) is False


def test_declined_withdrawal_does_not_exclude_otherwise_eligible_record(
    db_session: Session,
) -> None:
    contribution = prepare(db_session)
    add_withdrawal_request(
        db_session,
        contribution_id=contribution.id,
        status="declined",
        resolution_reason="Request could not be verified.",
    )

    assert is_contribution_export_eligible(
        database=db_session,
        contribution_id=contribution.id,
    ) is True


def test_all_scope_excludes_only_recordings_existing_at_request_time(
    db_session: Session,
) -> None:
    add_withdrawal_profile(db_session)
    request_time = datetime(2026, 7, 18, 10, 0, tzinfo=timezone.utc)
    existing = add_withdrawal_contribution(
        db_session,
        created_at=request_time - timedelta(minutes=1),
    )
    later = add_withdrawal_contribution(
        db_session,
        created_at=request_time + timedelta(minutes=1),
    )
    add_withdrawal_request(
        db_session,
        scope="all",
        requested_at=request_time,
    )

    eligible_ids = {
        item.id for item in list_export_eligible_contributions(database=db_session)
    }

    assert existing.id not in eligible_ids
    assert later.id in eligible_ids


def test_export_list_excludes_legacy_consent_pending_review_and_withdrawn(
    db_session: Session,
) -> None:
    add_withdrawal_profile(db_session)
    eligible = add_withdrawal_contribution(db_session)
    legacy = add_withdrawal_contribution(db_session, structured_consent=False)
    pending = add_withdrawal_contribution(db_session, review_status="pending")
    withdrawn = add_withdrawal_contribution(db_session)
    add_withdrawal_request(db_session, contribution_id=withdrawn.id)

    ids = {
        item.id for item in list_export_eligible_contributions(database=db_session)
    }

    assert ids == {eligible.id}
    assert legacy.id not in ids
    assert pending.id not in ids
    assert withdrawn.id not in ids
