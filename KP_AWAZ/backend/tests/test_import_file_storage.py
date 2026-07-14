"""Security and isolation tests for import source-file storage."""

from pathlib import Path
from uuid import uuid4

import pytest

from app.services.import_file_storage import (
    ImportFileStorageError,
    create_import_batch_directory,
    delete_import_batch_directory,
    get_import_storage_root,
    save_import_source_file,
)
from app.utils.file_safety import generate_safe_storage_filename


def new_uuid() -> str:
    return str(uuid4())


def test_batch_directory_is_created(test_storage_root: Path) -> None:
    batch_id = new_uuid()

    batch_directory = create_import_batch_directory(batch_id)

    assert batch_directory.is_dir()
    assert batch_directory == (test_storage_root / "imports" / batch_id).resolve()


def test_file_uses_generated_uuid_filename(test_storage_root: Path) -> None:
    batch_id = new_uuid()
    generated_filename = generate_safe_storage_filename("original-name.txt")

    save_import_source_file(
        batch_id=batch_id,
        safe_storage_filename=generated_filename,
        content=b"phrase",
    )

    stored_names = [path.name for path in (test_storage_root / "imports" / batch_id).iterdir()]
    assert stored_names == [generated_filename]
    assert "original-name" not in stored_names[0]


def test_file_bytes_are_preserved_exactly(test_storage_root: Path) -> None:
    batch_id = new_uuid()
    generated_filename = generate_safe_storage_filename("phrases.txt")
    content = "هر غږ ارزښت لري.".encode("utf-8")

    save_import_source_file(
        batch_id=batch_id,
        safe_storage_filename=generated_filename,
        content=content,
    )

    stored_path = test_storage_root / "imports" / batch_id / generated_filename
    assert stored_path.read_bytes() == content


def test_returned_storage_key_is_relative_and_target_stays_inside_root() -> None:
    batch_id = new_uuid()
    generated_filename = generate_safe_storage_filename("phrases.txt")

    storage_key = save_import_source_file(
        batch_id=batch_id,
        safe_storage_filename=generated_filename,
        content=b"phrase",
    )
    target_path = (get_import_storage_root().parent / storage_key).resolve()

    assert not Path(storage_key).is_absolute()
    assert target_path.parent == (get_import_storage_root() / batch_id)


def test_absolute_batch_path_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(ImportFileStorageError):
        create_import_batch_directory(str(tmp_path / new_uuid()))


def test_batch_traversal_is_rejected() -> None:
    with pytest.raises(ImportFileStorageError):
        create_import_batch_directory(f"../{new_uuid()}")


def test_batch_directory_symlink_is_rejected(
    test_storage_root: Path, tmp_path: Path
) -> None:
    batch_id = new_uuid()
    import_root = test_storage_root / "imports"
    outside_directory = tmp_path / "outside"
    import_root.mkdir(parents=True)
    outside_directory.mkdir()
    (import_root / batch_id).symlink_to(outside_directory, target_is_directory=True)

    with pytest.raises(ImportFileStorageError):
        create_import_batch_directory(batch_id)


@pytest.mark.parametrize(
    "unsafe_filename",
    ["../unsafe.txt", "/tmp/unsafe.txt", "not-a-uuid.txt"],
)
def test_unsafe_storage_filename_is_rejected(unsafe_filename: str) -> None:
    with pytest.raises(ImportFileStorageError):
        save_import_source_file(
            batch_id=new_uuid(),
            safe_storage_filename=unsafe_filename,
            content=b"phrase",
        )


def test_existing_file_is_not_overwritten(test_storage_root: Path) -> None:
    batch_id = new_uuid()
    generated_filename = generate_safe_storage_filename("phrases.txt")
    save_import_source_file(
        batch_id=batch_id,
        safe_storage_filename=generated_filename,
        content=b"original",
    )

    with pytest.raises(ImportFileStorageError):
        save_import_source_file(
            batch_id=batch_id,
            safe_storage_filename=generated_filename,
            content=b"replacement",
        )

    stored_path = test_storage_root / "imports" / batch_id / generated_filename
    assert stored_path.read_bytes() == b"original"


def test_cleanup_deletes_only_requested_batch(test_storage_root: Path) -> None:
    first_batch = new_uuid()
    second_batch = new_uuid()
    create_import_batch_directory(first_batch)
    create_import_batch_directory(second_batch)

    delete_import_batch_directory(first_batch)

    assert not (test_storage_root / "imports" / first_batch).exists()
    assert (test_storage_root / "imports" / second_batch).is_dir()


def test_cleanup_of_missing_batch_does_not_crash() -> None:
    delete_import_batch_directory(new_uuid())


def test_cleanup_cannot_remove_outside_directory(tmp_path: Path) -> None:
    outside_directory = tmp_path / new_uuid()
    outside_directory.mkdir()

    with pytest.raises(ImportFileStorageError):
        delete_import_batch_directory(str(outside_directory))

    assert outside_directory.is_dir()


def test_two_files_can_be_stored_in_one_batch(test_storage_root: Path) -> None:
    batch_id = new_uuid()
    filenames = [
        generate_safe_storage_filename("first.txt"),
        generate_safe_storage_filename("second.txt"),
    ]

    for filename in filenames:
        save_import_source_file(
            batch_id=batch_id,
            safe_storage_filename=filename,
            content=filename.encode(),
        )

    stored_names = {
        path.name for path in (test_storage_root / "imports" / batch_id).iterdir()
    }
    assert stored_names == set(filenames)


def test_different_batches_remain_isolated(test_storage_root: Path) -> None:
    first_batch = new_uuid()
    second_batch = new_uuid()
    first_filename = generate_safe_storage_filename("same.txt")
    second_filename = generate_safe_storage_filename("same.txt")

    save_import_source_file(
        batch_id=first_batch,
        safe_storage_filename=first_filename,
        content=b"first",
    )
    save_import_source_file(
        batch_id=second_batch,
        safe_storage_filename=second_filename,
        content=b"second",
    )

    assert (test_storage_root / "imports" / first_batch / first_filename).read_bytes() == b"first"
    assert (test_storage_root / "imports" / second_batch / second_filename).read_bytes() == b"second"
