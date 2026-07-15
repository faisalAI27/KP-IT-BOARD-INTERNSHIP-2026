"""Request and response schemas for the authenticated user's profile."""

from datetime import datetime, timezone
from typing import Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    field_validator,
    model_validator,
)

from app.utils.text_normalization import normalize_language_name


class ProfileResponse(BaseModel):
    """Only the local profile fields safe to return to its owner."""

    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True,
        serialize_by_alias=True,
    )

    id: str
    email: str | None
    auth_provider: str | None = Field(alias="authProvider")
    display_name: str = Field(alias="displayName")
    preferred_language: str = Field(alias="preferredLanguage")
    leaderboard_opt_in: bool = Field(alias="leaderboardOptIn")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")
    last_login_at: datetime = Field(alias="lastLoginAt")

    @field_validator("created_at", "updated_at", "last_login_at")
    @classmethod
    def normalize_timestamp_to_utc(cls, value: datetime) -> datetime:
        """Treat SQLite's naïve values as UTC and normalize aware values."""

        if value.tzinfo is None or value.utcoffset() is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)


class ProfileUpdateRequest(BaseModel):
    """Owner-editable profile preferences; verified identity is excluded."""

    model_config = ConfigDict(
        extra="forbid",
    )

    displayName: str | None = None
    preferredLanguage: str | None = None
    leaderboardOptIn: StrictBool | None = None

    @field_validator("displayName", mode="before")
    @classmethod
    def validate_display_name(cls, value: object) -> object:
        """Trim only surrounding whitespace and enforce the public limits."""

        if value is None:
            return value
        if not isinstance(value, str):
            raise ValueError("Display name must be a string.")
        cleaned = value.strip()
        if not 2 <= len(cleaned) <= 80:
            raise ValueError(
                "Display name must contain between 2 and 80 characters."
            )
        return cleaned

    @field_validator("preferredLanguage", mode="before")
    @classmethod
    def validate_preferred_language(cls, value: object) -> object:
        """Reuse the application's language normalization behavior."""

        if value is None:
            return value
        if not isinstance(value, str):
            raise ValueError("Preferred language must be a string.")
        try:
            normalized = normalize_language_name(value)
        except (TypeError, ValueError) as error:
            raise ValueError("Preferred language must not be blank.") from error
        if len(normalized) > 100:
            raise ValueError("Preferred language must be at most 100 characters.")
        return normalized

    @model_validator(mode="after")
    def require_supplied_non_null_update(self) -> Self:
        """Reject empty bodies and explicit nulls for required stored values."""

        if not self.model_fields_set:
            raise ValueError("At least one profile field must be supplied.")
        if any(
            getattr(self, field_name) is None
            for field_name in self.model_fields_set
        ):
            raise ValueError("Profile fields cannot be null.")
        return self
