"""Privacy-safe schemas for personal statistics and the public leaderboard."""

from pydantic import BaseModel, ConfigDict, Field


class ProfileContributionStatisticsResponse(BaseModel):
    """Dynamic review counts belonging only to the authenticated profile."""

    model_config = ConfigDict(
        extra="forbid",
        from_attributes=True,
        populate_by_name=True,
        serialize_by_alias=True,
    )

    total_contributions: int = Field(alias="totalContributions", ge=0)
    pending_contributions: int = Field(alias="pendingContributions", ge=0)
    approved_contributions: int = Field(alias="approvedContributions", ge=0)
    rejected_contributions: int = Field(alias="rejectedContributions", ge=0)
    leaderboard_opt_in: bool = Field(alias="leaderboardOptIn")
    leaderboard_eligible: bool = Field(alias="leaderboardEligible")
    public_rank: int | None = Field(alias="publicRank", default=None, ge=1)


class PublicLeaderboardItem(BaseModel):
    """The complete and deliberately small public representation of one entry."""

    model_config = ConfigDict(
        extra="forbid",
        from_attributes=True,
        populate_by_name=True,
        serialize_by_alias=True,
    )

    rank: int = Field(ge=1)
    display_name: str = Field(alias="displayName", min_length=2, max_length=80)
    approved_contributions: int = Field(alias="approvedContributions", ge=1)


class PublicLeaderboardResponse(BaseModel):
    """One public leaderboard page and its eligibility-scoped total."""

    model_config = ConfigDict(
        extra="forbid",
        from_attributes=True,
        populate_by_name=True,
        serialize_by_alias=True,
    )

    items: list[PublicLeaderboardItem]
    total: int = Field(ge=0)
    limit: int = Field(ge=1, le=100)
    offset: int = Field(ge=0)
