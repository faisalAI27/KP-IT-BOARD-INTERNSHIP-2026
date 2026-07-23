"""Database-model and public-schema tests for local user profiles."""

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Profile
from app.schemas import ProfileResponse


USER_ID = "0d5dd8f5-93df-462b-b234-a16973089092"
OTHER_USER_ID = "93cdf86e-2d29-4b4f-a665-90b25b9d5f31"


def store_profile(database: Session, **values: object) -> Profile:
    defaults: dict[str, object] = {
        "id": USER_ID,
        "email": "person@example.com",
        "auth_provider": "google",
        "display_name": "Person",
    }
    defaults.update(values)
    profile = Profile(**defaults)
    database.add(profile)
    database.commit()
    database.refresh(profile)
    return profile


def test_valid_profile_is_created_with_supabase_primary_key(
    db_session: Session,
) -> None:
    profile = store_profile(db_session)

    assert profile.id == USER_ID
    assert db_session.get(Profile, USER_ID) is profile


def test_email_and_provider_may_be_null(db_session: Session) -> None:
    profile = store_profile(db_session, email=None, auth_provider=None)

    assert profile.email is None
    assert profile.auth_provider is None


def test_privacy_first_defaults_are_persisted(db_session: Session) -> None:
    profile = store_profile(db_session)

    assert profile.preferred_language == "Pashto"
    assert profile.leaderboard_opt_in is False


def test_all_profile_timestamps_are_populated(db_session: Session) -> None:
    profile = store_profile(db_session)

    assert isinstance(profile.created_at, datetime)
    assert isinstance(profile.updated_at, datetime)
    assert isinstance(profile.last_login_at, datetime)


def test_display_names_are_not_unique(db_session: Session) -> None:
    store_profile(db_session, display_name="Shared Name")
    store_profile(
        db_session,
        id=OTHER_USER_ID,
        email="other@example.com",
        display_name="Shared Name",
    )

    count = db_session.scalar(
        select(func.count()).select_from(Profile).where(
            Profile.display_name == "Shared Name"
        )
    )
    assert count == 2


def test_profile_response_uses_only_camel_case_public_fields(
    db_session: Session,
) -> None:
    profile = store_profile(db_session)

    response = ProfileResponse.model_validate(profile).model_dump(mode="json")

    assert set(response) == {
        "id",
        "email",
        "authProvider",
        "displayName",
        "preferredLanguage",
        "leaderboardOptIn",
        "createdAt",
        "updatedAt",
        "lastLoginAt",
    }
    assert response["authProvider"] == "google"
    assert response["leaderboardOptIn"] is False


def test_profile_response_serializes_naive_sqlite_timestamps_as_utc_z(
    db_session: Session,
) -> None:
    profile = store_profile(db_session)

    response = ProfileResponse.model_validate(profile).model_dump(mode="json")

    for field_name in ["createdAt", "updatedAt", "lastLoginAt"]:
        assert response[field_name].endswith("Z")


def test_profile_response_normalizes_aware_timestamps_to_utc() -> None:
    timestamp = datetime(2026, 7, 15, 12, 0, tzinfo=timezone.utc)
    profile = Profile(
        id=USER_ID,
        email=None,
        auth_provider=None,
        display_name="Contributor",
        preferred_language="Pashto",
        leaderboard_opt_in=False,
        created_at=timestamp,
        updated_at=timestamp,
        last_login_at=timestamp,
    )

    response = ProfileResponse.model_validate(profile).model_dump(mode="json")

    assert response["createdAt"] == "2026-07-15T12:00:00Z"


def test_profile_response_contains_no_auth_secrets_or_metadata(
    db_session: Session,
) -> None:
    profile = store_profile(db_session)

    response = ProfileResponse.model_validate(profile).model_dump(mode="json")
    serialized = str(response).lower()

    for forbidden in [
        "access_token",
        "refresh_token",
        "provider_token",
        "app_metadata",
        "user_metadata",
        "_sa_instance_state",
    ]:
        assert forbidden not in serialized
