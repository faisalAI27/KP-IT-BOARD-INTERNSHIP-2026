"""Database operations for sentence retrieval."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Sentence
from app.utils.text_normalization import normalize_language_name


class SentenceDeliveryError(RuntimeError):
    code = "SENTENCE_DELIVERY_FAILED"
    message = "Contribution phrases could not be loaded. Please try again."


def get_active_sentences(
    database: Session, *, language: str, limit: int
) -> list[Sentence]:
    """Return and count a least-used set of active prompts for one language."""

    normalized_language = normalize_language_name(language)
    statement = (
        select(Sentence)
        .where(
            Sentence.is_active.is_(True),
            func.lower(Sentence.language) == normalized_language.lower(),
        )
        .order_by(Sentence.times_assigned.asc(), func.random())
        .limit(limit)
    )
    try:
        sentences = list(database.scalars(statement).all())
        for sentence in sentences:
            sentence.times_assigned += 1
        if sentences:
            database.commit()
        return sentences
    except Exception as error:
        database.rollback()
        raise SentenceDeliveryError() from error
