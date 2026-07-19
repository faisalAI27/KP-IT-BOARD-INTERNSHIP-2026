"""Privacy-safe, read-only storage-health inventory tests."""

from datetime import datetime, timezone
import json
from pathlib import Path
from uuid import uuid4

from sqlalchemy.orm import Session

from app.models import Contribution
from app.services.audio_inventory_service import build_audio_inventory
from app.services.audio_storage import (
    delete_audio_file,
    get_raw_audio_storage_root,
    resolve_audio_storage_path,
    store_audio_file,
)


PRIVATE_EMAIL = "private-contributor@example.test"
PRIVATE_USER_ID = "0d5dd8f5-93df-462b-b234-a16973089092"


def add_audio_record(
    database: Session,
    *,
    content: bytes = b"\x1a\x45\xdf\xa3inventory-webm",
) -> Contribution:
    contribution_id = str(uuid4())
    created_at = datetime(2026, 7, 19, 12, 0, tzinfo=timezone.utc)
    stored = store_audio_file(
        contribution_id=contribution_id,
        extension="webm",
        content=content,
        created_at=created_at,
    )
    contribution = Contribution(
        id=contribution_id,
        contribution_type="open_recording",
        contributor_name=PRIVATE_EMAIL,
        language="Pashto",
        user_id=None,
        audio_storage_key=stored.storage_key,
        original_filename="private-recording.webm",
        mime_type="audio/webm",
        original_mime_type="audio/webm;codecs=opus",
        audio_extension="webm",
        audio_checksum_sha256=stored.checksum_sha256,
        server_generated_filename=stored.generated_filename,
        storage_format_version=stored.storage_format_version,
        file_size=stored.file_size,
        duration_seconds=None,
        status="queued",
        review_status="pending",
        created_at=created_at,
        updated_at=created_at,
    )
    database.add(contribution)
    database.commit()
    return contribution


def test_inventory_reports_aggregate_storage_health(db_session: Session) -> None:
    contribution = add_audio_record(db_session)
    raw_root = get_raw_audio_storage_root()
    orphan = raw_root / "2026" / "07" / "unreferenced.flac"
    zero_byte = raw_root / "2026" / "07" / "empty.ogg"
    orphan.parent.mkdir(parents=True, exist_ok=True)
    orphan.write_bytes(b"fLaCorphan")
    zero_byte.touch()

    report = build_audio_inventory(database=db_session)

    assert report.audio_records == 1
    assert report.stored_files == 3
    assert report.total_bytes == contribution.file_size + orphan.stat().st_size
    assert report.formats == {"flac": 1, "ogg": 1, "webm": 1}
    assert report.missing_files == 0
    assert report.orphan_files == 2
    assert report.zero_byte_files == 1
    assert report.checksummed_files == 0


def test_inventory_reports_missing_referenced_audio(db_session: Session) -> None:
    contribution = add_audio_record(db_session)
    delete_audio_file(contribution.audio_storage_key)

    report = build_audio_inventory(database=db_session)

    assert report.audio_records == 1
    assert report.stored_files == 0
    assert report.missing_files == 1


def test_inventory_optional_checksums_are_streamed_without_being_output(
    db_session: Session,
) -> None:
    add_audio_record(db_session)

    report = build_audio_inventory(database=db_session, include_checksums=True)
    serialized = json.dumps(report.as_dict(), sort_keys=True)

    assert report.checksummed_files == 1
    assert "sha256" not in serialized.lower()
    assert len(serialized) < 500


def test_inventory_exposes_no_identity_or_storage_paths(db_session: Session) -> None:
    contribution = add_audio_record(db_session)

    serialized = json.dumps(build_audio_inventory(database=db_session).as_dict())

    assert PRIVATE_EMAIL not in serialized
    assert PRIVATE_USER_ID not in serialized
    assert contribution.id not in serialized
    assert contribution.audio_storage_key not in serialized
    assert str(get_raw_audio_storage_root()) not in serialized


def test_inventory_is_read_only_for_database_and_audio(db_session: Session) -> None:
    contribution = add_audio_record(db_session)
    stored_path = resolve_audio_storage_path(contribution.audio_storage_key)
    before_bytes = stored_path.read_bytes()
    before_record = (
        contribution.status,
        contribution.review_status,
        contribution.audio_storage_key,
        contribution.file_size,
    )

    build_audio_inventory(database=db_session, include_checksums=True)
    db_session.refresh(contribution)

    assert stored_path.read_bytes() == before_bytes
    assert (
        contribution.status,
        contribution.review_status,
        contribution.audio_storage_key,
        contribution.file_size,
    ) == before_record
    assert Path(stored_path).is_file()
