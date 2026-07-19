"""Private contributor and protected administrator withdrawal schemas."""

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


WithdrawalScope = Literal["contribution", "all"]
WithdrawalStatus = Literal["requested", "approved", "declined"]


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


class WithdrawalRequestCreate(BaseModel):
    """Allowed owner-supplied fields for a non-destructive request."""

    model_config = ConfigDict(extra="forbid")

    scope: WithdrawalScope
    contributionId: str | None = None
    reason: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def validate_scope_target(self) -> "WithdrawalRequestCreate":
        contribution_id = (
            self.contributionId.strip()
            if isinstance(self.contributionId, str)
            else None
        )
        if self.scope == "contribution" and not contribution_id:
            raise ValueError("A contribution target is required for this scope.")
        if self.scope == "all" and contribution_id is not None:
            raise ValueError("An all-contributions request cannot include a target.")
        self.contributionId = contribution_id
        if isinstance(self.reason, str):
            self.reason = self.reason.strip() or None
        return self


class OwnerWithdrawalRequestResponse(BaseModel):
    """Withdrawal status safe to return only to the verified owner."""

    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True,
        serialize_by_alias=True,
    )

    scope: WithdrawalScope
    status: WithdrawalStatus
    contribution_id: str | None = Field(alias="contributionId")
    reason: str | None
    requested_at: datetime = Field(alias="requestedAt")
    resolved_at: datetime | None = Field(alias="resolvedAt")

    @field_validator("requested_at", "resolved_at")
    @classmethod
    def normalize_timestamps(cls, value: datetime | None) -> datetime | None:
        return _as_utc(value) if value is not None else None


class OwnerWithdrawalRequestListResponse(BaseModel):
    items: list[OwnerWithdrawalRequestResponse]
    total: int
    limit: int
    offset: int


class AdminWithdrawalResolutionRequest(BaseModel):
    """Protected administrator decision with optional internal reasoning."""

    model_config = ConfigDict(extra="forbid")

    status: Literal["approved", "declined"]
    resolutionReason: str | None = Field(default=None, max_length=500)

    @field_validator("resolutionReason", mode="before")
    @classmethod
    def normalize_reason(cls, value: object) -> object:
        return value.strip() or None if isinstance(value, str) else value


class AdminWithdrawalRequestResponse(BaseModel):
    """Safe metadata visible only inside the protected admin workspace."""

    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    id: str
    scope: WithdrawalScope
    status: WithdrawalStatus
    owner_display_name: str = Field(alias="ownerDisplayName")
    contribution_summary: str | None = Field(alias="contributionSummary")
    affected_contribution_count: int = Field(alias="affectedContributionCount")
    reason: str | None
    requested_at: datetime = Field(alias="requestedAt")
    resolved_at: datetime | None = Field(alias="resolvedAt")
    resolution_reason: str | None = Field(alias="resolutionReason")

    @field_validator("requested_at", "resolved_at")
    @classmethod
    def normalize_admin_timestamps(
        cls,
        value: datetime | None,
    ) -> datetime | None:
        return _as_utc(value) if value is not None else None


class AdminWithdrawalRequestListResponse(BaseModel):
    items: list[AdminWithdrawalRequestResponse]
    total: int
    limit: int
    offset: int
    status: str
