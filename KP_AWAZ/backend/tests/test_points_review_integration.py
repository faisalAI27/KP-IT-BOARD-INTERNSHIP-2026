"""Atomic admin review transitions and append-only point-effect tests."""

from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Contribution, PointLedgerEntry
from app.services import admin_contribution_review_service as review_service
from app.services.admin_contribution_review_service import (
    ContributionPointsPersistenceError,
    apply_contribution_review,
)
from app.services.audio_storage import resolve_audio_storage_path
from app.services.points_ledger_service import (
    InvalidPointTransitionError,
    PointsLedgerPersistenceError,
    backfill_approved_contribution_points,
    create_review_point_entry,
    get_personal_points,
)
from tests.admin_contribution_review_helpers import (
    add_review_contribution,
    add_review_profile,
)
from tests.conftest import TestingSessionLocal
from tests.points_ledger_helpers import (
    add_points_contribution,
    add_points_profile,
)


USER_ID = "0d5dd8f5-93df-462b-b234-a16973089092"


def ledger_entries(database: Session) -> list[PointLedgerEntry]:
    return list(
        database.scalars(
            select(PointLedgerEntry).order_by(PointLedgerEntry.review_revision)
        ).all()
    )


def balance(database: Session, user_id: str = USER_ID) -> int:
    return get_personal_points(
        database=database,
        owner_user_id=user_id,
        limit=100,
        offset=0,
    ).balance


def setup_pending_owned(database: Session) -> Contribution:
    profile = add_points_profile(database, profile_id=USER_ID)
    return add_points_contribution(
        database,
        user_id=profile.id,
        review_status="pending",
        review_revision=0,
    )


def test_pending_to_approved_creates_one_award_and_revision(
    db_session: Session,
) -> None:
    contribution = setup_pending_owned(db_session)

    reviewed = apply_contribution_review(
        database=db_session,
        contribution_id=contribution.id,
        review_status="approved",
        rejection_reason=None,
    )
    entries = ledger_entries(db_session)

    assert reviewed.review_status == "approved"
    assert reviewed.review_revision == 1
    assert len(entries) == 1
    assert entries[0].entry_type == "approval_award"
    assert entries[0].points_delta == 1
    assert entries[0].review_revision == 1
    assert balance(db_session) == 1


def test_rejected_to_approved_creates_award(db_session: Session) -> None:
    profile = add_points_profile(db_session, profile_id=USER_ID)
    contribution = add_points_contribution(
        db_session,
        user_id=profile.id,
        review_status="rejected",
        review_revision=1,
    )

    reviewed = apply_contribution_review(
        database=db_session,
        contribution_id=contribution.id,
        review_status="approved",
        rejection_reason=None,
    )

    assert reviewed.review_revision == 2
    assert [(entry.entry_type, entry.points_delta) for entry in ledger_entries(db_session)] == [
        ("approval_award", 1)
    ]


def test_approved_to_rejected_creates_reversal(db_session: Session) -> None:
    profile = add_points_profile(db_session, profile_id=USER_ID)
    contribution = add_points_contribution(
        db_session,
        user_id=profile.id,
        review_status="approved",
        review_revision=1,
    )
    assert backfill_approved_contribution_points(db_session) == 1

    reviewed = apply_contribution_review(
        database=db_session,
        contribution_id=contribution.id,
        review_status="rejected",
        rejection_reason="Audio is clipped",
    )
    entries = ledger_entries(db_session)

    assert reviewed.review_revision == 2
    assert [(entry.entry_type, entry.points_delta) for entry in entries] == [
        ("approved_backfill", 1),
        ("approval_reversal", -1),
    ]
    assert balance(db_session) == 0


def test_pending_to_rejected_increments_revision_without_points(
    db_session: Session,
) -> None:
    contribution = setup_pending_owned(db_session)

    reviewed = apply_contribution_review(
        database=db_session,
        contribution_id=contribution.id,
        review_status="rejected",
        rejection_reason="Too noisy",
    )

    assert reviewed.review_revision == 1
    assert ledger_entries(db_session) == []
    assert balance(db_session) == 0


