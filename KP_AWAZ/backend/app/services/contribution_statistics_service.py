"""Database-aggregated personal statistics and public leaderboard queries."""

from dataclasses import dataclass

from sqlalchemy import case, func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models import Contribution, Profile


class ContributionStatisticsError(Exception):
    """Base class carrying only safe statistics API error metadata."""

    code = "CONTRIBUTION_STATISTICS_FAILED"
    message = "Contribution statistics could not be loaded."
    http_status = 500

    def __init__(self) -> None:
        super().__init__(self.message)


class ContributionStatisticsQueryError(ContributionStatisticsError):
    """Safe authenticated-statistics database query failure."""


class LeaderboardQueryError(ContributionStatisticsError):
    """Safe public leaderboard database query failure."""

    code = "LEADERBOARD_QUERY_FAILED"
    message = "The public leaderboard could not be loaded."


class PersonalLeaderboardContextQueryError(ContributionStatisticsError):
    """Safe authenticated containing-page query failure."""

    code = "LEADERBOARD_CONTEXT_QUERY_FAILED"
    message = "Your leaderboard position could not be loaded."


@dataclass(frozen=True, slots=True)
class ProfileContributionStatistics:
    """One profile's dynamic contribution counts and public eligibility."""

    total_contributions: int
    pending_contributions: int
    approved_contributions: int
    rejected_contributions: int
    leaderboard_opt_in: bool
    leaderboard_eligible: bool
    public_rank: int | None


@dataclass(frozen=True, slots=True)
class LeaderboardEntry:
    """One privacy-safe ranked row returned by the database."""

    rank: int
    display_name: str
    approved_contributions: int


@dataclass(frozen=True, slots=True)
class LeaderboardPage:
    """One bounded leaderboard page and its eligible-profile total."""

    items: list[LeaderboardEntry]
    total: int
    limit: int
    offset: int


@dataclass(frozen=True, slots=True)
class PersonalLeaderboardEntry:
    """One ranked row with an explicit current-user marker."""

    rank: int
    display_name: str
    approved_contributions: int
    is_current_user: bool


@dataclass(frozen=True, slots=True)
class PersonalLeaderboardCurrentUser:
    """Privacy-safe authenticated summary of the verified caller."""

    rank: int | None
    display_name: str
    approved_contributions: int


@dataclass(frozen=True, slots=True)
class PersonalLeaderboardContext:
    """The verified caller's eligibility and containing leaderboard page."""

    leaderboard_opt_in: bool
    leaderboard_eligible: bool
    current_user: PersonalLeaderboardCurrentUser
    items: list[PersonalLeaderboardEntry]
    total: int
    limit: int
    offset: int


def _eligible_profile_counts():
    """Return the shared approved, owned and opted-in aggregation subquery."""

    approved_count = func.count(Contribution.id).label("approved_count")
    return (
        select(
            Profile.id.label("profile_id"),
            Profile.display_name.label("display_name"),
            approved_count,
        )
        .join(Contribution, Contribution.user_id == Profile.id)
        .where(
            Profile.leaderboard_opt_in.is_(True),
            Contribution.user_id.is_not(None),
            Contribution.review_status == "approved",
        )
        .group_by(Profile.id, Profile.display_name)
        .having(func.count(Contribution.id) > 0)
        .subquery("eligible_profile_counts")
    )


def _ranked_eligible_profiles():
    """Apply dense ranking without allowing display ordering to alter ties."""

    eligible = _eligible_profile_counts()
    return (
        select(
            eligible.c.profile_id,
            eligible.c.display_name,
            eligible.c.approved_count,
            func.dense_rank()
            .over(order_by=eligible.c.approved_count.desc())
            .label("public_rank"),
            func.row_number()
            .over(
                order_by=(
                    eligible.c.approved_count.desc(),
                    func.lower(func.trim(eligible.c.display_name)).asc(),
                    eligible.c.profile_id.asc(),
                )
            )
            .label("row_position"),
            func.count().over().label("eligible_total"),
        )
        .subquery("ranked_eligible_profiles")
    )


