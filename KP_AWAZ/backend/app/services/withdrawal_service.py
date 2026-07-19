"""Ownership-safe withdrawal requests and protected resolution operations."""

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, joinedload

from app.models import Contribution, WithdrawalRequest


WITHDRAWAL_SCOPES = frozenset({"contribution", "all"})
WITHDRAWAL_STATUSES = frozenset({"requested", "approved", "declined"})
WITHDRAWAL_RESOLUTIONS = frozenset({"approved", "declined"})
EXPORT_EXCLUSION_STATUSES = frozenset({"requested", "approved"})
MAX_WITHDRAWAL_REASON_LENGTH = 500


class WithdrawalServiceError(Exception):
    code = "WITHDRAWAL_REQUEST_FAILED"
    default_message = "The withdrawal request could not be completed."
    http_status = 400

    def __init__(self) -> None:
        self.message = self.default_message
        super().__init__(self.message)


class OwnedContributionNotFoundError(WithdrawalServiceError):
    code = "OWNED_CONTRIBUTION_NOT_FOUND"
    default_message = "The selected owned contribution was not found."
    http_status = 404


class NoOwnedContributionsError(WithdrawalServiceError):
    code = "NO_OWNED_CONTRIBUTIONS"
    default_message = "There are no owned contributions to withdraw."


class DuplicateWithdrawalRequestError(WithdrawalServiceError):
    code = "WITHDRAWAL_REQUEST_ALREADY_ACTIVE"
    default_message = "A withdrawal request is already active for this selection."
    http_status = 409


class WithdrawalRequestNotFoundError(WithdrawalServiceError):
    code = "WITHDRAWAL_REQUEST_NOT_FOUND"
    default_message = "The withdrawal request was not found."
    http_status = 404


class WithdrawalRequestAlreadyResolvedError(WithdrawalServiceError):
    code = "WITHDRAWAL_REQUEST_ALREADY_RESOLVED"
    default_message = "The withdrawal request has already been resolved."
    http_status = 409


class InvalidWithdrawalReasonError(WithdrawalServiceError):
    code = "INVALID_WITHDRAWAL_REASON"
    default_message = "The withdrawal reason must not exceed 500 characters."


class ResolutionReasonRequiredError(WithdrawalServiceError):
    code = "WITHDRAWAL_RESOLUTION_REASON_REQUIRED"
    default_message = "A safe internal reason is required when declining a request."


class WithdrawalPersistenceError(WithdrawalServiceError):
    code = "WITHDRAWAL_PERSISTENCE_FAILED"
    default_message = "The withdrawal request could not be saved."
    http_status = 500


class WithdrawalQueryError(WithdrawalServiceError):
    code = "WITHDRAWAL_QUERY_FAILED"
    default_message = "Withdrawal requests could not be loaded."
    http_status = 500


@dataclass(frozen=True, slots=True)
class AdminWithdrawalRecord:
    request: WithdrawalRequest
    owner_display_name: str
    contribution_summary: str | None
    affected_contribution_count: int


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _safe_reason(reason: str | None) -> str | None:
    if reason is None:
        return None
    if not isinstance(reason, str):
        raise InvalidWithdrawalReasonError()
    normalized = reason.strip() or None
    if normalized is not None and len(normalized) > MAX_WITHDRAWAL_REASON_LENGTH:
        raise InvalidWithdrawalReasonError()
    return normalized


def _owned_contribution(
    *,
    database: Session,
    owner_user_id: str,
    contribution_id: str,
) -> Contribution:
    try:
        contribution = database.scalar(
            select(Contribution).where(
                Contribution.id == contribution_id,
                Contribution.user_id == owner_user_id,
            )
        )
    except SQLAlchemyError as error:
        database.rollback()
        raise WithdrawalQueryError() from error
    if contribution is None:
        raise OwnedContributionNotFoundError()
    return contribution


def _existing_contribution_exclusion(
    *,
    database: Session,
    owner_user_id: str,
    contribution: Contribution,
) -> WithdrawalRequest | None:
    try:
        return database.scalar(
            select(WithdrawalRequest)
            .where(
                WithdrawalRequest.user_id == owner_user_id,
                WithdrawalRequest.status.in_(EXPORT_EXCLUSION_STATUSES),
                or_(
                    and_(
                        WithdrawalRequest.scope == "contribution",
                        WithdrawalRequest.contribution_id == contribution.id,
                    ),
                    and_(
                        WithdrawalRequest.scope == "all",
                        WithdrawalRequest.requested_at >= contribution.created_at,
                    ),
                ),
            )
            .limit(1)
        )
    except SQLAlchemyError as error:
        database.rollback()
        raise WithdrawalQueryError() from error


