"""Transactional behavior tests for the local profile service."""

from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.models import Profile
from app.schemas import ProfileUpdateRequest
from app.services.profile_service import (
    EmptyProfileUpdateError,
    InvalidDisplayNameError,
    InvalidLeaderboardPreferenceError,
    InvalidPreferredLanguageError,
    ProfilePersistenceError,
    get_or_create_profile,
    update_profile,
)
from app.services.supabase_auth import AuthenticatedUser


USER_ID = "0d5dd8f5-93df-462b-b234-a16973089092"


def authenticated_user(
    *,
    email: str | None = "person@example.com",
    provider: str | None = "google",
    display_name: str | None = None,
) -> AuthenticatedUser:
    return AuthenticatedUser(
        id=USER_ID,
        email=email,
        provider=provider,
        display_name=display_name,
    )


def profile_count(database: Session) -> int:
    return database.scalar(select(func.count()).select_from(Profile)) or 0


def update_request(**values: object) -> ProfileUpdateRequest:
    aliases = {
        "display_name": "displayName",
        "preferred_language": "preferredLanguage",
        "leaderboard_opt_in": "leaderboardOptIn",
    }
    return ProfileUpdateRequest.model_validate(
        {aliases.get(key, key): value for key, value in values.items()}
    )


def unsafe_update(**values: object) -> ProfileUpdateRequest:
    aliases = {
        "display_name": "displayName",
        "preferred_language": "preferredLanguage",
        "leaderboard_opt_in": "leaderboardOptIn",
    }
    translated = {aliases.get(key, key): value for key, value in values.items()}
    return ProfileUpdateRequest.model_construct(
        _fields_set=set(translated),
        **translated,
    )


def test_first_request_creates_one_profile(db_session: Session) -> None:
    profile = get_or_create_profile(
        database=db_session,
        authenticated_user=authenticated_user(),
    )

    assert profile.id == USER_ID
    assert profile_count(db_session) == 1


def test_repeated_request_returns_same_profile_without_duplicate(
    db_session: Session,
) -> None:
    first = get_or_create_profile(
        database=db_session,
        authenticated_user=authenticated_user(),
    )
    second = get_or_create_profile(
        database=db_session,
        authenticated_user=authenticated_user(),
    )

    assert first.id == second.id == USER_ID
    assert profile_count(db_session) == 1


def test_verified_email_and_provider_are_normalized(db_session: Session) -> None:
    profile = get_or_create_profile(
        database=db_session,
        authenticated_user=authenticated_user(
            email="  Person@Example.COM  ",
            provider="  GooGle  ",
        ),
    )

    assert profile.email == "person@example.com"
    assert profile.auth_provider == "google"


@pytest.mark.parametrize(
    ("email", "expected_name"),
    [
        ("faisal.imran@example.com", "Faisal Imran"),
        ("ayesha_khan@example.com", "Ayesha Khan"),
        ("bakht-zameen@example.com", "Bakht Zameen"),
    ],
)
def test_default_display_name_is_generated_from_email_separators(
    email: str,
    expected_name: str,
    db_session: Session,
) -> None:
    profile = get_or_create_profile(
        database=db_session,
        authenticated_user=authenticated_user(email=email),
    )

    assert profile.display_name == expected_name


def test_new_profile_uses_verified_auth_display_name(db_session: Session) -> None:
    profile = get_or_create_profile(
        database=db_session,
        authenticated_user=authenticated_user(display_name="  فیصل عمران  "),
    )

    assert profile.display_name == "فیصل عمران"


@pytest.mark.parametrize("email", [None, "---@example.com", "a@example.com"])
def test_missing_or_unusable_email_uses_contributor(
    email: str | None,
    db_session: Session,
) -> None:
    profile = get_or_create_profile(
        database=db_session,
        authenticated_user=authenticated_user(email=email),
    )

    assert profile.display_name == "Contributor"


def test_new_profile_uses_private_pashto_defaults(db_session: Session) -> None:
    profile = get_or_create_profile(
        database=db_session,
        authenticated_user=authenticated_user(),
    )

    assert profile.preferred_language == "Pashto"
    assert profile.leaderboard_opt_in is False


def test_existing_identity_synchronizes_without_overwriting_preferences(
    db_session: Session,
) -> None:
    profile = get_or_create_profile(
        database=db_session,
        authenticated_user=authenticated_user(),
    )
    profile.display_name = "زما نوم"
    profile.preferred_language = "Hindko"
    profile.leaderboard_opt_in = True
    db_session.commit()
    previous_login = profile.last_login_at

    synchronized = get_or_create_profile(
        database=db_session,
        authenticated_user=authenticated_user(
            email="NEW@EXAMPLE.COM",
            provider="EMAIL",
            display_name="Should Not Replace Edited Name",
        ),
    )

    assert synchronized.email == "new@example.com"
    assert synchronized.auth_provider == "email"
    assert synchronized.last_login_at != previous_login
    assert synchronized.display_name == "زما نوم"
    assert synchronized.preferred_language == "Hindko"
    assert synchronized.leaderboard_opt_in is True


def test_valid_display_name_update_is_trimmed(db_session: Session) -> None:
    profile = update_profile(
        database=db_session,
        authenticated_user=authenticated_user(),
        updates=update_request(display_name="  Faisal Imran  "),
    )

    assert profile.display_name == "Faisal Imran"


