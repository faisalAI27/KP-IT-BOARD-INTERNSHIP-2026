"""Public response schema reserved for future contribution endpoints."""

from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict, Field, field_validator


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

        if value.tzinfo is None or value.utcoffset() is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)


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
    created_at: datetime = Field(alias="createdAt")

    @field_validator("created_at")
    @classmethod
    def normalize_created_at_to_utc(cls, value: datetime) -> datetime:
        """Serialize naïve SQLite values consistently as UTC."""

        if value.tzinfo is None or value.utcoffset() is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)


class MyContributionListResponse(BaseModel):
    """Paginated contribution history for the verified caller."""

    items: list[MyContributionResponse]
    total: int
    limit: int
    offset: int
