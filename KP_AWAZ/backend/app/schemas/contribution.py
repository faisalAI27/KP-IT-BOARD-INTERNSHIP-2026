"""Public response schema reserved for future contribution endpoints."""

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


class ContributionCreatedResponse(BaseModel):
    """Safe metadata returned after a future contribution submission."""

    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True,
        serialize_by_alias=True,
    )

    id: str
    status: str
    created_at: datetime = Field(alias="createdAt")

    @field_validator("created_at")
    @classmethod
    def normalize_created_at_to_utc(cls, value: datetime) -> datetime:
        """Keep SQLite and timezone-aware database responses consistent."""

        return _as_utc(value)


class MyContributionResponse(BaseModel):
    """Safe contribution history item belonging to the verified caller."""

    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True,
        serialize_by_alias=True,
    )

    id: str
    contribution_type: str = Field(alias="contributionType")
    sentence_id: str | None = Field(alias="sentenceId")
    sentence_text: str | None = Field(alias="sentenceText")
    topic: str | None
    language: str
    original_filename: str = Field(alias="originalFilename")
    mime_type: str = Field(alias="mimeType")
    duration_seconds: float | None = Field(alias="durationSeconds")
    status: str
    review_status: Literal["pending", "approved", "rejected"] = Field(
        alias="reviewStatus"
    )
    rejection_reason: str | None = Field(alias="rejectionReason")
    withdrawal_status: Literal[
        "none", "requested", "approved", "declined"
    ] = Field(default="none", alias="withdrawalStatus")
    created_at: datetime = Field(alias="createdAt")

    @model_validator(mode="after")
    def hide_non_rejection_reason(self) -> "MyContributionResponse":
        """Expose review feedback only to the owner and only for a rejection."""

        if self.review_status != "rejected":
            self.rejection_reason = None
        return self

    @field_validator("created_at")
    @classmethod
    def normalize_created_at_to_utc(cls, value: datetime) -> datetime:
        """Serialize naïve SQLite values consistently as UTC."""

        return _as_utc(value)


class MyContributionListResponse(BaseModel):
    """Paginated contribution history for the verified caller."""

    items: list[MyContributionResponse]
    total: int
    limit: int
    offset: int


class ContributionReviewRequest(BaseModel):
    """One protected approval or rejection decision."""

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )

    status: str = Field(min_length=1, max_length=20)
    rejectionReason: str | None = Field(default=None, max_length=500)

    @field_validator("status", mode="before")
    @classmethod
    def normalize_status(cls, value: object) -> object:
        return value.strip().lower() if isinstance(value, str) else value

    @field_validator("rejectionReason", mode="before")
    @classmethod
    def normalize_rejection_reason(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class AdminContributionResponse(BaseModel):
    """Safe contribution metadata for the protected admin review workflow."""

    model_config = ConfigDict(
        populate_by_name=True,
        serialize_by_alias=True,
    )

    id: str
    contribution_type: str = Field(alias="contributionType")
    language: str
    sentence_text: str | None = Field(alias="sentenceText")
    topic: str | None
    original_filename: str = Field(alias="originalFilename")
    mime_type: str = Field(alias="mimeType")
    duration_seconds: float | None = Field(alias="durationSeconds")
    created_at: datetime = Field(alias="createdAt")
    review_status: str = Field(alias="reviewStatus")
    reviewed_at: datetime | None = Field(alias="reviewedAt")
    rejection_reason: str | None = Field(alias="rejectionReason")
    has_owner: bool = Field(alias="hasOwner")
    owner_display_name: str | None = Field(alias="ownerDisplayName")

    @field_validator("created_at", "reviewed_at")
    @classmethod
    def normalize_timestamps_to_utc(
        cls, value: datetime | None
    ) -> datetime | None:
        return _as_utc(value) if value is not None else None

    @classmethod
    def from_contribution(cls, contribution: object) -> "AdminContributionResponse":
        """Reduce one ORM contribution to explicitly approved response fields."""

        profile = getattr(contribution, "profile", None)
        return cls.model_validate(
            {
                "id": getattr(contribution, "id"),
                "contributionType": getattr(contribution, "contribution_type"),
                "language": getattr(contribution, "language"),
                "sentenceText": getattr(contribution, "sentence_text"),
                "topic": getattr(contribution, "topic"),
                "originalFilename": getattr(contribution, "original_filename"),
                "mimeType": getattr(contribution, "mime_type"),
                "durationSeconds": getattr(contribution, "duration_seconds"),
                "createdAt": getattr(contribution, "created_at"),
                "reviewStatus": getattr(contribution, "review_status"),
                "reviewedAt": getattr(contribution, "reviewed_at"),
                "rejectionReason": getattr(contribution, "rejection_reason"),
                "hasOwner": getattr(contribution, "user_id") is not None,
                "ownerDisplayName": getattr(profile, "display_name", None),
            }
        )


class AdminContributionListResponse(BaseModel):
    """Paginated protected admin review queue."""

    items: list[AdminContributionResponse]
    total: int
    limit: int
    offset: int
    status: str
