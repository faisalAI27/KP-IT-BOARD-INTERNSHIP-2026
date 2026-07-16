"""Database constraints and public/admin schema tests for contributions."""

from datetime import datetime, timezone
from uuid import UUID

import pytest
from sqlalchemy import func, inspect, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Contribution, Profile, Sentence
from app.schemas import AdminContributionResponse, ContributionCreatedResponse
from app.utils.text_normalization import normalize_sentence_text


USER_ID = "0d5dd8f5-93df-462b-b234-a16973089092"


def store_profile(database: Session) -> Profile:
    profile = Profile(
        id=USER_ID,
        email="person@example.com",
        auth_provider="google",
        display_name="Person",
    )
    database.add(profile)
    database.commit()
    return profile


def make_contribution(**values: object) -> Contribution:
    defaults: dict[str, object] = {
        "contribution_type": "guided",
        "contributor_name": "Test Contributor",
        "language": "Pashto",
        "sentence_id": None,
        "sentence_text": "هر غږ ارزښت لري.",
        "sentence_source": "provided",
        "topic": None,
        "audio_storage_key": "audio/2026/07/14/example.webm",
        "original_filename": "recording.webm",
        "mime_type": "audio/webm",
        "file_size": 128,
        "duration_seconds": None,
    }
    defaults.update(values)
    return Contribution(**defaults)


def store_contribution(database: Session, **values: object) -> Contribution:
    contribution = make_contribution(**values)
    database.add(contribution)
    database.commit()
    return contribution


def assert_constraint_failure(database: Session, **values: object) -> None:
    database.add(make_contribution(**values))
    with pytest.raises(IntegrityError):
        database.commit()
    database.rollback()
    assert database.scalar(select(func.count()).select_from(Contribution)) == 0


def test_valid_guided_contribution_can_be_created(db_session: Session) -> None:
    contribution = store_contribution(db_session)

    assert contribution.contribution_type == "guided"
    assert contribution.sentence_text == "هر غږ ارزښت لري."
    assert contribution.sentence_source == "provided"


def test_valid_open_recording_can_be_created(db_session: Session) -> None:
    contribution = store_contribution(
        db_session,
        contribution_type="open_recording",
        sentence_text=None,
        sentence_source=None,
        topic="زما د کلي کیسه",
    )

    assert contribution.contribution_type == "open_recording"
    assert contribution.sentence_text is None
    assert contribution.topic == "زما د کلي کیسه"


def test_status_defaults_to_queued(db_session: Session) -> None:
    assert store_contribution(db_session).status == "queued"


def test_review_fields_default_to_pending_and_null(db_session: Session) -> None:
    contribution = store_contribution(db_session)

    assert contribution.review_status == "pending"
    assert contribution.reviewed_at is None
    assert contribution.rejection_reason is None


def test_review_status_is_required_indexed_string(db_session: Session) -> None:
    column = Contribution.__table__.columns.review_status
    indexes = inspect(db_session.get_bind()).get_indexes("contributions")

    assert column.nullable is False
    assert column.type.length == 20
    assert any(index["column_names"] == ["review_status"] for index in indexes)


def test_review_values_are_normalized_before_persistence(
    db_session: Session,
) -> None:
    contribution = store_contribution(
        db_session,
        review_status=" REJECTED ",
        rejection_reason="  Audio is too noisy.  ",
    )

    assert contribution.review_status == "rejected"
    assert contribution.rejection_reason == "Audio is too noisy."


def test_approved_review_clears_rejection_reason(db_session: Session) -> None:
    contribution = store_contribution(
        db_session,
        review_status="approved",
        rejection_reason="old reason",
    )

    assert contribution.rejection_reason is None


def test_invalid_review_status_fails_constraint(db_session: Session) -> None:
    assert_constraint_failure(db_session, review_status="invalid")


def test_rejection_reason_over_500_characters_fails_constraint(
    db_session: Session,
) -> None:
    assert_constraint_failure(
        db_session,
        review_status="rejected",
        rejection_reason="x" * 501,
    )


def test_consent_defaults_to_false(db_session: Session) -> None:
    assert store_contribution(db_session).consent_given is False


def test_generated_id_is_valid_uuid(db_session: Session) -> None:
    contribution = store_contribution(db_session)

    assert str(UUID(contribution.id)) == contribution.id


def test_created_and_updated_timestamps_are_populated(db_session: Session) -> None:
    contribution = store_contribution(db_session)

    assert contribution.created_at is not None
    assert contribution.updated_at is not None


@pytest.mark.parametrize(
    "contribution_status", ["queued", "approved", "rejected", "needs_review"]
)
def test_valid_statuses_are_accepted(
    contribution_status: str, db_session: Session
) -> None:
    contribution = store_contribution(db_session, status=contribution_status)

    assert contribution.status == contribution_status


def test_invalid_status_fails_constraint(db_session: Session) -> None:
    assert_constraint_failure(db_session, status="invalid")


@pytest.mark.parametrize("contribution_type", ["guided", "open_recording"])
def test_valid_contribution_types_are_accepted(
    contribution_type: str, db_session: Session
) -> None:
    contribution = store_contribution(
        db_session,
        contribution_type=contribution_type,
    )

    assert contribution.contribution_type == contribution_type


def test_invalid_contribution_type_fails_constraint(db_session: Session) -> None:
    assert_constraint_failure(db_session, contribution_type="invalid")


