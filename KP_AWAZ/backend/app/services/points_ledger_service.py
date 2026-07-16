"""Append-only contribution point effects, backfill, and private queries."""

from dataclasses import dataclass
from datetime import datetime
from uuid import uuid4

from sqlalchemy import Connection, func, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models import Contribution, PointLedgerEntry, Profile


POINT_EFFECTS = {
    "approval_award": 1,
    "approval_reversal": -1,
    "approved_backfill": 1,
}
API_ENTRY_TYPES = {
    "approval_award": "approvalAward",
    "approval_reversal": "approvalReversal",
    "approved_backfill": "approvedBackfill",
}
REVIEW_STATUSES = frozenset({"pending", "approved", "rejected"})


class PointsLedgerError(Exception):
    """Base exception carrying only safe points API metadata."""

    code = "POINTS_LEDGER_PERSISTENCE_FAILED"
    message = "Contribution points could not be saved."
    http_status = 500

    def __init__(self) -> None:
        super().__init__(self.message)


class PointsLedgerPersistenceError(PointsLedgerError):
    """Safe append or backfill persistence failure."""


class InvalidPointTransitionError(PointsLedgerError):
    """Safe error for an internally inconsistent review point effect."""

    code = "INVALID_POINT_TRANSITION"
    message = "The contribution point transition is invalid."


class DuplicatePointEntryError(PointsLedgerError):
    """Safe error for a conflicting event at an existing review revision."""

    code = "DUPLICATE_POINT_ENTRY"
    message = "The contribution point event already exists."


class PointsQueryError(PointsLedgerError):
    """Safe private balance and history query failure."""

    code = "POINTS_QUERY_FAILED"
    message = "Contribution points could not be loaded."


@dataclass(frozen=True, slots=True)
class PersonalPointItem:
    """One strictly reduced entry belonging to the verified profile."""

    id: str
    entry_type: str
    points_delta: int
    contribution_id: str
    created_at: datetime


@dataclass(frozen=True, slots=True)
class PersonalPointsPage:
    """One private ledger page plus its dynamic balance and total."""

    balance: int
    items: list[PersonalPointItem]
    total: int
    limit: int
    offset: int


def _transition_effect(previous_status: str, new_status: str) -> str | None:
    if previous_status != "approved" and new_status == "approved":
        return "approval_award"
    if previous_status == "approved" and new_status != "approved":
        return "approval_reversal"
    return None


def create_review_point_entry(
    *,
    database: Session,
    contribution: Contribution,
    previous_status: str,
) -> PointLedgerEntry | None:
    """Stage one review point effect without committing its transaction."""

    if (
        previous_status not in REVIEW_STATUSES
        or contribution.review_status not in REVIEW_STATUSES
    ):
        raise InvalidPointTransitionError()
    entry_type = _transition_effect(previous_status, contribution.review_status)
    if entry_type is None:
        return None
    if contribution.user_id is None or contribution.profile is None:
        return None
    if contribution.review_revision < 1:
        raise InvalidPointTransitionError()

    try:
        existing = database.scalar(
            select(PointLedgerEntry).where(
                PointLedgerEntry.contribution_id == contribution.id,
                PointLedgerEntry.review_revision == contribution.review_revision,
            )
        )
    except SQLAlchemyError as error:
        raise PointsLedgerPersistenceError() from error
    if existing is not None:
        if (
            existing.user_id == contribution.user_id
            and existing.entry_type == entry_type
            and existing.points_delta == POINT_EFFECTS[entry_type]
        ):
            return existing
        raise DuplicatePointEntryError()

    entry = PointLedgerEntry(
        user_id=contribution.user_id,
        contribution_id=contribution.id,
        review_revision=contribution.review_revision,
        entry_type=entry_type,
        points_delta=POINT_EFFECTS[entry_type],
        description=(
            "Point awarded for contribution approval."
            if entry_type == "approval_award"
            else "Point reversed after contribution approval was removed."
        ),
    )
    database.add(entry)
    return entry


def backfill_approved_contribution_points_connection(
    connection: Connection,
) -> int:
    """Insert missing current-state awards inside a compatibility transaction."""

    existing_event = (
        select(PointLedgerEntry.id)
        .where(
            PointLedgerEntry.contribution_id == Contribution.id,
            PointLedgerEntry.review_revision == Contribution.review_revision,
        )
        .exists()
    )
    candidates = connection.execute(
        select(
            Contribution.id,
            Contribution.user_id,
            Contribution.review_revision,
        )
        .join(Profile, Profile.id == Contribution.user_id)
        .where(
            Contribution.review_status == "approved",
            Contribution.user_id.is_not(None),
            ~existing_event,
        )
        .order_by(Contribution.id.asc())
    ).all()

    created = 0
    for contribution_id, user_id, review_revision in candidates:
        statement = (
            sqlite_insert(PointLedgerEntry)
            .values(
                id=str(uuid4()),
                user_id=user_id,
                contribution_id=contribution_id,
                review_revision=review_revision,
                entry_type="approved_backfill",
                points_delta=1,
                description="Initial point for an existing approved contribution.",
            )
            .on_conflict_do_nothing(
                index_elements=["contribution_id", "review_revision"]
            )
        )
        result = connection.execute(statement)
        created += max(int(result.rowcount or 0), 0)
    return created


def backfill_approved_contribution_points(database: Session) -> int:
    """Run the approved-owned contribution backfill safely and idempotently."""

    try:
        created = backfill_approved_contribution_points_connection(
            database.connection()
        )
        database.commit()
        return created
    except SQLAlchemyError as error:
        database.rollback()
        raise PointsLedgerPersistenceError() from error


def get_personal_points(
    *,
    database: Session,
    owner_user_id: str,
    limit: int,
    offset: int,
) -> PersonalPointsPage:
    """Aggregate and page only the verified profile's ledger rows in SQL."""

    owner_filter = PointLedgerEntry.user_id == owner_user_id
    try:
        balance = int(
            database.scalar(
                select(func.coalesce(func.sum(PointLedgerEntry.points_delta), 0))
                .select_from(PointLedgerEntry)
                .where(owner_filter)
            )
            or 0
        )
        total = int(
            database.scalar(
                select(func.count())
                .select_from(PointLedgerEntry)
                .where(owner_filter)
            )
            or 0
        )
        entries = list(
            database.scalars(
                select(PointLedgerEntry)
                .where(owner_filter)
                .order_by(
                    PointLedgerEntry.created_at.desc(),
                    PointLedgerEntry.id.desc(),
                )
                .limit(limit)
                .offset(offset)
            ).all()
        )
    except SQLAlchemyError as error:
        database.rollback()
        raise PointsQueryError() from error

    return PersonalPointsPage(
        balance=balance,
        items=[
            PersonalPointItem(
                id=entry.id,
                entry_type=API_ENTRY_TYPES[entry.entry_type],
                points_delta=entry.points_delta,
                contribution_id=entry.contribution_id,
                created_at=entry.created_at,
            )
            for entry in entries
        ],
        total=total,
        limit=limit,
        offset=offset,
    )
