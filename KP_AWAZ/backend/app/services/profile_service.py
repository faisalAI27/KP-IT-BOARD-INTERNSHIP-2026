"""Transactional creation, synchronization, and editing of local profiles."""

import re
from datetime import datetime, timezone

from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.models.profile import Profile
from app.schemas.profile import ProfileUpdateRequest
from app.services.supabase_auth import AuthenticatedUser
from app.utils.text_normalization import normalize_language_name


class ProfileServiceError(Exception):
    """Base class for safe profile failures returned by the API."""

    code = "PROFILE_SERVICE_ERROR"
    message = "The profile request could not be completed."
    http_status = 500

    def __init__(self) -> None:
        super().__init__(self.message)


class InvalidDisplayNameError(ProfileServiceError):
    code = "INVALID_DISPLAY_NAME"
    message = "Display name must contain between 2 and 80 characters."
    http_status = 400


class InvalidPreferredLanguageError(ProfileServiceError):
    code = "INVALID_PREFERRED_LANGUAGE"
    message = "Preferred language must contain between 1 and 100 characters."
    http_status = 400


class EmptyProfileUpdateError(ProfileServiceError):
    code = "EMPTY_PROFILE_UPDATE"
    message = "At least one profile field must be supplied."
    http_status = 400


class InvalidLeaderboardPreferenceError(ProfileServiceError):
    code = "INVALID_LEADERBOARD_PREFERENCE"
    message = "Leaderboard preference must be true or false."
    http_status = 400


class ProfilePersistenceError(ProfileServiceError):
    code = "PROFILE_PERSISTENCE_FAILED"
    message = "The profile could not be saved. Please try again."
    http_status = 500


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_verified_email(email: str | None) -> str | None:
    if email is None:
        return None
    if not isinstance(email, str):
        raise ProfilePersistenceError()
    normalized = email.strip().lower() or None
    if normalized is not None and len(normalized) > 320:
        raise ProfilePersistenceError()
    return normalized


def _normalize_verified_provider(provider: str | None) -> str | None:
    if provider is None:
        return None
    if not isinstance(provider, str):
        raise ProfilePersistenceError()
    normalized = provider.strip().lower() or None
    if normalized is not None and len(normalized) > 50:
        raise ProfilePersistenceError()
    return normalized


def _default_display_name(email: str | None) -> str:
    if not email:
        return "Contributor"

    local_part = email.split("@", 1)[0]
    separated = re.sub(r"[._-]+", " ", local_part)
    cleaned = " ".join(separated.split())
    if len(cleaned) < 2:
        return "Contributor"
    return cleaned[:80].title()


def _validated_display_name(value: object) -> str:
    if not isinstance(value, str):
        raise InvalidDisplayNameError()
    cleaned = value.strip()
    if not 2 <= len(cleaned) <= 80:
        raise InvalidDisplayNameError()
    return cleaned


def _validated_preferred_language(value: object) -> str:
    if not isinstance(value, str):
        raise InvalidPreferredLanguageError()
    try:
        normalized = normalize_language_name(value)
    except (TypeError, ValueError) as error:
        raise InvalidPreferredLanguageError() from error
    if len(normalized) > 100:
        raise InvalidPreferredLanguageError()
    return normalized


def _prepared_updates(updates: ProfileUpdateRequest) -> dict[str, object]:
    supplied_fields = updates.model_fields_set
    if not supplied_fields:
        raise EmptyProfileUpdateError()

    prepared: dict[str, object] = {}
    if "displayName" in supplied_fields:
        prepared["display_name"] = _validated_display_name(updates.displayName)
    if "preferredLanguage" in supplied_fields:
        prepared["preferred_language"] = _validated_preferred_language(
            updates.preferredLanguage
        )
    if "leaderboardOptIn" in supplied_fields:
        if not isinstance(updates.leaderboardOptIn, bool):
            raise InvalidLeaderboardPreferenceError()
        prepared["leaderboard_opt_in"] = updates.leaderboardOptIn
    return prepared


