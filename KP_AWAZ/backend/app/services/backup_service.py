"""Verified backups and explicit non-overwriting restores for Stage A storage."""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
from typing import Mapping
from uuid import uuid4

from app.utils.audio_validation import SUPPORTED_AUDIO_EXTENSIONS


BACKUP_FORMAT_VERSION = "kp-awaz-storage-backup-v1"
CHECKSUM_FILE = "checksums.sha256"
MANIFEST_FILE = "backup_manifest.json"
DATABASE_BACKUP_PATH = Path("database") / "kp_awaz.db"


class BackupError(RuntimeError):
    """A safe operational failure without source paths or private data."""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as error:
        raise BackupError("A storage file could not be read safely.") from error
    return digest.hexdigest()


def sqlite_integrity(path: Path) -> str:
    """Run SQLite integrity checking in read-only mode."""

    try:
        with sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True) as db:
            row = db.execute("PRAGMA integrity_check").fetchone()
    except sqlite3.Error as error:
        raise BackupError("SQLite integrity could not be verified.") from error
    return str(row[0]) if row else "unavailable"


def _safe_audio_files(root: Path) -> list[Path]:
    if not root.exists():
        return []
    if root.is_symlink() or not root.is_dir():
        raise BackupError("An audio storage root is invalid.")
    files: list[Path] = []
    try:
        for candidate in root.rglob("*"):
            if ".staging" in candidate.relative_to(root).parts:
                continue
            if candidate.is_symlink():
                raise BackupError("Symbolic links are not allowed in audio backups.")
            if (
                candidate.is_file()
                and candidate.suffix.lower().removeprefix(".")
                in SUPPORTED_AUDIO_EXTENSIONS
            ):
                files.append(candidate)
    except OSError as error:
        raise BackupError("Audio storage could not be inspected safely.") from error
    return sorted(files)


def _ensure_separate_output(
    output: Path, database_path: Path, audio_roots: Mapping[str, Path]
) -> None:
    resolved_output = output.expanduser().resolve()
    source_directories = [database_path.resolve().parent]
    source_directories.extend(
        root.expanduser().resolve() for root in audio_roots.values()
    )
    if any(
        resolved_output == source or resolved_output.is_relative_to(source)
        for source in source_directories
    ):
        raise BackupError("The backup destination must be outside active storage.")