def test_same_approval_repeated_is_fully_idempotent(db_session: Session) -> None:
    contribution = setup_pending_owned(db_session)
    first = apply_contribution_review(
        database=db_session,
        contribution_id=contribution.id,
        review_status="approved",
        rejection_reason=None,
    )
    first_timestamp = first.reviewed_at

    second = apply_contribution_review(
        database=db_session,
        contribution_id=contribution.id,
        review_status="approved",
        rejection_reason=None,
    )

    assert second.review_revision == 1
    assert second.reviewed_at == first_timestamp
    assert len(ledger_entries(db_session)) == 1
    assert balance(db_session) == 1


def test_same_rejection_repeated_is_fully_idempotent(db_session: Session) -> None:
    contribution = setup_pending_owned(db_session)
    first = apply_contribution_review(
        database=db_session,
        contribution_id=contribution.id,
        review_status="rejected",
        rejection_reason="Too noisy",
    )
    first_timestamp = first.reviewed_at

    second = apply_contribution_review(
        database=db_session,
        contribution_id=contribution.id,
        review_status="rejected",
        rejection_reason="  Too noisy  ",
    )

    assert second.review_revision == 1
    assert second.reviewed_at == first_timestamp
    assert ledger_entries(db_session) == []


def test_rejection_reason_correction_increments_revision_without_points(
    db_session: Session,
) -> None:
    profile = add_points_profile(db_session, profile_id=USER_ID)
    contribution = add_points_contribution(
        db_session,
        user_id=profile.id,
        review_status="rejected",
        review_revision=1,
    )

    reviewed = apply_contribution_review(
        database=db_session,
        contribution_id=contribution.id,
        review_status="rejected",
        rejection_reason="A clearer corrected reason",
    )

    assert reviewed.review_revision == 2
    assert reviewed.rejection_reason == "A clearer corrected reason"
    assert ledger_entries(db_session) == []


def test_approval_reversal_reapproval_is_append_only_and_balanced(
    db_session: Session,
) -> None:
    contribution = setup_pending_owned(db_session)

    apply_contribution_review(
        database=db_session,
        contribution_id=contribution.id,
        review_status="approved",
        rejection_reason=None,
    )
    first_ids = [entry.id for entry in ledger_entries(db_session)]
    apply_contribution_review(
        database=db_session,
        contribution_id=contribution.id,
        review_status="rejected",
        rejection_reason="Correction required",
    )
    apply_contribution_review(
        database=db_session,
        contribution_id=contribution.id,
        review_status="approved",
        rejection_reason=None,
    )
    entries = ledger_entries(db_session)

    assert [entry.review_revision for entry in entries] == [1, 2, 3]
    assert [(entry.entry_type, entry.points_delta) for entry in entries] == [
        ("approval_award", 1),
        ("approval_reversal", -1),
        ("approval_award", 1),
    ]
    assert entries[0].id == first_ids[0]
    assert balance(db_session) == 1


def test_valid_review_sequences_never_produce_negative_balance(
    db_session: Session,
) -> None:
    contribution = setup_pending_owned(db_session)
    observed = [balance(db_session)]
    for status, reason in [
        ("rejected", "First rejection"),
        ("approved", None),
        ("rejected", "Second rejection"),
        ("approved", None),
    ]:
        apply_contribution_review(
            database=db_session,
            contribution_id=contribution.id,
            review_status=status,
            rejection_reason=reason,
        )
        observed.append(balance(db_session))

    assert observed == [0, 0, 1, 0, 1]
    assert min(observed) >= 0


def test_legacy_and_orphaned_approvals_create_no_points(
    db_session: Session,
) -> None:
    legacy = add_points_contribution(
        db_session,
        user_id=None,
        review_status="pending",
    )
    orphan = add_points_contribution(
        db_session,
        user_id="93cdf86e-2d29-4b4f-a665-90b25b9d5f31",
        review_status="pending",
    )

    for contribution in [legacy, orphan]:
        apply_contribution_review(
            database=db_session,
            contribution_id=contribution.id,
            review_status="approved",
            rejection_reason=None,
        )

    assert ledger_entries(db_session) == []


