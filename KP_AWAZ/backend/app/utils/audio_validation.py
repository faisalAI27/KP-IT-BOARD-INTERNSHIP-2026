"""Conservative validation for supported audio upload metadata and headers."""

from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Mapping

from app.services.txt_import_parser import InvalidImportFilenameError
from app.utils.file_safety import extract_safe_display_filename


AUDIO_MIME_EXTENSION_MAP: Mapping[str, str] = MappingProxyType(
    {
        "audio/webm": "webm",
        "audio/ogg": "ogg",
        "audio/wav": "wav",
        "audio/x-wav": "wav",
        "audio/mpeg": "mp3",
        "audio/mp4": "m4a",
    }
)

AUDIO_MIME_FILENAME_EXTENSIONS: Mapping[str, frozenset[str]] = MappingProxyType(
    {
        "audio/webm": frozenset({"webm"}),
        "audio/ogg": frozenset({"ogg"}),
        "audio/wav": frozenset({"wav"}),
        "audio/x-wav": frozenset({"wav"}),
        "audio/mpeg": frozenset({"mp3"}),
        "audio/mp4": frozenset({"m4a", "mp4"}),
    }
)

SUPPORTED_AUDIO_EXTENSIONS = frozenset(AUDIO_MIME_EXTENSION_MAP.values())


class AudioValidationError(Exception):
    """Base audio error containing only safe future API details."""

    code = "AUDIO_VALIDATION_ERROR"
    default_message = "The audio upload could not be validated."

    def __init__(self, message: str | None = None) -> None:
        self.message = message or self.default_message
        super().__init__(self.message)


class EmptyAudioFileError(AudioValidationError):
    code = "EMPTY_AUDIO_FILE"
    default_message = "The audio file must not be empty."


class UnsupportedAudioTypeError(AudioValidationError):
    code = "UNSUPPORTED_AUDIO_TYPE"
    default_message = "The audio type is not supported."


class AudioFileTooLargeError(AudioValidationError):
    code = "AUDIO_FILE_TOO_LARGE"
    default_message = "The audio file exceeds the configured size limit."


class AudioExtensionMismatchError(AudioValidationError):
    code = "AUDIO_EXTENSION_MISMATCH"
    default_message = "The audio filename extension does not match its type."


class InvalidAudioSignatureError(AudioValidationError):
    code = "INVALID_AUDIO_SIGNATURE"
    default_message = "The audio file header does not match its type."


class InvalidAudioFilenameError(AudioValidationError):
    code = "INVALID_AUDIO_FILENAME"
    default_message = "A valid audio filename is required."


@dataclass(frozen=True, slots=True)
class ValidatedAudio:
    """Normalized audio metadata ready for a later submission service."""

    original_filename: str
    mime_type: str
    extension: str
    file_size: int


def extract_safe_audio_filename(filename: str) -> str:
    """Return a safe display basename used only as contribution metadata."""

    try:
        return extract_safe_display_filename(filename)
    except InvalidImportFilenameError as error:
        raise InvalidAudioFilenameError() from error


def normalize_audio_mime_type(mime_type: str) -> str:
    """Normalize a MIME type and ignore optional codec parameters."""

    if not isinstance(mime_type, str) or not mime_type.strip():
        raise UnsupportedAudioTypeError()
    return mime_type.strip().split(";", maxsplit=1)[0].strip().lower()


def validate_audio_mime_type(mime_type: str) -> str:
    """Return the safe storage extension for one supported MIME type."""

    normalized_mime_type = normalize_audio_mime_type(mime_type)
    try:
        return AUDIO_MIME_EXTENSION_MAP[normalized_mime_type]
    except KeyError as error:
        raise UnsupportedAudioTypeError() from error


def validate_audio_filename_extension(filename: str, mime_type: str) -> None:
    """Reject a present filename extension that contradicts the MIME type."""

    display_filename = extract_safe_audio_filename(filename)
    normalized_mime_type = normalize_audio_mime_type(mime_type)
    validate_audio_mime_type(normalized_mime_type)
    suffix = Path(display_filename).suffix
    if not suffix:
        return

    supplied_extension = suffix.removeprefix(".").lower()
    if supplied_extension not in AUDIO_MIME_FILENAME_EXTENSIONS[normalized_mime_type]:
        raise AudioExtensionMismatchError()


def validate_audio_file_size(content_length: int, max_size_mb: int | float) -> None:
    """Reject empty bytes and content above the caller-selected MB limit."""

    if content_length <= 0:
        raise EmptyAudioFileError()

    maximum_size_bytes = int(max_size_mb * 1024 * 1024)
    if maximum_size_bytes <= 0 or content_length > maximum_size_bytes:
        raise AudioFileTooLargeError()


def validate_audio_signature(content: bytes, mime_type: str) -> None:
    """Perform a basic header check without claiming full media validity."""

    normalized_mime_type = normalize_audio_mime_type(mime_type)
    validate_audio_mime_type(normalized_mime_type)

    if normalized_mime_type == "audio/webm":
        is_valid = b"\x1a\x45\xdf\xa3" in content[:16]
    elif normalized_mime_type == "audio/ogg":
        is_valid = content.startswith(b"OggS")
    elif normalized_mime_type in {"audio/wav", "audio/x-wav"}:
        is_valid = content.startswith(b"RIFF") and content[8:12] == b"WAVE"
    elif normalized_mime_type == "audio/mpeg":
        has_frame_sync = (
            len(content) >= 2
            and content[0] == 0xFF
            and content[1] & 0xE0 == 0xE0
        )
        is_valid = content.startswith(b"ID3") or has_frame_sync
    elif normalized_mime_type == "audio/mp4":
        is_valid = b"ftyp" in content[4:32]
    else:
        is_valid = False

    if not is_valid:
        raise InvalidAudioSignatureError()


def validate_audio_upload(
    *,
    filename: str,
    mime_type: str,
    content: bytes,
    max_size_mb: int | float,
) -> ValidatedAudio:
    """Validate upload metadata, size, and basic signature without writing it."""

    original_filename = extract_safe_audio_filename(filename)
    normalized_mime_type = normalize_audio_mime_type(mime_type)
    extension = validate_audio_mime_type(normalized_mime_type)
    validate_audio_filename_extension(original_filename, normalized_mime_type)
    validate_audio_file_size(len(content), max_size_mb)
    validate_audio_signature(content, normalized_mime_type)

    return ValidatedAudio(
        original_filename=original_filename,
        mime_type=normalized_mime_type,
        extension=extension,
        file_size=len(content),
    )