def create_withdrawal_request(
    *,
    database: Session,
    owner_user_id: str,
    scope: str,
    contribution_id: str | None,
    reason: str | None,
) -> WithdrawalRequest:
    """Create a non-destructive request owned by the verified caller."""

    normalized_reason = _safe_reason(reason)
    now = _utc_now()
    if scope == "contribution":
        contribution = _owned_contribution(
            database=database,
            owner_user_id=owner_user_id,
            contribution_id=contribution_id or "",
        )
        if _existing_contribution_exclusion(
            database=database,
            owner_user_id=owner_user_id,
            contribution=contribution,
        ) is not None:
            raise DuplicateWithdrawalRequestError()
        target_id = contribution.id
    elif scope == "all":
        target_id = None
        try:
            owned_total = database.scalar(
                select(func.count())
                .select_from(Contribution)
                .where(Contribution.user_id == owner_user_id)
            )
            existing_request = database.scalar(
                select(WithdrawalRequest)
                .where(
                    WithdrawalRequest.user_id == owner_user_id,
                    WithdrawalRequest.scope == "all",
                    WithdrawalRequest.status == "requested",
                )
                .limit(1)
            )
        except SQLAlchemyError as error:
            database.rollback()
            raise WithdrawalQueryError() from error
        if not owned_total:
            raise NoOwnedContributionsError()
        if existing_request is not None:
            raise DuplicateWithdrawalRequestError()
    else:
        raise WithdrawalServiceError()

    request = WithdrawalRequest(
        user_id=owner_user_id,
        contribution_id=target_id,
        scope=scope,
        status="requested",
        reason=normalized_reason,
        requested_at=now,
        resolved_at=None,
        resolution_reason=None,
    )
    database.add(request)
    try:
        database.commit()
        database.refresh(request)
    except IntegrityError as error:
        database.rollback()
        raise DuplicateWithdrawalRequestError() from error
    except SQLAlchemyError as error:
        database.rollback()
        raise WithdrawalPersistenceError() from error
    return request


def list_owner_withdrawal_requests(
    *,
    database: Session,
    owner_user_id: str,
    limit: int,
    offset: int,
) -> tuple[list[WithdrawalRequest], int]:
    ownership_filter = WithdrawalRequest.user_id == owner_user_id
    try:
        total = database.scalar(
            select(func.count()).select_from(WithdrawalRequest).where(ownership_filter)
        )
        items = list(
            database.scalars(
                select(WithdrawalRequest)
                .where(ownership_filter)
                .order_by(
                    WithdrawalRequest.requested_at.desc(),
                    WithdrawalRequest.id.desc(),
                )
                .limit(limit)
                .offset(offset)
            ).all()
        )
    except SQLAlchemyError as error:
        database.rollback()
        raise WithdrawalQueryError() from error
    return items, int(total or 0)


def attach_withdrawal_statuses(
    *,
    database: Session,
    owner_user_id: str,
    contributions: list[Contribution],
) -> None:
    """Attach private effective status to an already owner-filtered history page."""

    if not contributions:
        return
    contribution_ids = [item.id for item in contributions]
    earliest_created_at = min(item.created_at for item in contributions)
    try:
        requests = list(
            database.scalars(
                select(WithdrawalRequest).where(
                    WithdrawalRequest.user_id == owner_user_id,
                    or_(
                        WithdrawalRequest.contribution_id.in_(contribution_ids),
                        and_(
                            WithdrawalRequest.scope == "all",
                            WithdrawalRequest.requested_at >= earliest_created_at,
                        ),
                    ),
                )
            ).all()
        )
    except SQLAlchemyError as error:
        database.rollback()
        raise WithdrawalQueryError() from error

    priority = {"none": 0, "declined": 1, "requested": 2, "approved": 3}
    for contribution in contributions:
        effective_status = "none"
        for request in requests:
            applies = (
                request.scope == "contribution"
                and request.contribution_id == contribution.id
            ) or (
                request.scope == "all"
                and request.requested_at >= contribution.created_at
            )
            if applies and priority[request.status] > priority[effective_status]:
                effective_status = request.status
        contribution.withdrawal_status = effective_status


def _summary_for_contribution(contribution: Contribution | None) -> str | None:
    if contribution is None:
        return None
    for value in (contribution.sentence_text, contribution.topic):
        if isinstance(value, str) and value.strip():
            return value.strip()[:160]
    return "Voice contribution"


