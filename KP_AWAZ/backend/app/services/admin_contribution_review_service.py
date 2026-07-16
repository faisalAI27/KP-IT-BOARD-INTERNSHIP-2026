"""Database and private-file operations for admin contribution review."""

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, joinedload

from app.models import Contribution
from app.services.audio_storage import AudioStorageError, resolve_audio_storage_path
from app.services.points_ledger_service import (
    PointsLedgerError,
    create_review_point_entry,
)
from app.utils.audio_validation import (
    AUDIO_MIME_FILENAME_EXTENSIONS,
    AudioValidationError,
    normalize_audio_mime_type,
)


REVIEW_STATUSES = frozenset({"pending", "approved", "rejected"})
REVIEW_ACTIONS = frozenset({"approved", "rejected"})
MAX_REJECTION_REASON_LENGTH = 500


class AdminContributionReviewError(Exception):
    """Base error carrying only safe admin API metadata."""

    code = "ADMIN_CONTRIBUTION_REVIEW_ERROR"
    default_message = "The contribution review request could not be completed."
    http_status = 400

    def __init__(self) -> None:
        self.message = self.default_message
        super().__init__(self.message)


class ContributionNotFoundError(AdminContributionReviewError):
    code = "CONTRIBUTION_NOT_FOUND"
    default_message = "The requested contribution was not found."
    http_status = 404


class InvalidReviewStatusError(AdminContributionReviewError):
    code = "INVALID_REVIEW_STATUS"
    default_message = "The contribution review status is invalid."


class RejectionReasonRequiredError(AdminContributionReviewError):
    code = "REJECTION_REASON_REQUIRED"
    default_message = "A rejection reason is required when rejecting a contribution."


class InvalidRejectionReasonError(AdminContributionReviewError):
    code = "INVALID_REJECTION_REASON"
    default_message = "The rejection reason must not exceed 500 characters."


class ContributionAudioNotFoundError(AdminContributionReviewError):
    code = "CONTRIBUTION_AUDIO_NOT_FOUND"
    default_message = "The contribution audio file was not found."
    http_status = 404


class UnsafeContributionAudioPathError(AdminContributionReviewError):
    code = "UNSAFE_AUDIO_PATH"
    default_message = "The contribution audio could not be accessed safely."
    http_status = 500


class ContributionReviewPersistenceError(AdminContributionReviewError):
    code = "CONTRIBUTION_REVIEW_PERSISTENCE_FAILED"
    default_message = "The contribution review could not be saved."
    http_status = 500


class ContributionPointsPersistenceError(AdminContributionReviewError):
    code = "POINTS_LEDGER_PERSISTENCE_FAILED"
    default_message = "Contribution points could not be saved."
    http_status = 500


class ContributionReviewQueryError(AdminContributionReviewError):
    code = "CONTRIBUTION_REVIEW_QUERY_FAILED"
    default_message = "The contribution review queue could not be loaded."
    http_status = 500


@dataclass(frozen=True, slots=True)
class ContributionAudioFile:
    """Validated private audio response metadata."""

    path: Path
    mime_type: str
    filename: str


def _normalize_list_status(review_status: str) -> str:
    if not isinstance(review_status, str):
        raise InvalidReviewStatusError()
    normalized_status = review_status.strip().lower()
    if normalized_status not in REVIEW_STATUSES | {"all"}:
        raise InvalidReviewStatusError()
    return normalized_status


def _normalize_review_decision(
    review_status: str,
    rejection_reason: str | None,
) -> tuple[str, str | None]:
    if not isinstance(review_status, str):
        raise InvalidReviewStatusError()
    normalized_status = review_status.strip().lower()
    if normalized_status not in REVIEW_ACTIONS:
        raise InvalidReviewStatusError()

    if normalized_status == "approved":
        return normalized_status, None
    if rejection_reason is None or not isinstance(rejection_reason, str):
        raise RejectionReasonRequiredError()
    normalized_reason = rejection_reason.strip()
    if not normalized_reason:
        raise RejectionReasonRequiredError()
    if len(normalized_reason) > MAX_REJECTION_REASON_LENGTH:
        raise InvalidRejectionReasonError()
    return normalized_status, normalized_reason


