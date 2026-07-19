"""Path-safety, layout, integrity, and cleanup tests for raw audio storage."""

from datetime import datetime, timedelta, timezone
import hashlib
from pathlib import Path
from uuid import uuid4

import pytest

import app.services.audio_storage as audio_storage_module
from app.services.audio_storage import (
    AudioStorageError,
    RAW_STORAGE_FORMAT_VERSION,
    delete_audio_file,
    get_audio_storage_root,
    get_raw_audio_storage_root,
    resolve_audio_storage_path,
    store_audio_file,
)


CREATED_AT = datetime(2026, 7, 14, 12, 0, tzinfo=timezone.utc)


def new_uuid() -> str:
    return str(uuid4())


def store_audio(
    *,
    contribution_id: str | None = None,
    extension: str = "webm",
    content: bytes = b"audio-bytes",
    created_at: datetime = CREATED_AT,
):
    return store_audio_file(
        contribution_id=contribution_id or new_uuid(),
        extension=extension,
        content=content,
        created_at=created_at,
    )


@pytest.mark.parametrize(
    "extension", ["webm", "ogg", "mp3", "m4a", "wav", "aac", "flac"]
)
def test_supported_file_uses_raw_year_month_layout(extension: str) -> None:
    stored = store_audio(extension=extension)

    assert stored.storage_key.startswith("raw/2026/07/contribution_")
    assert stored.storage_key.endswith(f".{extension}")
    assert stored.generated_filename == Path(stored.storage_key).name
    assert stored.storage_format_version == RAW_STORAGE_FORMAT_VERSION
    assert resolve_audio_storage_path(stored.storage_key).is_file()


def test_returned_storage_key_is_relative_and_hides_storage_root(
    test_storage_root: Path,
) -> None:
    stored = store_audio()

    assert not Path(stored.storage_key).is_absolute()
    assert str(test_storage_root) not in stored.storage_key


def test_stored_bytes_and_checksum_match_original_content() -> None:
    content = b"\x1a\x45\xdf\xa3exact-original-audio-bytes"
    stored = store_audio(content=content)
    stored_path = resolve_audio_storage_path(stored.storage_key)

    assert stored_path.read_bytes() == content
    assert stored.file_size == len(content)
    assert stored.checksum_sha256 == hashlib.sha256(content).hexdigest()


def test_generated_filename_contains_no_identity_or_client_filename() -> None:
    owner_id = new_uuid()
    stored = store_audio(contribution_id=owner_id)

    assert owner_id not in stored.generated_filename
    assert "example.com" not in stored.generated_filename
    assert "recording" not in stored.generated_filename


def test_month_directories_are_created_automatically() -> None:
    store_audio()

    assert (get_raw_audio_storage_root() / "2026" / "07").is_dir()


def test_aware_datetime_is_converted_to_utc_month() -> None:
    local_time = datetime(
        2026,
        8,
        1,
        1,
        30,
        tzinfo=timezone(timedelta(hours=5)),
    )
    stored = store_audio(created_at=local_time)

    assert "/2026/07/" in stored.storage_key


def test_naive_datetime_is_treated_as_utc() -> None:
    stored = store_audio(created_at=datetime(2026, 8, 2, 3, 4))

    assert "/2026/08/" in stored.storage_key


@pytest.mark.parametrize("invalid_id", ["not-a-uuid", "../bad-id", "/absolute"])
def test_invalid_contribution_uuid_is_rejected(invalid_id: str) -> None:
    with pytest.raises(AudioStorageError):
        store_audio_file(
            contribution_id=invalid_id,
            extension="webm",
            content=b"audio",
            created_at=CREATED_AT,
        )


@pytest.mark.parametrize(
    "unsafe_extension",
    ["exe", ".webm", "webm.exe", "../webm", r"..\webm"],
)
def test_unsafe_or_unsupported_extension_is_rejected(
    unsafe_extension: str,
) -> None:
    with pytest.raises(AudioStorageError):
        store_audio_file(
            contribution_id=new_uuid(),
            extension=unsafe_extension,
            content=b"audio",
            created_at=CREATED_AT,
        )