@pytest.mark.parametrize("sentence_source", ["provided", "custom", None])
def test_valid_sentence_sources_are_accepted(
    sentence_source: str | None, db_session: Session
) -> None:
    contribution = store_contribution(db_session, sentence_source=sentence_source)

    assert contribution.sentence_source == sentence_source


def test_invalid_sentence_source_fails_constraint(db_session: Session) -> None:
    assert_constraint_failure(db_session, sentence_source="invalid")


@pytest.mark.parametrize("file_size", [0, -1])
def test_file_size_must_be_positive(file_size: int, db_session: Session) -> None:
    assert_constraint_failure(db_session, file_size=file_size)


@pytest.mark.parametrize("duration", [None, 0, 1.5])
def test_non_negative_or_null_duration_is_accepted(
    duration: float | None, db_session: Session
) -> None:
    contribution = store_contribution(db_session, duration_seconds=duration)

    assert contribution.duration_seconds == duration


def test_negative_duration_fails_constraint(db_session: Session) -> None:
    assert_constraint_failure(db_session, duration_seconds=-0.1)


def test_sentence_id_may_be_null(db_session: Session) -> None:
    assert store_contribution(db_session, sentence_id=None).sentence_id is None


def test_legacy_contribution_owner_may_be_null(db_session: Session) -> None:
    assert store_contribution(db_session, user_id=None).user_id is None


def test_contribution_may_reference_profile(db_session: Session) -> None:
    profile = store_profile(db_session)
    contribution = store_contribution(db_session, user_id=profile.id)

    assert contribution.user_id == USER_ID
    assert contribution.profile is profile
    assert profile.contributions == [contribution]


def test_user_id_is_nullable_indexed_uuid_length_column(
    db_session: Session,
) -> None:
    column = Contribution.__table__.columns.user_id
    indexes = inspect(db_session.get_bind()).get_indexes("contributions")

    assert column.nullable is True
    assert column.type.length == 36
    assert any(index["column_names"] == ["user_id"] for index in indexes)


def test_deleting_profile_does_not_delete_contribution(
    db_session: Session,
) -> None:
    profile = store_profile(db_session)
    contribution = store_contribution(db_session, user_id=profile.id)
    contribution_id = contribution.id

    db_session.delete(profile)
    db_session.commit()

    assert db_session.get(Contribution, contribution_id) is not None


def test_sentence_snapshot_is_independent_from_related_sentence(
    db_session: Session,
) -> None:
    sentence = Sentence(
        language="Pashto",
        text="اوسنۍ جمله",
        meaning=None,
        normalized_text=normalize_sentence_text("اوسنۍ جمله"),
        source_type="custom",
        source_filename=None,
        is_active=True,
    )
    db_session.add(sentence)
    db_session.commit()
    contribution = store_contribution(
        db_session,
        sentence_id=sentence.id,
        sentence_text="ساتل شوې تاریخي جمله",
    )
    sentence.text = "بدله شوې جمله"
    db_session.commit()

    assert contribution.sentence_id == sentence.id
    assert contribution.sentence_text == "ساتل شوې تاریخي جمله"


def test_language_is_normalized_like_sentences(db_session: Session) -> None:
    contribution = store_contribution(db_session, language="  pASHTO  ")

    assert contribution.language == "Pashto"


def test_public_response_uses_created_at_alias_only(db_session: Session) -> None:
    contribution = store_contribution(db_session)

    serialized = ContributionCreatedResponse.model_validate(contribution).model_dump(
        mode="json"
    )

    assert set(serialized) == {"id", "status", "createdAt"}
    assert "created_at" not in serialized
    assert "audio_storage_key" not in serialized


def test_approved_admin_response_uses_safe_camel_case_fields(
    db_session: Session,
) -> None:
    profile = store_profile(db_session)
    reviewed_at = datetime(2026, 7, 16, 12, 30, tzinfo=timezone.utc)
    contribution = store_contribution(
        db_session,
        user_id=profile.id,
        review_status="approved",
        reviewed_at=reviewed_at,
    )

    serialized = AdminContributionResponse.from_contribution(
        contribution
    ).model_dump(mode="json")

    assert serialized["reviewStatus"] == "approved"
    assert serialized["reviewedAt"].endswith("Z")
    assert serialized["rejectionReason"] is None
    assert serialized["hasOwner"] is True
    assert serialized["ownerDisplayName"] == "Person"


def test_rejected_admin_response_is_safe_and_excludes_secrets(
    db_session: Session,
) -> None:
    contribution = store_contribution(
        db_session,
        review_status="rejected",
        reviewed_at=datetime(2026, 7, 16, 12, 30),
        rejection_reason="Audio is too noisy.",
    )

    serialized = AdminContributionResponse.from_contribution(
        contribution
    ).model_dump(mode="json")
    serialized_text = str(serialized).lower()

    assert serialized["reviewStatus"] == "rejected"
    assert serialized["reviewedAt"].endswith("Z")
    assert serialized["rejectionReason"] == "Audio is too noisy."
    assert serialized["hasOwner"] is False
    for forbidden in [
        "audio_storage_key",
        "audio/2026",
        "access_token",
        "refresh_token",
        "admin_api_key",
        "_sa_instance_state",
    ]:
        assert forbidden not in serialized_text