def list_admin_withdrawal_requests(
    *,
    database: Session,
    status: str,
    limit: int,
    offset: int,
) -> tuple[list[AdminWithdrawalRecord], int, str]:
    normalized_status = status.strip().lower() if isinstance(status, str) else ""
    if normalized_status not in WITHDRAWAL_STATUSES | {"all"}:
        raise WithdrawalServiceError()
    status_filter = (
        None
        if normalized_status == "all"
        else WithdrawalRequest.status == normalized_status
    )
    count_query = select(func.count()).select_from(WithdrawalRequest)
    item_query = select(WithdrawalRequest).options(
        joinedload(WithdrawalRequest.profile),
        joinedload(WithdrawalRequest.contribution),
    )
    if status_filter is not None:
        count_query = count_query.where(status_filter)
        item_query = item_query.where(status_filter)
    item_query = (
        item_query.order_by(
            WithdrawalRequest.requested_at.desc(), WithdrawalRequest.id.desc()
        )
        .limit(limit)
        .offset(offset)
    )
    try:
        total = database.scalar(count_query)
        requests = list(database.scalars(item_query).unique().all())
        records: list[AdminWithdrawalRecord] = []
        for request in requests:
            affected_count = 1
            if request.scope == "all":
                affected_count = int(
                    database.scalar(
                        select(func.count())
                        .select_from(Contribution)
                        .where(
                            Contribution.user_id == request.user_id,
                            Contribution.created_at <= request.requested_at,
                        )
                    )
                    or 0
                )
            records.append(
                AdminWithdrawalRecord(
                    request=request,
                    owner_display_name=request.profile.display_name,
                    contribution_summary=_summary_for_contribution(
                        request.contribution
                    ),
                    affected_contribution_count=affected_count,
                )
            )
    except SQLAlchemyError as error:
        database.rollback()
        raise WithdrawalQueryError() from error
    return records, int(total or 0), normalized_status


def resolve_withdrawal_request(
    *,
    database: Session,
    request_id: str,
    status: str,
    resolution_reason: str | None,
) -> WithdrawalRequest:
    normalized_status = status.strip().lower() if isinstance(status, str) else ""
    if normalized_status not in WITHDRAWAL_RESOLUTIONS:
        raise WithdrawalServiceError()
    normalized_reason = _safe_reason(resolution_reason)
    if normalized_status == "declined" and normalized_reason is None:
        raise ResolutionReasonRequiredError()
    try:
        request = database.scalar(
            select(WithdrawalRequest)
            .options(
                joinedload(WithdrawalRequest.profile),
                joinedload(WithdrawalRequest.contribution),
            )
            .where(WithdrawalRequest.id == request_id)
        )
    except SQLAlchemyError as error:
        database.rollback()
        raise WithdrawalQueryError() from error
    if request is None:
        raise WithdrawalRequestNotFoundError()
    if request.status != "requested":
        if (
            request.status == normalized_status
            and request.resolution_reason == normalized_reason
        ):
            return request
        raise WithdrawalRequestAlreadyResolvedError()

    request.status = normalized_status
    request.resolved_at = _utc_now()
    request.resolution_reason = normalized_reason
    try:
        database.commit()
        database.refresh(request)
    except SQLAlchemyError as error:
        database.rollback()
        raise WithdrawalPersistenceError() from error
    return request


def admin_record_for_request(
    *,
    database: Session,
    request: WithdrawalRequest,
) -> AdminWithdrawalRecord:
    try:
        stored = database.scalar(
            select(WithdrawalRequest)
            .options(
                joinedload(WithdrawalRequest.profile),
                joinedload(WithdrawalRequest.contribution),
            )
            .where(WithdrawalRequest.id == request.id)
        )
    except SQLAlchemyError as error:
        database.rollback()
        raise WithdrawalQueryError() from error
    if stored is None:
        raise WithdrawalRequestNotFoundError()
    affected_count = 1
    if stored.scope == "all":
        try:
            affected_count = int(
                database.scalar(
                    select(func.count())
                    .select_from(Contribution)
                    .where(
                        Contribution.user_id == stored.user_id,
                        Contribution.created_at <= stored.requested_at,
                    )
                )
                or 0
            )
        except SQLAlchemyError as error:
            database.rollback()
            raise WithdrawalQueryError() from error
    return AdminWithdrawalRecord(
        request=stored,
        owner_display_name=stored.profile.display_name,
        contribution_summary=_summary_for_contribution(stored.contribution),
        affected_contribution_count=affected_count,
    )