def test_internal_invalid_review_transition_is_rejected_safely(
    db_session: Session,
) -> None:
    contribution = setup_pending_owned(db_session)
    contribution.review_status = "approved"
    contribution.review_revision = 1

    with pytest.raises(InvalidPointTransitionError) as captured:
        create_review_point_entry(
            database=db_session,
            contribution=contribution,
            previous_status="unknown",
        )

    assert "unknown" not in str(captured.value)


def test_point_failure_rolls_back_review_status_revision_and_timestamp(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    contribution = setup_pending_owned(db_session)
    original_timestamp = contribution.reviewed_at

    def fail_points(**_arguments: object):
        raise PointsLedgerPersistenceError()

    monkeypatch.setattr(review_service, "create_review_point_entry", fail_points)

    with pytest.raises(ContributionPointsPersistenceError):
        apply_contribution_review(
            database=db_session,
            contribution_id=contribution.id,
            review_status="approved",
            rejection_reason=None,
        )
    db_session.expire_all()
    stored = db_session.get(Contribution, contribution.id)

    assert stored is not None
    assert stored.review_status == "pending"
    assert stored.review_revision == 0
    assert stored.reviewed_at == original_timestamp
    assert ledger_entries(db_session) == []


def test_concurrent_duplicate_approval_cannot_double_award(
    db_session: Session,
) -> None:
    contribution = setup_pending_owned(db_session)
    first_session = TestingSessionLocal()
    second_session = TestingSessionLocal()
    try:
        first_snapshot = first_session.get(Contribution, contribution.id)
        second_snapshot = second_session.get(Contribution, contribution.id)
        assert first_snapshot is not None
        assert second_snapshot is not None
        assert first_snapshot.review_status == "pending"
        assert second_snapshot.review_status == "pending"

        first = apply_contribution_review(
            database=first_session,
            contribution_id=contribution.id,
            review_status="approved",
            rejection_reason=None,
        )
        second = apply_contribution_review(
            database=second_session,
            contribution_id=contribution.id,
            review_status="approved",
            rejection_reason=None,
        )

        assert first.review_revision == second.review_revision == 1
    finally:
        first_session.close()
        second_session.close()

    db_session.expire_all()
    assert len(ledger_entries(db_session)) == 1
    assert balance(db_session) == 1


def test_review_preserves_owner_audio_metadata_and_rejected_audio_file(
    db_session: Session,
) -> None:
    profile = add_review_profile(db_session, profile_id=USER_ID)
    contribution = add_review_contribution(
        db_session,
        user_id=profile.id,
        with_audio=True,
    )
    audio_path = resolve_audio_storage_path(contribution.audio_storage_key)
    original_audio = audio_path.read_bytes()
    original_metadata = (
        contribution.user_id,
        contribution.audio_storage_key,
        contribution.original_filename,
        contribution.mime_type,
        contribution.file_size,
    )

    apply_contribution_review(
        database=db_session,
        contribution_id=contribution.id,
        review_status="approved",
        rejection_reason=None,
    )
    apply_contribution_review(
        database=db_session,
        contribution_id=contribution.id,
        review_status="rejected",
        rejection_reason="Audio review correction",
    )
    db_session.expire_all()
    stored = db_session.get(Contribution, contribution.id)

    assert stored is not None
    assert (
        stored.user_id,
        stored.audio_storage_key,
        stored.original_filename,
        stored.mime_type,
        stored.file_size,
    ) == original_metadata
    assert audio_path.exists()
    assert audio_path.read_bytes() == original_audio


def test_revision_and_ledger_are_internal_not_added_to_admin_response(
    client,
    db_session: Session,
) -> None:
    contribution = setup_pending_owned(db_session)
    from tests.admin_contribution_review_helpers import admin_headers

    response = client.patch(
        f"/api/admin/contributions/{contribution.id}/review",
        headers=admin_headers(),
        json={"status": "approved", "reviewRevision": 999},
    )

    assert response.status_code == 422
    assert "999" not in response.text
