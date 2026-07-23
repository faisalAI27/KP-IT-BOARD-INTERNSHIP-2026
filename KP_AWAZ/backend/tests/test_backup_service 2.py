"""Verified backup and non-overwriting restore regression tests."""

import json
from pathlib import Path
import sqlite3

import pytest

from app.services.backup_service import (
    BackupError,
    create_storage_backup,
    restore_storage_backup,
    sha256_file,
    verify_storage_backup,
)


def source_storage(tmp_path: Path) -> tuple[Path, dict[str, Path]]:
    database = tmp_path / "active" / "database" / "kp_awaz.db"
    database.parent.mkdir(parents=True)
    with sqlite3.connect(database) as connection:
        connection.execute("CREATE TABLE phrases (id INTEGER PRIMARY KEY, active INTEGER)")
        connection.execute("INSERT INTO phrases (active) VALUES (1)")
    raw = tmp_path / "active" / "audio" / "raw"
    legacy = tmp_path / "active" / "audio" / "legacy"
    (raw / "2026" / "07").mkdir(parents=True)
    legacy.mkdir(parents=True)
    (raw / "2026" / "07" / "one.webm").write_bytes(b"raw-webm")
    (legacy / "older.ogg").write_bytes(b"legacy-ogg")
    return database, {"raw": raw, "legacy": legacy}


def test_backup_is_verified_and_preserves_sources(tmp_path: Path) -> None:
    database, audio_roots = source_storage(tmp_path)
    output = tmp_path / "backups" / "release"
    before_database = sha256_file(database)
    before_audio = {
        path: sha256_file(path)
        for root in audio_roots.values()
        for path in root.rglob("*")
        if path.is_file()
    }

    manifest = create_storage_backup(
        database_path=database, audio_roots=audio_roots, output=output
    )
    verification = verify_storage_backup(output)

    assert manifest["audio"]["files"] == 2
    assert manifest["secrets_included"] is False
    assert verification["database_integrity"] == "ok"
    assert verification["audio_files"] == 2
    assert sha256_file(database) == before_database
    assert all(sha256_file(path) == checksum for path, checksum in before_audio.items())


def test_backup_manifest_contains_no_source_paths_or_secrets(tmp_path: Path) -> None:
    database, audio_roots = source_storage(tmp_path)
    output = tmp_path / "backups" / "release"

    create_storage_backup(database_path=database, audio_roots=audio_roots, output=output)

    manifest = (output / "backup_manifest.json").read_text(encoding="utf-8")
    serialized = (output / "checksums.sha256").read_text(encoding="utf-8")
    assert str(tmp_path) not in manifest + serialized
    assert "ADMIN_API_KEY" not in manifest
    assert ".env" not in manifest
    assert json.loads(manifest)["format"] == "kp-awaz-storage-backup-v1"


def test_backup_refuses_existing_or_active_storage_destinations(tmp_path: Path) -> None:
    database, audio_roots = source_storage(tmp_path)
    existing = tmp_path / "existing"
    existing.mkdir()

    with pytest.raises(BackupError, match="already exists"):
        create_storage_backup(
            database_path=database, audio_roots=audio_roots, output=existing
        )
    with pytest.raises(BackupError, match="outside active storage"):
        create_storage_backup(
            database_path=database,
            audio_roots=audio_roots,
            output=audio_roots["raw"] / "backup",
        )


def test_backup_detects_checksum_tampering(tmp_path: Path) -> None:
    database, audio_roots = source_storage(tmp_path)
    output = tmp_path / "backups" / "release"
    create_storage_backup(database_path=database, audio_roots=audio_roots, output=output)
    (output / "audio" / "raw" / "2026" / "07" / "one.webm").write_bytes(
        b"tampered"
    )

    with pytest.raises(BackupError, match="checksum"):
        verify_storage_backup(output)


def test_restore_requires_confirmation_and_unused_destinations(tmp_path: Path) -> None:
    database, audio_roots = source_storage(tmp_path)
    output = tmp_path / "backups" / "release"
    create_storage_backup(database_path=database, audio_roots=audio_roots, output=output)
    restored_db = tmp_path / "restore" / "database" / "kp_awaz.db"
    restored_raw = tmp_path / "restore" / "audio" / "raw"
    restored_legacy = tmp_path / "restore" / "audio" / "legacy"

    with pytest.raises(BackupError, match="confirmation"):
        restore_storage_backup(
            backup=output,
            database_destination=restored_db,
            raw_audio_destination=restored_raw,
            legacy_audio_destination=restored_legacy,
            confirmed=False,
        )

    report = restore_storage_backup(
        backup=output,
        database_destination=restored_db,
        raw_audio_destination=restored_raw,
        legacy_audio_destination=restored_legacy,
        confirmed=True,
    )

    assert report["restore_status"] == "verified"
    assert restored_db.is_file()
    assert len(list(restored_raw.rglob("*.webm"))) == 1
    assert len(list(restored_legacy.rglob("*.ogg"))) == 1
    with pytest.raises(BackupError, match="must not already exist"):
        restore_storage_backup(
            backup=output,
            database_destination=restored_db,
            raw_audio_destination=restored_raw,
            legacy_audio_destination=restored_legacy,
            confirmed=True,
        )
