"""Path-safety, layout, collision, and cleanup tests for audio storage."""

from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import pytest

from app.services.audio_storage import (
    AudioStorageError,
    delete_audio_file,
    get_audio_storage_root,
    resolve_audio_storage_path,
    save_audio_file,
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
) -> tuple[str, str]:
    stored_id = contribution_id or new_uuid()
    storage_key = save_audio_file(
        contribution_id=stored_id,
        extension=extension,
        content=content,
        created_at=created_at,
    )
    return stored_id, storage_key


@pytest.mark.parametrize("extension", ["webm", "ogg", "mp3", "m4a"])
def test_supported_file_uses_date_layout_and_extension(extension: str) -> None:
    contribution_id, storage_key = store_audio(extension=extension)

    assert storage_key == f"audio/2026/07/14/{contribution_id}.{extension}"
    assert resolve_audio_storage_path(storage_key).is_file()


def test_returned_storage_key_is_relative_and_hides_temp_root(
    test_storage_root: Path,
) -> None:
    _, storage_key = store_audio()

    assert not Path(storage_key).is_absolute()
    assert str(test_storage_root) not in storage_key


def test_stored_bytes_match_original_content() -> None:
    content = b"\x1a\x45\xdf\xa3exact-audio-bytes"
    _, storage_key = store_audio(content=content)

    assert resolve_audio_storage_path(storage_key).read_bytes() == content


def test_contribution_uuid_is_filename_and_original_name_is_not_used() -> None:
    contribution_id, storage_key = store_audio()

    assert Path(storage_key).name == f"{contribution_id}.webm"
    assert "recording" not in storage_key


def test_date_directories_are_created_automatically(
    test_storage_root: Path,
) -> None:
    store_audio()

    assert (test_storage_root / "audio" / "2026" / "07" / "14").is_dir()


def test_aware_datetime_is_converted_to_utc_date() -> None:
    local_time = datetime(
        2026,
        7,
        15,
        1,
        30,
        tzinfo=timezone(timedelta(hours=5)),
    )
    _, storage_key = store_audio(created_at=local_time)

    assert "/2026/07/14/" in storage_key


def test_naive_datetime_is_treated_as_utc() -> None:
    _, storage_key = store_audio(created_at=datetime(2026, 8, 2, 3, 4))

    assert "/2026/08/02/" in storage_key


@pytest.mark.parametrize("invalid_id", ["not-a-uuid", "../bad-id", "/absolute"])
def test_invalid_contribution_uuid_is_rejected(invalid_id: str) -> None:
    with pytest.raises(AudioStorageError):
        save_audio_file(
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
        save_audio_file(
            contribution_id=new_uuid(),
            extension=unsafe_extension,
            content=b"audio",
            created_at=CREATED_AT,
        )


def test_existing_file_is_not_overwritten() -> None:
    contribution_id = new_uuid()
    _, storage_key = store_audio(
        contribution_id=contribution_id,
        content=b"original",
    )

    with pytest.raises(AudioStorageError):
        store_audio(contribution_id=contribution_id, content=b"replacement")

    assert resolve_audio_storage_path(storage_key).read_bytes() == b"original"


def test_safe_storage_key_resolves_under_audio_root() -> None:
    _, storage_key = store_audio()
    resolved_path = resolve_audio_storage_path(storage_key)

    assert resolved_path.is_relative_to(get_audio_storage_root())
    assert resolved_path.exists()


@pytest.mark.parametrize(
    "unsafe_key",
    [
        "/audio/2026/07/14/file.webm",
        "audio/2026/07/../file.webm",
        r"audio\2026\07\14\file.webm",
    ],
)
def test_unsafe_storage_key_is_rejected(unsafe_key: str) -> None:
    with pytest.raises(AudioStorageError):
        resolve_audio_storage_path(unsafe_key)


def test_deleting_existing_audio_file_succeeds() -> None:
    _, storage_key = store_audio()
    stored_path = resolve_audio_storage_path(storage_key)

    delete_audio_file(storage_key)

    assert not stored_path.exists()


def test_deleting_missing_safe_audio_file_does_not_crash() -> None:
    missing_key = f"audio/2026/07/14/{new_uuid()}.webm"

    delete_audio_file(missing_key)


def test_cleanup_cannot_delete_outside_audio_root(tmp_path: Path) -> None:
    outside_file = tmp_path / f"{new_uuid()}.webm"
    outside_file.write_bytes(b"outside")

    with pytest.raises(AudioStorageError):
        delete_audio_file(str(outside_file))

    assert outside_file.read_bytes() == b"outside"


def test_deleting_one_file_does_not_delete_another() -> None:
    _, first_key = store_audio()
    _, second_key = store_audio()

    delete_audio_file(first_key)

    assert not resolve_audio_storage_path(first_key).exists()
    assert resolve_audio_storage_path(second_key).exists()


def test_two_dates_remain_isolated() -> None:
    _, first_key = store_audio(created_at=datetime(2026, 7, 14, tzinfo=timezone.utc))
    _, second_key = store_audio(created_at=datetime(2026, 7, 15, tzinfo=timezone.utc))

    assert "/2026/07/14/" in first_key
    assert "/2026/07/15/" in second_key
    assert resolve_audio_storage_path(first_key).exists()
    assert resolve_audio_storage_path(second_key).exists()


def test_two_contribution_ids_remain_isolated() -> None:
    first_id, first_key = store_audio(content=b"first")
    second_id, second_key = store_audio(content=b"second")

    assert first_id != second_id
    assert resolve_audio_storage_path(first_key).read_bytes() == b"first"
    assert resolve_audio_storage_path(second_key).read_bytes() == b"second"


def test_date_directory_symlink_escape_is_rejected(
    test_storage_root: Path, tmp_path: Path
) -> None:
    outside_directory = tmp_path / "outside"
    outside_directory.mkdir()
    audio_root = test_storage_root / "audio"
    audio_root.mkdir()
    (audio_root / "2026").symlink_to(outside_directory, target_is_directory=True)

    with pytest.raises(AudioStorageError):
        store_audio()
