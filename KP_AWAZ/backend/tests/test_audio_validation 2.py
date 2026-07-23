"""Tests for safe audio metadata, size, and basic signature validation."""

import pytest
from pydantic import ValidationError

from app.config import Settings
from app.utils.audio_validation import (
    AUDIO_MIME_EXTENSION_MAP,
    AudioExtensionMismatchError,
    AudioFileTooLargeError,
    EmptyAudioFileError,
    InvalidAudioFilenameError,
    InvalidAudioSignatureError,
    UnsupportedAudioTypeError,
    extract_safe_audio_filename,
    validate_audio_file_size,
    validate_audio_file_size_bytes,
    validate_audio_filename_extension,
    validate_audio_mime_type,
    validate_audio_signature,
    validate_audio_upload,
)


WEBM_BYTES = b"\x1a\x45\xdf\xa3webm-data"
OGG_BYTES = b"OggSogg-data"
WAV_BYTES = b"RIFF\x04\x00\x00\x00WAVEwav-data"
MP3_ID3_BYTES = b"ID3mp3-data"
MP3_FRAME_BYTES = b"\xff\xfbmp3-data"
MP4_BYTES = b"\x00\x00\x00\x18ftypM4A m4a-data"
AAC_BYTES = b"\xff\xf1aac-data"
FLAC_BYTES = b"fLaCflac-data"


@pytest.mark.parametrize(
    ("mime_type", "extension"),
    [
        ("audio/webm", "webm"),
        ("audio/ogg", "ogg"),
        ("audio/wav", "wav"),
        ("audio/x-wav", "wav"),
        ("audio/mpeg", "mp3"),
        ("audio/mp4", "m4a"),
        ("audio/aac", "aac"),
        ("audio/flac", "flac"),
    ],
)
def test_supported_mime_types_map_to_safe_extensions(
    mime_type: str, extension: str
) -> None:
    assert validate_audio_mime_type(mime_type) == extension


def test_mime_casing_and_codec_parameters_are_normalized() -> None:
    assert validate_audio_mime_type(" Audio/WebM; codecs=opus ") == "webm"


def test_mime_mapping_is_immutable() -> None:
    with pytest.raises(TypeError):
        AUDIO_MIME_EXTENSION_MAP["audio/unsafe"] = "unsafe"  # type: ignore[index]


@pytest.mark.parametrize("mime_type", ["video/webm", "application/octet-stream", ""])
def test_unsupported_or_missing_mime_is_rejected(mime_type: str) -> None:
    with pytest.raises(UnsupportedAudioTypeError) as error:
        validate_audio_mime_type(mime_type)

    assert error.value.code == "UNSUPPORTED_AUDIO_TYPE"


def test_unix_traversal_filename_becomes_display_basename() -> None:
    assert extract_safe_audio_filename("../../recording.webm") == "recording.webm"


def test_windows_traversal_filename_becomes_display_basename() -> None:
    assert extract_safe_audio_filename(r"..\..\recording.webm") == "recording.webm"


def test_empty_audio_filename_is_rejected() -> None:
    with pytest.raises(InvalidAudioFilenameError) as error:
        extract_safe_audio_filename("")

    assert error.value.code == "INVALID_AUDIO_FILENAME"


@pytest.mark.parametrize(
    ("filename", "mime_type"),
    [
        ("recording.webm", "audio/webm"),
        ("recording.ogg", "audio/ogg"),
        ("recording.mp3", "audio/mpeg"),
        ("recording.m4a", "audio/mp4"),
        ("recording.mp4", "audio/mp4"),
        ("recording.WAV", "audio/x-wav"),
    ],
)
def test_matching_and_equivalent_filename_extensions_succeed(
    filename: str, mime_type: str
) -> None:
    validate_audio_filename_extension(filename, mime_type)


@pytest.mark.parametrize(
    ("filename", "mime_type"),
    [
        ("recording.exe", "audio/webm"),
        ("recording.wav", "audio/webm"),
        ("recording.webm", "audio/ogg"),
    ],
)
def test_contradictory_filename_extension_is_rejected(
    filename: str, mime_type: str
) -> None:
    with pytest.raises(AudioExtensionMismatchError) as error:
        validate_audio_filename_extension(filename, mime_type)

    assert error.value.code == "AUDIO_EXTENSION_MISMATCH"


