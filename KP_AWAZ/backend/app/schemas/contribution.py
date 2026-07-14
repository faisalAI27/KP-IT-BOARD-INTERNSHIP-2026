"""Public response schema reserved for future contribution endpoints."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


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
