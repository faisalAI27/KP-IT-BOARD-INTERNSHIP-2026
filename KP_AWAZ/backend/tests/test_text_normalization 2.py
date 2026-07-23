"""Tests for conservative Unicode sentence normalization."""

import pytest

from app.utils.text_normalization import normalize_sentence_text


def test_surrounding_spaces_are_removed() -> None:
    assert normalize_sentence_text("  هر غږ ارزښت لري.  ") == "هر غږ ارزښت لري."


def test_repeated_spaces_become_one_space() -> None:
    assert normalize_sentence_text("زما   ژبه") == "زما ژبه"


def test_tabs_become_normal_spacing() -> None:
    assert normalize_sentence_text("زما\tژبه") == "زما ژبه"


def test_line_breaks_become_normal_spacing() -> None:
    assert normalize_sentence_text("زما\n\nژبه") == "زما ژبه"


def test_nfkc_normalization_is_applied() -> None:
    assert normalize_sentence_text("ＡＢＣ") == "ABC"


def test_pashto_text_remains_readable() -> None:
    sentence = "پښتو زموږ د تاریخ یوه مهمه برخه ده"

    assert normalize_sentence_text(sentence) == sentence


def test_punctuation_is_preserved() -> None:
    sentence = "ایا هر غږ ارزښت لري؟ هو، لري!"

    assert normalize_sentence_text(sentence) == sentence


def test_diacritics_are_preserved() -> None:
    sentence = "مُحَمَّد"

    assert normalize_sentence_text(sentence) == sentence


def test_empty_string_normalizes_to_empty_string() -> None:
    assert normalize_sentence_text("") == ""


def test_non_string_value_is_rejected_clearly() -> None:
    with pytest.raises(TypeError, match="sentence text must be a string"):
        normalize_sentence_text(123)  # type: ignore[arg-type]