def list_admin_contributions(
    *,
    database: Session,
    review_status: str,
    limit: int,
    offset: int,
) -> tuple[list[Contribution], int, str]:
    """Return one database-filtered page for the protected review queue."""

    normalized_status = _normalize_list_status(review_status)
    status_filter = (
        None
        if normalized_status == "all"
        else Contribution.review_status == normalized_status
    )
    count_query = select(func.count()).select_from(Contribution)
    item_query = select(Contribution).options(joinedload(Contribution.profile))
    if status_filter is not None:
        count_query = count_query.where(status_filter)
        item_query = item_query.where(status_filter)
    item_query = (
        item_query.order_by(Contribution.created_at.desc(), Contribution.id.desc())
        .limit(limit)
        .offset(offset)
    )

    try:
        total = database.scalar(count_query)
        items = list(database.scalars(item_query).unique().all())
    except SQLAlchemyError as error:
        database.rollback()
        raise ContributionReviewQueryError() from error
    return items, int(total or 0), normalized_status


def get_admin_contribution(
    *, database: Session, contribution_id: str
) -> Contribution:
    """Retrieve one contribution with its optional safe profile relationship."""

    try:
        contribution = database.scalar(
            select(Contribution)
            .options(joinedload(Contribution.profile))
            .where(Contribution.id == contribution_id)
        )
    except SQLAlchemyError as error:
        database.rollback()
        raise ContributionReviewQueryError() from error
    if contribution is None:
        raise ContributionNotFoundError()
    return contribution


def get_contribution_audio_file(
    *, database: Session, contribution_id: str
) -> ContributionAudioFile:
    """Resolve one contribution's private audio without exposing its storage key."""

    contribution = get_admin_contribution(
        database=database,
        contribution_id=contribution_id,
    )
    try:
        audio_path = resolve_audio_storage_path(contribution.audio_storage_key)
        normalized_mime_type = normalize_audio_mime_type(contribution.mime_type)
        allowed_extensions = AUDIO_MIME_FILENAME_EXTENSIONS[normalized_mime_type]
    except (AudioStorageError, AudioValidationError, KeyError) as error:
        raise UnsafeContributionAudioPathError() from error

    extension = audio_path.suffix.removeprefix(".").lower()
    if extension not in allowed_extensions:
        raise UnsafeContributionAudioPathError()
    if not audio_path.exists() or audio_path.is_symlink() or not audio_path.is_file():
        raise ContributionAudioNotFoundError()

    return ContributionAudioFile(
        path=audio_path,
        mime_type=normalized_mime_type,
        filename=f"contribution-audio.{extension}",
    )


def apply_contribution_review(
    *,
    database: Session,
    contribution_id: str,
    review_status: str,
    rejection_reason: str | None,
) -> Contribution:
    """Apply one reversible approval or rejection decision transactionally."""

    normalized_status, normalized_reason = _normalize_review_decision(
        review_status,
        rejection_reason,
    )
    contribution = get_admin_contribution(
        database=database,
        contribution_id=contribution_id,
    )
    if (
        contribution.review_status == normalized_status
        and contribution.rejection_reason == normalized_reason
    ):
        return contribution

    previous_status = contribution.review_status
    contribution.review_revision += 1
    contribution.review_status = normalized_status
    contribution.reviewed_at = datetime.now(timezone.utc)
    contribution.rejection_reason = normalized_reason
    try:
        create_review_point_entry(
            database=database,
            contribution=contribution,
            previous_status=previous_status,
        )
        database.commit()
    except PointsLedgerError as error:
        database.rollback()
        raise ContributionPointsPersistenceError() from error
    except IntegrityError:
        database.rollback()
        current = get_admin_contribution(
            database=database,
            contribution_id=contribution_id,
        )
        if (
            current.review_status == normalized_status
            and current.rejection_reason == normalized_reason
        ):
            return current
        raise ContributionReviewPersistenceError()
    except Exception as error:
        database.rollback()
        raise ContributionReviewPersistenceError() from error
    return contribution
