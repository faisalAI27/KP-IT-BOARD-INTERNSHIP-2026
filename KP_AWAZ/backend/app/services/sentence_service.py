"""Database operations for sentence retrieval."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Sentence
from app.utils.text_normalization import normalize_language_name


def get_active_sentences(
    database: Session, *, language: str, limit: int
) -> list[Sentence]:
    """Return a random, limited set of active sentences for one language."""

    normalized_language = normalize_language_name(language)
    statement = (
        select(Sentence)
        .where(
            Sentence.is_active.is_(True),
            func.lower(Sentence.language) == normalized_language.lower(),
        )
        .order_by(func.random())
        .limit(limit)
    )

    return list(database.scalars(statement).all())
