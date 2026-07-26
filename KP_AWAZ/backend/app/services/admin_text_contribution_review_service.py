"""Protected database operations for reviewing donated written text."""

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, joinedload

from app.models import TextContribution


PUBLIC_REVIEW_STATUSES = frozenset({"pending", "approved", "rejected"})
REVIEW_ACTIONS = frozenset({"approved", "rejected"})
MAX_REJECTION_REASON_LENGTH = 500
DATABASE_STATUS = {
    "pending": "queued",
    "approved": "approved",
    "rejected": "rejected",
}


class AdminTextContributionReviewError(Exception):
    """Base error carrying only safe admin API metadata."""

    code = "ADMIN_TEXT_CONTRIBUTION_REVIEW_ERROR"
    default_message = "The text contribution review request could not be completed."
    http_status = 400

    def __init__(self) -> None:
        self.message = self.default_message
        super().__init__(self.message)


class TextContributionNotFoundError(AdminTextContributionReviewError):
    code = "TEXT_CONTRIBUTION_NOT_FOUND"
    default_message = "The requested text contribution was not found."
    http_status = 404


class InvalidTextReviewStatusError(AdminTextContributionReviewError):
    code = "INVALID_TEXT_REVIEW_STATUS"
    default_message = "The text contribution review status is invalid."


class TextRejectionReasonRequiredError(AdminTextContributionReviewError):
    code = "TEXT_REJECTION_REASON_REQUIRED"
    default_message = "A rejection reason is required when rejecting donated text."


class InvalidTextRejectionReasonError(AdminTextContributionReviewError):
    code = "INVALID_TEXT_REJECTION_REASON"
    default_message = "The rejection reason must not exceed 500 characters."


class TextContributionReviewQueryError(AdminTextContributionReviewError):
    code = "TEXT_CONTRIBUTION_REVIEW_QUERY_FAILED"
    default_message = "The donated-text review queue could not be loaded."
    http_status = 500


class TextContributionReviewPersistenceError(AdminTextContributionReviewError):
    code = "TEXT_CONTRIBUTION_REVIEW_PERSISTENCE_FAILED"
    default_message = "The donated-text review decision could not be saved."
    http_status = 500


def normalize_public_text_status(database_status: str) -> str:
    """Map the internal initial status to the admin-facing review vocabulary."""

    normalized = (
        database_status.strip().lower()
        if isinstance(database_status, str)
        else ""
    )
    return "pending" if normalized == "queued" else normalized


def _normalize_list_status(review_status: str) -> str:
    if not isinstance(review_status, str):
        raise InvalidTextReviewStatusError()
    normalized = review_status.strip().lower()
    if normalized not in PUBLIC_REVIEW_STATUSES | {"all"}:
        raise InvalidTextReviewStatusError()
    return normalized


def _normalize_decision(
    review_status: str,
    rejection_reason: str | None,
) -> tuple[str, str | None]:
    if not isinstance(review_status, str):
        raise InvalidTextReviewStatusError()
    normalized = review_status.strip().lower()
    if normalized not in REVIEW_ACTIONS:
        raise InvalidTextReviewStatusError()
    if normalized == "approved":
        return normalized, None
    if not isinstance(rejection_reason, str) or not rejection_reason.strip():
        raise TextRejectionReasonRequiredError()
    reason = rejection_reason.strip()
    if len(reason) > MAX_REJECTION_REASON_LENGTH:
        raise InvalidTextRejectionReasonError()
    return normalized, reason


def list_admin_text_contributions(
    *,
    database: Session,
    review_status: str,
    limit: int,
    offset: int,
) -> tuple[list[TextContribution], int, str]:
    """Return one database-filtered page of written submissions."""

    normalized = _normalize_list_status(review_status)
    status_filter = (
        None
        if normalized == "all"
        else TextContribution.status == DATABASE_STATUS[normalized]
    )
    count_query = select(func.count()).select_from(TextContribution)
    item_query = select(TextContribution).options(
        joinedload(TextContribution.profile)
    )
    if status_filter is not None:
        count_query = count_query.where(status_filter)
        item_query = item_query.where(status_filter)
    item_query = (
        item_query.order_by(
            TextContribution.created_at.desc(),
            TextContribution.id.desc(),
        )
        .limit(limit)
        .offset(offset)
    )
    try:
        total = database.scalar(count_query)
        items = list(database.scalars(item_query).unique().all())
    except SQLAlchemyError as error:
        database.rollback()
        raise TextContributionReviewQueryError() from error
    return items, int(total or 0), normalized


def get_admin_text_contribution(
    *,
    database: Session,
    contribution_id: str,
) -> TextContribution:
    """Retrieve one written submission with its optional profile relationship."""

    try:
        contribution = database.scalar(
            select(TextContribution)
            .options(joinedload(TextContribution.profile))
            .where(TextContribution.id == contribution_id)
        )
    except SQLAlchemyError as error:
        database.rollback()
        raise TextContributionReviewQueryError() from error
    if contribution is None:
        raise TextContributionNotFoundError()
    return contribution


def apply_text_contribution_review(
    *,
    database: Session,
    contribution_id: str,
    review_status: str,
    rejection_reason: str | None,
) -> TextContribution:
    """Apply one reversible donated-text approval or rejection decision."""

    normalized_status, normalized_reason = _normalize_decision(
        review_status,
        rejection_reason,
    )
    contribution = get_admin_text_contribution(
        database=database,
        contribution_id=contribution_id,
    )
    if (
        contribution.status == normalized_status
        and contribution.rejection_reason == normalized_reason
    ):
        return contribution
    contribution.status = normalized_status
    contribution.reviewed_at = datetime.now(timezone.utc)
    contribution.rejection_reason = normalized_reason
    try:
        database.commit()
        database.refresh(contribution)
    except SQLAlchemyError as error:
        database.rollback()
        raise TextContributionReviewPersistenceError() from error
    return get_admin_text_contribution(
        database=database,
        contribution_id=contribution_id,
    )
