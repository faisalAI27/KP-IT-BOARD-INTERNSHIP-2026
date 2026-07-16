"""Strict private response schemas for the append-only points ledger."""

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


class PointLedgerItemResponse(BaseModel):
    """One point event safe to return only to its authenticated owner."""

    model_config = ConfigDict(
        extra="forbid",
        from_attributes=True,
        populate_by_name=True,
        serialize_by_alias=True,
    )

    id: str
    entry_type: Literal[
        "approvalAward",
        "approvalReversal",
        "approvedBackfill",
    ] = Field(alias="entryType")
    points_delta: int = Field(alias="pointsDelta")
    contribution_id: str = Field(alias="contributionId")
    created_at: datetime = Field(alias="createdAt")

    @field_validator("created_at")
    @classmethod
    def normalize_created_at_to_utc(cls, value: datetime) -> datetime:
        return _as_utc(value)


class PersonalPointsResponse(BaseModel):
    """Dynamic point balance and one owner-filtered ledger page."""

    model_config = ConfigDict(
        extra="forbid",
        from_attributes=True,
        populate_by_name=True,
        serialize_by_alias=True,
    )

    balance: int
    items: list[PointLedgerItemResponse]
    total: int = Field(ge=0)
    limit: int = Field(ge=1, le=100)
    offset: int = Field(ge=0)
