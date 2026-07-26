"""Insert the initial Pashto sentence prompts into the configured database."""

import sys

from sqlalchemy import select

from app.database import Base, SessionLocal, engine
from app.models import Sentence
from app.services.schema_compatibility import ensure_sentence_phrase_schema
from app.utils.text_normalization import (
    clean_sentence_text,
    normalize_language_name,
    normalize_sentence_text,
)


SEED_SENTENCES = (
    (
        "زما ژبه زما پېژندنه ده.",
        "Zama zhaba zama pehzhandana da.",
        "My language is my identity.",
    ),
    (
        "هر غږ ارزښت لري.",
        "Har ghag arzakh larai.",
        "Every voice has value.",
    ),
    (
        "زموږ کلتور زموږ د خلکو پېژندنه ده.",
        "Zmung kaltoor zmung da khalqo pehzhandana da.",
        "Our culture is the identity of our people.",
    ),
    (
        "پښتو زموږ د تاریخ یوه مهمه برخه ده.",
        "Pashto zmung da tareekh yawa muhimma barkha da.",
        "Pashto is an important part of our history.",
    ),
    (
        "موږ خپلې کیسې راتلونکو نسلونو ته رسوو.",
        "Mung khpalay keesay ratlonko naslono ta rasawo.",
        "We pass our stories on to future generations.",
    ),
)


def seed_sentences() -> tuple[int, int]:
    """Insert missing seed sentences and return inserted and skipped counts."""

    language = normalize_language_name("Pashto")
    inserted = 0
    skipped = 0
    database = SessionLocal()

    try:
        for text, roman_text, meaning in SEED_SENTENCES:
            cleaned_text = clean_sentence_text(text)
            normalized_text = normalize_sentence_text(cleaned_text)
            existing_sentence = database.scalar(
                select(Sentence).where(
                    Sentence.language == language,
                    Sentence.normalized_text == normalized_text,
                )
            )

            if existing_sentence is not None:
                if not existing_sentence.roman_text:
                    existing_sentence.roman_text = roman_text
                if not existing_sentence.meaning:
                    existing_sentence.meaning = meaning
                skipped += 1
                continue

            database.add(
                Sentence(
                    language=language,
                    text=cleaned_text,
                    roman_text=roman_text,
                    meaning=meaning,
                    normalized_text=normalized_text,
                    source_type="seed",
                    source_filename=None,
                    is_active=True,
                )
            )
            inserted += 1

        database.commit()
    except Exception:
        database.rollback()
        raise
    finally:
        database.close()

    return inserted, skipped


def main() -> int:
    """Create missing tables, seed sentences, and return a process exit code."""

    try:
        Base.metadata.create_all(bind=engine)
        ensure_sentence_phrase_schema(engine)
        inserted, skipped = seed_sentences()
    except Exception as error:
        print(f"Failed to seed sentences: {error}", file=sys.stderr)
        return 1

    print(f"Inserted sentences: {inserted}")
    print(f"Skipped duplicate sentences: {skipped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