def test_unicode_pashto_display_name_update_succeeds(db_session: Session) -> None:
    profile = update_profile(
        database=db_session,
        authenticated_user=authenticated_user(),
        updates=update_request(display_name="فیصل عمران"),
    )

    assert profile.display_name == "فیصل عمران"


@pytest.mark.parametrize("display_name", ["A", " ", "x" * 81, None, 42])
def test_invalid_display_names_fail_at_service_boundary(
    display_name: object,
    db_session: Session,
) -> None:
    with pytest.raises(InvalidDisplayNameError):
        update_profile(
            database=db_session,
            authenticated_user=authenticated_user(),
            updates=unsafe_update(display_name=display_name),
        )


def test_preferred_language_update_uses_existing_normalizer(
    db_session: Session,
) -> None:
    profile = update_profile(
        database=db_session,
        authenticated_user=authenticated_user(),
        updates=update_request(preferred_language="  pASHTO   LANGUAGE  "),
    )

    assert profile.preferred_language == "Pashto Language"


@pytest.mark.parametrize("language", ["", "   ", "x" * 101, None, 42])
def test_invalid_preferred_languages_fail_at_service_boundary(
    language: object,
    db_session: Session,
) -> None:
    with pytest.raises(InvalidPreferredLanguageError):
        update_profile(
            database=db_session,
            authenticated_user=authenticated_user(),
            updates=unsafe_update(preferred_language=language),
        )


@pytest.mark.parametrize("preference", [True, False])
def test_leaderboard_preference_updates(
    preference: bool,
    db_session: Session,
) -> None:
    profile = update_profile(
        database=db_session,
        authenticated_user=authenticated_user(),
        updates=update_request(leaderboard_opt_in=preference),
    )

    assert profile.leaderboard_opt_in is preference


def test_non_boolean_leaderboard_value_fails_at_service_boundary(
    db_session: Session,
) -> None:
    with pytest.raises(InvalidLeaderboardPreferenceError):
        update_profile(
            database=db_session,
            authenticated_user=authenticated_user(),
            updates=unsafe_update(leaderboard_opt_in="true"),
        )


def test_empty_update_fails_at_service_boundary(db_session: Session) -> None:
    updates = ProfileUpdateRequest.model_construct(_fields_set=set())

    with pytest.raises(EmptyProfileUpdateError):
        update_profile(
            database=db_session,
            authenticated_user=authenticated_user(),
            updates=updates,
        )


def test_update_synchronizes_identity_and_last_login(db_session: Session) -> None:
    original = get_or_create_profile(
        database=db_session,
        authenticated_user=authenticated_user(),
    )
    previous_login = original.last_login_at
    previous_updated = original.updated_at

    updated = update_profile(
        database=db_session,
        authenticated_user=authenticated_user(
            email="Updated@Example.com",
            provider="EMAIL",
        ),
        updates=update_request(display_name="Updated Person"),
    )

    assert updated.email == "updated@example.com"
    assert updated.auth_provider == "email"
    assert updated.last_login_at != previous_login
    assert updated.updated_at != previous_updated


class FailingDatabase:
    """Minimal session fake proving safe rollback on persistence failure."""

    def __init__(self) -> None:
        self.rollback_calls = 0

    def get(self, _model: object, _key: str) -> None:
        return None

    def add(self, _profile: Profile) -> None:
        pass

    def commit(self) -> None:
        raise SQLAlchemyError("private database failure")

    def rollback(self) -> None:
        self.rollback_calls += 1


def test_database_failure_rolls_back_with_safe_error() -> None:
    database = FailingDatabase()

    with pytest.raises(ProfilePersistenceError) as raised:
        get_or_create_profile(
            database=database,  # type: ignore[arg-type]
            authenticated_user=authenticated_user(),
        )

    assert database.rollback_calls == 1
    assert "private database failure" not in str(raised.value)


class RacingDatabase:
    """Session fake representing another request winning the first insert."""

    def __init__(self, existing: Profile) -> None:
        self.existing = existing
        self.get_calls = 0
        self.commit_calls = 0
        self.rollback_calls = 0
        self.refresh_calls = 0

    def get(self, _model: object, _key: str) -> Profile | None:
        self.get_calls += 1
        return None if self.get_calls == 1 else self.existing

    def add(self, _profile: Profile) -> None:
        pass

    def commit(self) -> None:
        self.commit_calls += 1
        if self.commit_calls == 1:
            raise IntegrityError("insert", {}, Exception("unique race"))

    def rollback(self) -> None:
        self.rollback_calls += 1

    def refresh(self, _profile: Profile) -> None:
        self.refresh_calls += 1


def test_concurrent_first_create_race_returns_existing_profile() -> None:
    timestamp = datetime(2026, 7, 15, 12, 0, tzinfo=timezone.utc)
    existing = Profile(
        id=USER_ID,
        email="old@example.com",
        auth_provider="email",
        display_name="Kept Name",
        preferred_language="Hindko",
        leaderboard_opt_in=True,
        created_at=timestamp,
        updated_at=timestamp,
        last_login_at=timestamp,
    )
    database = RacingDatabase(existing)

    profile = get_or_create_profile(
        database=database,  # type: ignore[arg-type]
        authenticated_user=authenticated_user(),
    )

    assert profile is existing
    assert database.rollback_calls == 1
    assert database.commit_calls == 2
    assert database.refresh_calls == 1
    assert profile.email == "person@example.com"
    assert profile.display_name == "Kept Name"
