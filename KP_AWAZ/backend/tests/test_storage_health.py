"""Read-only aggregate persistence-health tests."""

import json
from pathlib import Path

from sqlalchemy.orm import Session

from app.models import Sentence
from app.services.storage_health_service import build_storage_health
from tests.conftest import TEST_DATABASE


def test_storage_health_reports_integrity_phrase_counts_and_audio(
    db_session: Session, test_storage_root: Path
) -> None:
    db_session.add_all(
        [
            Sentence(
                language="Pashto",
                text="دا فعاله جمله ده.",
                normalized_text="temporary",
                source_type="admin",
                is_active=True,
            ),
            Sentence(
                language="Pashto",
                text="دا غیر فعاله جمله ده.",
                normalized_text="temporary-two",
                source_type="admin",
                is_active=False,
            ),
        ]
    )
    db_session.commit()

    report = build_storage_health(
        database=db_session,
        database_path=TEST_DATABASE,
        include_checksums=True,
    )

    assert report["sqlite_integrity"] == "ok"
    assert report["phrases"] == {"total": 2, "active": 1, "inactive": 1}
    assert report["audio"]["stored_files"] == 0
    assert report["read_only"] is True


def test_storage_health_exposes_no_paths_or_phrase_text(db_session: Session) -> None:
    private_phrase = "دا متن باید په راپور کې ښکاره نه شي."
    db_session.add(
        Sentence(
            language="Pashto",
            text=private_phrase,
            normalized_text="temporary",
            source_type="admin",
            is_active=True,
        )
    )
    db_session.commit()

    serialized = json.dumps(
        build_storage_health(database=db_session, database_path=TEST_DATABASE),
        ensure_ascii=False,
    )

    assert private_phrase not in serialized
    assert str(TEST_DATABASE) not in serialized
