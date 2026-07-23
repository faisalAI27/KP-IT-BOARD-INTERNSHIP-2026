"""Validation and persistence for contributor-submitted written text."""

from dataclasses import dataclass

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models import TextContribution
from app.utils.text_normalization import normalize_language_name


ALLOWED_TEXT_TYPES = {"sentence", "proverb", "phrase", "story_line"}


class TextContributionServiceError(Exception):
    """Safe public error for invalid or failed text contribution requests."""

    code = "TEXT_CONTRIBUTION_FAILED"
    http_status = 400
    default_message = "The text contribution could not be submitted."

    def __init__(self, message: str | None = None) -> None:
        super().__init__(message or self.default_message)


class TextContributionPersistenceError(TextContributionServiceError):
    code = "TEXT_CONTRIBUTION_PERSISTENCE_FAILED"
    http_status = 500


@dataclass(frozen=True)
class TextContributionItemInput:
    """One validated manual or file-based text item."""

    submission_method: str
    text_type: str
    content: str
    original_filename: str | None = None
    mime_type: str | None = None
    file_size: int | None = None


def create_text_contributions(
    *,
    database: Session,
    owner_user_id: str,
    contributor_name: str,
    language: str,
    items: list[TextContributionItemInput],
) -> list[TextContribution]:
    """Persist one authenticated batch atomically."""

    safe_name = contributor_name.strip()
    if not 2 <= len(safe_name) <= 100:
        raise TextContributionServiceError(
            "A contributor name between 2 and 100 characters is required."
        )
    try:
        safe_language = normalize_language_name(language)
    except (TypeError, ValueError) as error:
        raise TextContributionServiceError(
            "Text contributions currently support Pashto only."
        ) from error
    if safe_language != "Pashto":
        raise TextContributionServiceError(
            "Text contributions currently support Pashto only."
        )
    if not items:
        raise TextContributionServiceError(
            "Write one Pashto sentence or choose at least one text file."
        )

    contributions: list[TextContribution] = []
    for item in items:
        content = item.content.strip()
        if not content:
            raise TextContributionServiceError(
                "Text contribution files must not be empty."
            )
        if item.submission_method not in {"manual", "file"}:
            raise TextContributionServiceError("The text contribution type is invalid.")
        if item.submission_method == "manual":
            if item.text_type not in ALLOWED_TEXT_TYPES:
                raise TextContributionServiceError("The text type is invalid.")
            if not 3 <= len(content) <= 500:
                raise TextContributionServiceError(
                    "A manual text contribution must contain 3 to 500 characters."
                )
        contribution = TextContribution(
            user_id=owner_user_id,
            contributor_name=safe_name,
            language=safe_language,
            submission_method=item.submission_method,
            text_type=(
                item.text_type if item.submission_method == "manual" else "file_batch"
            ),
            text_content=content,
            original_filename=item.original_filename,
            mime_type=item.mime_type,
            file_size=item.file_size,
            status="queued",
        )
        contribution.normalize_for_storage()
        database.add(contribution)
        contributions.append(contribution)

    try:
        database.commit()
        for contribution in contributions:
            database.refresh(contribution)
    except SQLAlchemyError as error:
        database.rollback()
        raise TextContributionPersistenceError() from error
    return contributions
