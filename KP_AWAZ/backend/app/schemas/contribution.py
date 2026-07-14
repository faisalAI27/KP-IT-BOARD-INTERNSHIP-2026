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
