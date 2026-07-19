"""Canonical database eligibility rules for future dataset exports."""

from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models import Contribution, WithdrawalRequest
from app.services.withdrawal_service import EXPORT_EXCLUSION_STATUSES


class DatasetExportQueryError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("Dataset export eligibility could not be evaluated.")


def export_eligible_contributions_statement():
    """Build the single authoritative eligibility query used by future exports."""

    exclusion_exists = exists(
        select(WithdrawalRequest.id).where(
            WithdrawalRequest.user_id == Contribution.user_id,
            WithdrawalRequest.status.in_(EXPORT_EXCLUSION_STATUSES),
            or_(
                and_(
                    WithdrawalRequest.scope == "contribution",
                    WithdrawalRequest.contribution_id == Contribution.id,
                ),
                and_(
                    WithdrawalRequest.scope == "all",
                    WithdrawalRequest.requested_at >= Contribution.created_at,
                ),
            ),
        )
    )
    return select(Contribution).where(
        Contribution.review_status == "approved",
        Contribution.consent_given.is_(True),
        Contribution.consent_policy_version.is_not(None),
        func.trim(Contribution.consent_policy_version) != "",
        Contribution.consent_timestamp.is_not(None),
        ~exclusion_exists,
    )


def list_export_eligible_contributions(
    *,
    database: Session,
    limit: int = 1000,
    offset: int = 0,
) -> list[Contribution]:
    """Return reviewed, consented, non-withdrawn rows without exposing an API."""

    try:
        return list(
            database.scalars(
                export_eligible_contributions_statement()
                .order_by(Contribution.created_at.asc(), Contribution.id.asc())
                .limit(limit)
                .offset(offset)
            ).all()
        )
    except SQLAlchemyError as error:
        database.rollback()
        raise DatasetExportQueryError() from error


def is_contribution_export_eligible(
    *,
    database: Session,
    contribution_id: str,
) -> bool:
    try:
        eligible_query = (
            export_eligible_contributions_statement()
            .where(Contribution.id == contribution_id)
            .subquery()
        )
        return bool(
            database.scalar(select(func.count()).select_from(eligible_query))
        )
    except SQLAlchemyError as error:
        database.rollback()
        raise DatasetExportQueryError() from error