def _new_profile(
    authenticated_user: AuthenticatedUser,
    *,
    now: datetime,
) -> Profile:
    email = _normalize_verified_email(authenticated_user.email)
    return Profile(
        id=authenticated_user.id,
        email=email,
        auth_provider=_normalize_verified_provider(authenticated_user.provider),
        display_name=_default_display_name(email),
        preferred_language="Pashto",
        leaderboard_opt_in=False,
        created_at=now,
        updated_at=now,
        last_login_at=now,
    )


def _synchronize_verified_identity(
    profile: Profile,
    authenticated_user: AuthenticatedUser,
    *,
    now: datetime,
) -> None:
    profile.email = _normalize_verified_email(authenticated_user.email)
    profile.auth_provider = _normalize_verified_provider(authenticated_user.provider)
    profile.last_login_at = now


def _apply_updates(
    profile: Profile,
    prepared: dict[str, object],
    *,
    now: datetime,
) -> None:
    changed = False
    for field_name, value in prepared.items():
        if getattr(profile, field_name) != value:
            setattr(profile, field_name, value)
            changed = True
    if changed:
        profile.updated_at = now


def _commit_and_refresh(database: Session, profile: Profile) -> Profile:
    try:
        database.commit()
        database.refresh(profile)
    except SQLAlchemyError as error:
        database.rollback()
        raise ProfilePersistenceError() from error
    return profile


def get_or_create_profile(
    *,
    database: Session,
    authenticated_user: AuthenticatedUser,
) -> Profile:
    """Create or synchronize the profile owned by the verified caller."""

    now = _utc_now()
    try:
        profile = database.get(Profile, authenticated_user.id)
    except SQLAlchemyError as error:
        database.rollback()
        raise ProfilePersistenceError() from error

    if profile is not None:
        _synchronize_verified_identity(profile, authenticated_user, now=now)
        return _commit_and_refresh(database, profile)

    profile = _new_profile(authenticated_user, now=now)
    database.add(profile)
    try:
        database.commit()
        database.refresh(profile)
        return profile
    except IntegrityError as race_error:
        database.rollback()
        try:
            existing = database.get(Profile, authenticated_user.id)
        except SQLAlchemyError as error:
            raise ProfilePersistenceError() from error
        if existing is None:
            raise ProfilePersistenceError() from race_error
        _synchronize_verified_identity(existing, authenticated_user, now=now)
        return _commit_and_refresh(database, existing)
    except SQLAlchemyError as error:
        database.rollback()
        raise ProfilePersistenceError() from error


def update_profile(
    *,
    database: Session,
    authenticated_user: AuthenticatedUser,
    updates: ProfileUpdateRequest,
) -> Profile:
    """Create if needed, synchronize identity, and apply owner preferences."""

    prepared = _prepared_updates(updates)
    now = _utc_now()
    try:
        profile = database.get(Profile, authenticated_user.id)
    except SQLAlchemyError as error:
        database.rollback()
        raise ProfilePersistenceError() from error

    created = profile is None
    if created:
        profile = _new_profile(authenticated_user, now=now)
        database.add(profile)
    else:
        _synchronize_verified_identity(profile, authenticated_user, now=now)
    _apply_updates(profile, prepared, now=now)

    try:
        database.commit()
        database.refresh(profile)
        return profile
    except IntegrityError as race_error:
        database.rollback()
        if not created:
            raise ProfilePersistenceError() from race_error
        try:
            existing = database.get(Profile, authenticated_user.id)
        except SQLAlchemyError as error:
            raise ProfilePersistenceError() from error
        if existing is None:
            raise ProfilePersistenceError() from race_error
        _synchronize_verified_identity(existing, authenticated_user, now=now)
        _apply_updates(existing, prepared, now=now)
        return _commit_and_refresh(database, existing)
    except SQLAlchemyError as error:
        database.rollback()
        raise ProfilePersistenceError() from error