def test_missing_filename_extension_is_allowed_for_valid_mime() -> None:
    validate_audio_filename_extension("recording", "audio/webm")


def test_empty_audio_content_is_rejected() -> None:
    with pytest.raises(EmptyAudioFileError) as error:
        validate_audio_file_size(0, 1)

    assert error.value.code == "EMPTY_AUDIO_FILE"


def test_file_exactly_at_size_limit_is_allowed() -> None:
    one_byte_in_megabytes = 1 / (1024 * 1024)
    validate_audio_file_size(1, one_byte_in_megabytes)


def test_file_above_size_limit_is_rejected() -> None:
    one_byte_in_megabytes = 1 / (1024 * 1024)

    with pytest.raises(AudioFileTooLargeError) as error:
        validate_audio_file_size(2, one_byte_in_megabytes)

    assert error.value.code == "AUDIO_FILE_TOO_LARGE"


def test_universal_byte_limit_accepts_exact_size_and_rejects_larger() -> None:
    validate_audio_file_size_bytes(10, 10)

    with pytest.raises(AudioFileTooLargeError):
        validate_audio_file_size_bytes(11, 10)


@pytest.mark.parametrize(
    ("content", "mime_type"),
    [
        (WEBM_BYTES, "audio/webm"),
        (OGG_BYTES, "audio/ogg"),
        (WAV_BYTES, "audio/wav"),
        (WAV_BYTES, "audio/x-wav"),
        (MP3_ID3_BYTES, "audio/mpeg"),
        (MP3_FRAME_BYTES, "audio/mpeg"),
        (MP4_BYTES, "audio/mp4"),
        (AAC_BYTES, "audio/aac"),
        (FLAC_BYTES, "audio/flac"),
    ],
)
def test_valid_basic_audio_signatures_succeed(
    content: bytes, mime_type: str
) -> None:
    validate_audio_signature(content, mime_type)


@pytest.mark.parametrize(
    "mime_type",
    [
        "audio/webm",
        "audio/ogg",
        "audio/wav",
        "audio/mpeg",
        "audio/mp4",
        "audio/aac",
        "audio/flac",
    ],
)
def test_invalid_audio_signatures_are_rejected(mime_type: str) -> None:
    with pytest.raises(InvalidAudioSignatureError) as error:
        validate_audio_signature(b"not-valid-audio", mime_type)

    assert error.value.code == "INVALID_AUDIO_SIGNATURE"


def test_complete_webm_validation_returns_normalized_metadata() -> None:
    result = validate_audio_upload(
        filename="../../Recording.WEBM",
        mime_type=" Audio/WebM; codecs=opus ",
        content=WEBM_BYTES,
        max_size_mb=1,
    )

    assert result.original_filename == "Recording.WEBM"
    assert result.mime_type == "audio/webm"
    assert result.original_mime_type == "audio/webm;codecs=opus"
    assert result.extension == "webm"
    assert result.file_size == len(WEBM_BYTES)
    assert "../" not in result.original_filename


def test_complete_validation_ignores_client_extension_for_storage_mapping() -> None:
    result = validate_audio_upload(
        filename="../../misleading.wav",
        mime_type="audio/webm;codecs=opus",
        content=WEBM_BYTES,
        max_size_bytes=len(WEBM_BYTES),
    )

    assert result.original_filename == "misleading.wav"
    assert result.extension == "webm"


def test_public_validation_error_does_not_include_byte_content() -> None:
    content = b"private-byte-content"

    with pytest.raises(InvalidAudioSignatureError) as error:
        validate_audio_upload(
            filename="recording.webm",
            mime_type="audio/webm",
            content=content,
            max_size_mb=1,
        )

    assert repr(content) not in str(error.value)
    assert "private-byte-content" not in str(error.value)


@pytest.mark.parametrize(
    "setting_name",
    [
        "max_audio_upload_bytes",
        "max_guided_audio_size_mb",
        "max_open_audio_size_mb",
    ],
)
def test_audio_size_settings_must_be_positive(setting_name: str) -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **{setting_name: 0})


@pytest.mark.parametrize("subdirectory", ["", "../audio", r"..\audio", "/audio"])
def test_audio_storage_subdirectory_must_be_safe(subdirectory: str) -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, audio_storage_subdirectory=subdirectory)