def test_empty_content_is_not_stored() -> None:
    with pytest.raises(AudioStorageError):
        store_audio(content=b"")

    assert list(get_raw_audio_storage_root().rglob("contribution_*")) == []


def test_existing_collision_is_not_overwritten(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        audio_storage_module,
        "_generated_filename",
        lambda _extension: "contribution_11111111111111111111111111111111.webm",
    )
    first = store_audio(content=b"original")

    with pytest.raises(AudioStorageError):
        store_audio(content=b"replacement")

    assert resolve_audio_storage_path(first.storage_key).read_bytes() == b"original"


def test_safe_raw_storage_key_resolves_under_raw_root() -> None:
    stored = store_audio()
    resolved_path = resolve_audio_storage_path(stored.storage_key)

    assert resolved_path.is_relative_to(get_raw_audio_storage_root())
    assert resolved_path.exists()


def test_existing_legacy_storage_key_still_resolves() -> None:
    contribution_id = new_uuid()
    legacy_path = (
        get_audio_storage_root() / "2026" / "07" / "14" / f"{contribution_id}.webm"
    )
    legacy_path.parent.mkdir(parents=True)
    legacy_path.write_bytes(b"legacy-original")
    storage_key = f"audio/2026/07/14/{contribution_id}.webm"

    assert resolve_audio_storage_path(storage_key).read_bytes() == b"legacy-original"


@pytest.mark.parametrize(
    "unsafe_key",
    [
        "/raw/2026/07/contribution_11111111111111111111111111111111.webm",
        "raw/2026/../contribution_11111111111111111111111111111111.webm",
        r"raw\2026\07\contribution_11111111111111111111111111111111.webm",
        "raw/2026/07/private-name.webm",
    ],
)
def test_unsafe_storage_key_is_rejected(unsafe_key: str) -> None:
    with pytest.raises(AudioStorageError):
        resolve_audio_storage_path(unsafe_key)


def test_deleting_existing_audio_file_succeeds() -> None:
    stored = store_audio()
    stored_path = resolve_audio_storage_path(stored.storage_key)

    delete_audio_file(stored.storage_key)

    assert not stored_path.exists()


def test_deleting_missing_safe_audio_file_does_not_crash() -> None:
    missing_key = "raw/2026/07/contribution_11111111111111111111111111111111.webm"

    delete_audio_file(missing_key)


def test_cleanup_cannot_delete_outside_audio_root(tmp_path: Path) -> None:
    outside_file = tmp_path / f"{new_uuid()}.webm"
    outside_file.write_bytes(b"outside")

    with pytest.raises(AudioStorageError):
        delete_audio_file(str(outside_file))

    assert outside_file.read_bytes() == b"outside"


def test_deleting_one_file_does_not_delete_another() -> None:
    first = store_audio(content=b"first")
    second = store_audio(content=b"second")

    delete_audio_file(first.storage_key)

    assert not resolve_audio_storage_path(first.storage_key).exists()
    assert resolve_audio_storage_path(second.storage_key).read_bytes() == b"second"


def test_two_days_in_same_month_use_distinct_generated_files() -> None:
    first = store_audio(created_at=datetime(2026, 7, 14, tzinfo=timezone.utc))
    second = store_audio(created_at=datetime(2026, 7, 15, tzinfo=timezone.utc))

    assert first.storage_key != second.storage_key
    assert "/2026/07/" in first.storage_key
    assert "/2026/07/" in second.storage_key


def test_raw_year_directory_symlink_escape_is_rejected(
    tmp_path: Path,
) -> None:
    outside_directory = tmp_path / "outside"
    outside_directory.mkdir()
    raw_root = get_raw_audio_storage_root()
    raw_root.mkdir(parents=True)
    (raw_root / "2026").symlink_to(outside_directory, target_is_directory=True)

    with pytest.raises(AudioStorageError):
        store_audio()
