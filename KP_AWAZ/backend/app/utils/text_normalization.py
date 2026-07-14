"""Conservative normalization helpers for sentence metadata and Unicode text."""

import unicodedata


def clean_sentence_text(text: str) -> str:
    """Remove only surrounding whitespace from original sentence text."""

    if not isinstance(text, str):
        raise TypeError("sentence text must be a string")

    return text.strip()


def normalize_sentence_text(text: str) -> str:
    """Normalize sentence text for safe, language-preserving comparisons."""

    cleaned_text = clean_sentence_text(text)
    compatibility_normalized = unicodedata.normalize("NFKC", cleaned_text)
    return " ".join(compatibility_normalized.split())


def normalize_language_name(language: str) -> str:
    """Return a consistently spaced and cased display name for a language."""

    if not isinstance(language, str):
        raise TypeError("language must be a string")

    normalized_language = normalize_sentence_text(language)
    if not normalized_language:
        raise ValueError("language must not be blank")

    return normalized_language.title()