def _write_sqlite_backup(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    source_uri = f"{source.resolve().as_uri()}?mode=ro"
    try:
        with sqlite3.connect(source_uri, uri=True) as source_db:
            with sqlite3.connect(destination) as destination_db:
                source_db.backup(destination_db)
    except sqlite3.Error as error:
        raise BackupError("The SQLite backup could not be created.") from error


def create_storage_backup(
    *, database_path: Path, audio_roots: Mapping[str, Path], output: Path
) -> dict[str, object]:
    """Create and verify a backup without modifying database or source audio."""

    source_database = database_path.expanduser().resolve()
    destination = output.expanduser().resolve()
    try:
        if destination.exists():
            raise BackupError("The backup destination already exists.")
        if not source_database.is_file() or source_database.stat().st_size <= 0:
            raise BackupError("The configured SQLite database is unavailable.")
    except OSError as error:
        raise BackupError("Configured storage could not be inspected safely.") from error
    if sqlite_integrity(source_database) != "ok":
        raise BackupError("The source SQLite integrity check did not return ok.")
    _ensure_separate_output(destination, source_database, audio_roots)

    source_database_checksum = sha256_file(source_database)
    source_audio: list[tuple[str, Path, Path, str]] = []
    for label, configured_root in sorted(audio_roots.items()):
        if label not in {"raw", "legacy"}:
            raise BackupError("An unsupported audio source label was supplied.")
        root = configured_root.expanduser().resolve()
        for path in _safe_audio_files(root):
            source_audio.append((label, root, path, sha256_file(path)))

    staging = destination.parent / f".{destination.name}.staging-{uuid4().hex}"
    if staging.exists():
        raise BackupError("A backup staging destination already exists.")
    try:
        staging.mkdir(parents=True)
        for label in ("raw", "legacy"):
            (staging / "audio" / label).mkdir(parents=True, exist_ok=True)
        database_copy = staging / DATABASE_BACKUP_PATH
        _write_sqlite_backup(source_database, database_copy)
        if database_copy.stat().st_size <= 0 or sqlite_integrity(database_copy) != "ok":
            raise BackupError("The copied SQLite database failed verification.")

        copied_audio: list[Path] = []
        for label, root, source_file, expected_checksum in source_audio:
            relative_path = source_file.relative_to(root)
            target = staging / "audio" / label / relative_path
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_file, target)
            if sha256_file(target) != expected_checksum:
                raise BackupError("A copied audio file failed checksum verification.")
            copied_audio.append(target)

        checksum_targets = [database_copy, *copied_audio]
        checksum_lines = [
            f"{sha256_file(path)}  {path.relative_to(staging).as_posix()}"
            for path in checksum_targets
        ]
        (staging / CHECKSUM_FILE).write_text(
            "\n".join(checksum_lines) + "\n", encoding="utf-8"
        )
        manifest = {
            "format": BACKUP_FORMAT_VERSION,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "database": {
                "description": "Configured KP AWAZ SQLite database",
                "files": 1,
                "integrity": "ok",
            },
            "audio": {
                "description": "Configured private raw and legacy audio storage",
                "files": len(copied_audio),
                "bytes": sum(path.stat().st_size for path in copied_audio),
            },
            "checksums": len(checksum_lines),
            "secrets_included": False,
        }
        (staging / MANIFEST_FILE).write_text(
            json.dumps(manifest, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

        if sha256_file(source_database) != source_database_checksum:
            raise BackupError("The source database changed during backup; pause writes.")
        for _, _, source_file, expected_checksum in source_audio:
            if sha256_file(source_file) != expected_checksum:
                raise BackupError("Source audio changed during backup; pause uploads.")
        staging.rename(destination)
        return manifest
    except (OSError, BackupError) as error:
        shutil.rmtree(staging, ignore_errors=True)
        if isinstance(error, BackupError):
            raise
        raise BackupError("The storage backup could not be completed safely.") from error


def _checksum_entries(backup_root: Path) -> list[tuple[str, Path]]:
    checksum_path = backup_root / CHECKSUM_FILE
    try:
        lines = checksum_path.read_text(encoding="utf-8").splitlines()
    except OSError as error:
        raise BackupError("Backup checksums are unavailable.") from error
    entries: list[tuple[str, Path]] = []
    for line in lines:
        checksum, separator, relative_name = line.partition("  ")
        relative_path = Path(relative_name)
        if (
            not separator
            or len(checksum) != 64
            or any(character not in "0123456789abcdef" for character in checksum)
            or relative_path.is_absolute()
            or ".." in relative_path.parts
        ):
            raise BackupError("The checksum manifest is invalid.")
        target = (backup_root / relative_path).resolve()
        if not target.is_relative_to(backup_root) or not target.is_file():
            raise BackupError("A checksummed backup file is missing.")
        entries.append((checksum, target))
    if not entries:
        raise BackupError("The checksum manifest is empty.")
    return entries


def verify_storage_backup(backup: Path) -> dict[str, object]:
    """Verify a backup and return aggregate, privacy-safe metadata."""

    backup_root = backup.expanduser().resolve()
    try:
        manifest = json.loads((backup_root / MANIFEST_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise BackupError("The backup manifest is invalid.") from error
    if (
        not isinstance(manifest, dict)
        or manifest.get("format") != BACKUP_FORMAT_VERSION
    ):
        raise BackupError("The backup format is not supported.")
    entries = _checksum_entries(backup_root)
    if any(sha256_file(path) != checksum for checksum, path in entries):
        raise BackupError("Backup checksum verification failed.")
    database_copy = backup_root / DATABASE_BACKUP_PATH
    if sqlite_integrity(database_copy) != "ok":
        raise BackupError("The backup SQLite integrity check did not return ok.")
    audio_files = [
        path for _, path in entries if path.is_relative_to(backup_root / "audio")
    ]
    return {
        "format": BACKUP_FORMAT_VERSION,
        "database_integrity": "ok",
        "audio_files": len(audio_files),
        "checksums_verified": len(entries),
    }


def restore_storage_backup(
    *,
    backup: Path,
    database_destination: Path,
    raw_audio_destination: Path,
    legacy_audio_destination: Path,
    confirmed: bool,
) -> dict[str, object]:
    """Restore only to new destinations after explicit confirmation."""

    if not confirmed:
        raise BackupError("Restore requires explicit confirmation.")
    backup_root = backup.expanduser().resolve()
    destinations = {
        "database": database_destination.expanduser().resolve(),
        "raw": raw_audio_destination.expanduser().resolve(),
        "legacy": legacy_audio_destination.expanduser().resolve(),
    }
    try:
        if any(path.exists() for path in destinations.values()):
            raise BackupError("Restore destinations must not already exist.")
    except OSError as error:
        raise BackupError("Restore destinations could not be inspected safely.") from error
    if any(path.is_relative_to(backup_root) for path in destinations.values()):
        raise BackupError("Restore destinations must be outside the backup.")

    verification = verify_storage_backup(backup_root)
    checksum_entries = _checksum_entries(backup_root)
    created: list[Path] = []
    try:
        database_source = backup_root / DATABASE_BACKUP_PATH
        destinations["database"].parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(database_source, destinations["database"])
        created.append(destinations["database"])
        for label in ("raw", "legacy"):
            destinations[label].mkdir(parents=True)
            created.append(destinations[label])
        audio_root = backup_root / "audio"
        for expected_checksum, source in checksum_entries:
            if not source.is_relative_to(audio_root):
                continue
            relative_audio = source.relative_to(audio_root)
            if len(relative_audio.parts) < 2 or relative_audio.parts[0] not in {
                "raw",
                "legacy",
            }:
                raise BackupError("The backup audio layout is invalid.")
            label = relative_audio.parts[0]
            target = destinations[label] / Path(*relative_audio.parts[1:])
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            if sha256_file(target) != expected_checksum:
                raise BackupError("A restored audio checksum did not match.")
        if sqlite_integrity(destinations["database"]) != "ok":
            raise BackupError("The restored SQLite integrity check did not return ok.")
    except (OSError, BackupError) as error:
        for path in reversed(created):
            if path.is_dir():
                shutil.rmtree(path, ignore_errors=True)
            else:
                path.unlink(missing_ok=True)
        if isinstance(error, BackupError):
            raise
        raise BackupError("The backup could not be restored safely.") from error
    return {
        **verification,
        "restore_status": "verified",
    }