def get_profile_contribution_statistics(
    *,
    database: Session,
    profile: Profile,
) -> ProfileContributionStatistics:
    """Calculate one existing profile's private counts entirely in SQL."""

    counts_query = select(
        func.count(Contribution.id).label("total_count"),
        func.sum(
            case((Contribution.review_status == "pending", 1), else_=0)
        ).label("pending_count"),
        func.sum(
            case((Contribution.review_status == "approved", 1), else_=0)
        ).label("approved_count"),
        func.sum(
            case((Contribution.review_status == "rejected", 1), else_=0)
        ).label("rejected_count"),
    ).where(Contribution.user_id == profile.id)

    try:
        counts = database.execute(counts_query).one()
        total = int(counts.total_count or 0)
        pending = int(counts.pending_count or 0)
        approved = int(counts.approved_count or 0)
        rejected = int(counts.rejected_count or 0)
        opted_in = bool(profile.leaderboard_opt_in)
        eligible = opted_in and approved > 0
        public_rank: int | None = None
        if eligible:
            ranked = _ranked_eligible_profiles()
            rank_value = database.scalar(
                select(ranked.c.public_rank).where(
                    ranked.c.profile_id == profile.id
                )
            )
            public_rank = int(rank_value) if rank_value is not None else None
            eligible = public_rank is not None
    except SQLAlchemyError as error:
        database.rollback()
        raise ContributionStatisticsQueryError() from error

    return ProfileContributionStatistics(
        total_contributions=total,
        pending_contributions=pending,
        approved_contributions=approved,
        rejected_contributions=rejected,
        leaderboard_opt_in=opted_in,
        leaderboard_eligible=eligible,
        public_rank=public_rank,
    )


def list_public_leaderboard(
    *,
    database: Session,
    limit: int,
    offset: int,
) -> LeaderboardPage:
    """Return a database-filtered and paginated privacy-safe leaderboard."""

    eligible = _eligible_profile_counts()
    ranked = _ranked_eligible_profiles()
    total_query = select(func.count()).select_from(eligible)
    items_query = (
        select(
            ranked.c.public_rank,
            ranked.c.display_name,
            ranked.c.approved_count,
        )
        .order_by(
            ranked.c.approved_count.desc(),
            func.lower(func.trim(ranked.c.display_name)).asc(),
            ranked.c.profile_id.asc(),
        )
        .limit(limit)
        .offset(offset)
    )

    try:
        total = int(database.scalar(total_query) or 0)
        rows = database.execute(items_query).all()
    except SQLAlchemyError as error:
        database.rollback()
        raise LeaderboardQueryError() from error

    return LeaderboardPage(
        items=[
            LeaderboardEntry(
                rank=int(row.public_rank),
                display_name=str(row.display_name),
                approved_contributions=int(row.approved_count),
            )
            for row in rows
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


def get_personal_leaderboard_context(
    *,
    database: Session,
    profile: Profile,
    limit: int,
) -> PersonalLeaderboardContext:
    """Return the bounded ranked page containing the verified caller."""

    approved_query = select(func.count(Contribution.id)).where(
        Contribution.user_id == profile.id,
        Contribution.review_status == "approved",
    )

    try:
        approved = int(database.scalar(approved_query) or 0)
        opted_in = bool(profile.leaderboard_opt_in)
        if not opted_in or approved == 0:
            return PersonalLeaderboardContext(
                leaderboard_opt_in=opted_in,
                leaderboard_eligible=False,
                current_user=PersonalLeaderboardCurrentUser(
                    rank=None,
                    display_name=str(profile.display_name),
                    approved_contributions=approved,
                ),
                items=[],
                total=0,
                limit=limit,
                offset=0,
            )

        ranked = _ranked_eligible_profiles()
        current_row = database.execute(
            select(
                ranked.c.public_rank,
                ranked.c.display_name,
                ranked.c.approved_count,
                ranked.c.row_position,
                ranked.c.eligible_total,
            ).where(ranked.c.profile_id == profile.id)
        ).one_or_none()
        if current_row is None:
            return PersonalLeaderboardContext(
                leaderboard_opt_in=opted_in,
                leaderboard_eligible=False,
                current_user=PersonalLeaderboardCurrentUser(
                    rank=None,
                    display_name=str(profile.display_name),
                    approved_contributions=approved,
                ),
                items=[],
                total=0,
                limit=limit,
                offset=0,
            )

        offset = ((int(current_row.row_position) - 1) // limit) * limit
        rows = database.execute(
            select(
                ranked.c.profile_id,
                ranked.c.public_rank,
                ranked.c.display_name,
                ranked.c.approved_count,
            )
            .order_by(ranked.c.row_position.asc())
            .limit(limit)
            .offset(offset)
        ).all()
    except SQLAlchemyError as error:
        database.rollback()
        raise PersonalLeaderboardContextQueryError() from error

    entries = [
        PersonalLeaderboardEntry(
            rank=int(row.public_rank),
            display_name=str(row.display_name),
            approved_contributions=int(row.approved_count),
            is_current_user=str(row.profile_id) == profile.id,
        )
        for row in rows
    ]
    if sum(entry.is_current_user for entry in entries) != 1:
        raise PersonalLeaderboardContextQueryError()

    return PersonalLeaderboardContext(
        leaderboard_opt_in=opted_in,
        leaderboard_eligible=True,
        current_user=PersonalLeaderboardCurrentUser(
            rank=int(current_row.public_rank),
            display_name=str(current_row.display_name),
            approved_contributions=int(current_row.approved_count),
        ),
        items=entries,
        total=int(current_row.eligible_total),
        limit=limit,
        offset=offset,
    )
