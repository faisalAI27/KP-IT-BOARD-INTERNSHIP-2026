"""Targeted privacy, eligibility, output, and preservation tests for the CLI exporter."""

from __future__ import annotations

import csv
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from app.cli.export_dataset import build_parser
from app.models import Contribution, Profile, WithdrawalRequest
from app.services.audio_storage import save_audio_file
from app.services.dataset_exporter import (
    DEFAULT_EXPORT_SEED,
    OutputDirectoryNotEmptyError,
    export_approved_dataset,
)
from tests.conftest import TEST_DATABASE, TEST_RAW_AUDIO_STORAGE, TEST_STORAGE


WEBM_BYTES = b"\x1a\x45\xdf\xa3" + b"privacy-safe-webm-audio"
CREATED_AT = datetime(2026, 7, 19, 10, 0, tzinfo=timezone.utc)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def storage_tree(root: Path) -> dict[str, str]:
    if not root.exists():
        return {}
    return {
        path.relative_to(root).as_posix(): sha256(path)
        for path in root.rglob("*")
        if path.is_file()
    }


def add_profile(
    database: Session,
    *,
    user_id: str | None = None,
    email: str | None = None,
    display_name: str = "Private Display Name",
) -> Profile:
    stored_id = user_id or str(uuid4())
    profile = Profile(
        id=stored_id,
        email=email or f"private-{stored_id[:8]}@example.com",
        auth_provider="email",
        display_name=display_name,
    )
    database.add(profile)
    database.commit()
    return profile


def canonical_key(contribution_id: str, extension: str = "webm") -> str:
    return f"raw/2026/07/contribution_{contribution_id.replace('-', '')}.{extension}"


def add_contribution(
    database: Session,
    *,
    profile: Profile | None = None,
    review_status: str = "approved",
    consent: bool = True,
    audio_state: str = "valid",
    mime_type: str = "audio/webm",
    prompt_text: str = "هر غږ ارزښت لري.",
    topic: str | None = None,
    contribution_type: str = "guided",
) -> Contribution:
    contribution_id = str(uuid4())
    if audio_state == "unsafe":
        storage_key = f"audio/../../private/{contribution_id}.webm"
    else:
        storage_key = canonical_key(contribution_id)
        if audio_state == "empty":
            empty_path = TEST_RAW_AUDIO_STORAGE.joinpath(
                *PurePosixPath(storage_key).parts[1:]
            )
            empty_path.parent.mkdir(parents=True, exist_ok=True)
            empty_path.touch()
        elif audio_state != "missing":
            storage_key = save_audio_file(
                contribution_id=contribution_id,
                extension="webm",
                content=WEBM_BYTES,
                created_at=CREATED_AT,
            )
    contribution = Contribution(
        id=contribution_id,
        user_id=profile.id if profile else None,
        contribution_type=contribution_type,
        contributor_name="Must Never Be Exported",
        language="Pashto",
        sentence_text=prompt_text if contribution_type == "guided" else None,
        sentence_source="provided" if contribution_type == "guided" else None,
        topic=topic if contribution_type == "open_recording" else None,
        consent_given=consent,
        consent_policy_version="1.0" if consent else None,
        consent_timestamp=CREATED_AT if consent else None,
        audio_storage_key=storage_key,
        original_filename="private-original-name.webm",
        mime_type=mime_type,
        file_size=max(1, len(WEBM_BYTES)),
        duration_seconds=4.25,
        status="queued",
        review_status=review_status,
        reviewed_at=CREATED_AT if review_status == "approved" else None,
        rejection_reason="Private rejection reason" if review_status == "rejected" else None,
        created_at=CREATED_AT,
        updated_at=CREATED_AT,
    )
    database.add(contribution)
    database.commit()
    return contribution


def request_withdrawal(database: Session, contribution: Contribution) -> None:
    database.add(
        WithdrawalRequest(
            user_id=contribution.user_id,
            contribution_id=contribution.id,
            scope="contribution",
            status="requested",
            requested_at=CREATED_AT,
        )
    )
    database.commit()


def run_export(
    database: Session,
    output: Path,
    **options,
) -> dict[str, object]:
    return export_approved_dataset(
        database=database,
        output=output,
        database_path=TEST_DATABASE,
        audio_root=TEST_STORAGE / "audio",
        include_checksums=True,
        **options,
    )


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as source:
        return list(csv.DictReader(source))


def test_approved_owned_consented_record_is_exported(
    db_session: Session,
    tmp_path: Path,
) -> None:
    profile = add_profile(db_session)
    add_contribution(db_session, profile=profile)
    output = tmp_path / "dataset"

    report = run_export(db_session, output)

    assert report["candidate_count"] == 1
    assert report["eligible_count"] == 1
    assert (output / "audio/sample_000001.webm").read_bytes() == WEBM_BYTES
    assert len(read_csv(output / "metadata.csv")) == 1
    assert len((output / "metadata.jsonl").read_text(encoding="utf-8").splitlines()) == 1
    assert (output / "checksums.sha256").is_file()


@pytest.mark.parametrize(
    ("case", "reason"),
    [
        ("pending", "pending_review"),
        ("rejected", "rejected_review"),
        ("consent_unknown", "consent_unknown"),
        ("withdrawn", "withdrawn"),
        ("legacy_unowned", "legacy_unowned"),
        ("missing", "missing_audio"),
        ("empty", "empty_audio"),
        ("unsafe", "unsafe_audio_path"),
        ("unsupported", "unsupported_format"),
    ],
)
def test_ineligible_candidate_is_excluded_with_exact_reason(
    case: str,
    reason: str,
    db_session: Session,
    tmp_path: Path,
) -> None:
    profile = None if case == "legacy_unowned" else add_profile(db_session)
    contribution = add_contribution(
        db_session,
        profile=profile,
        review_status=(
            "pending" if case == "pending" else "rejected" if case == "rejected" else "approved"
        ),
        consent=case != "consent_unknown",
        audio_state=case if case in {"missing", "empty", "unsafe"} else "valid",
        mime_type="application/octet-stream" if case == "unsupported" else "audio/webm",
    )
    if case == "withdrawn":
        request_withdrawal(db_session, contribution)

    report = run_export(db_session, tmp_path / "dataset")

    assert report["eligible_count"] == 0
    assert report["exclusion_counts"][reason] == 1
    assert list((tmp_path / "dataset/audio").iterdir()) == []


def test_pashto_unicode_is_preserved_without_private_fields(
    db_session: Session,
    tmp_path: Path,
) -> None:
    private_email = "never-export-this@example.com"
    private_name = "Never Export This Name"
    profile = add_profile(
        db_session,
        email=private_email,
        display_name=private_name,
    )
    contribution = add_contribution(
        db_session,
        profile=profile,
        prompt_text="زما غږ زما د کلتور برخه ده.",
    )
    output = tmp_path / "dataset"

    run_export(db_session, output)

    csv_text = (output / "metadata.csv").read_text(encoding="utf-8")
    jsonl_text = (output / "metadata.jsonl").read_text(encoding="utf-8")
    rows = read_csv(output / "metadata.csv")
    exported_bytes = b"".join(
        path.read_bytes() for path in output.rglob("*") if path.is_file()
    )
    assert set(rows[0]) == {
        "sample_id",
        "audio_path",
        "speaker_id",
        "prompt_text",
        "language",
        "contribution_mode",
        "duration_seconds",
        "audio_mime_type",
        "submitted_at",
        "approved_at",
        "consent_policy_version",
        "dataset_split",
    }
    assert "زما غږ زما د کلتور برخه ده." in csv_text
    assert "زما غږ زما د کلتور برخه ده." in jsonl_text
    for forbidden in [
        private_email,
        private_name,
        profile.id,
        contribution.id,
        contribution.audio_storage_key,
        "rejection_reason",
        "access_token",
        TEST_STORAGE.as_posix(),
    ]:
        assert forbidden.encode() not in exported_bytes


def test_recordings_from_one_owner_share_one_export_local_speaker(
    db_session: Session,
    tmp_path: Path,
) -> None:
    first_owner = add_profile(db_session)
    second_owner = add_profile(db_session)
    add_contribution(db_session, profile=first_owner)
    add_contribution(db_session, profile=first_owner, contribution_type="open_recording", topic="کلی")
    add_contribution(db_session, profile=second_owner)
    output = tmp_path / "dataset"

    run_export(db_session, output, seed=17)
    rows = read_csv(output / "metadata.csv")

    speaker_counts: dict[str, int] = {}
    for row in rows:
        speaker_counts[row["speaker_id"]] = speaker_counts.get(row["speaker_id"], 0) + 1
    assert sorted(speaker_counts.values()) == [1, 2]
    assert set(speaker_counts) == {"speaker_0001", "speaker_0002"}


def test_dry_run_creates_no_dataset_directory(
    db_session: Session,
    tmp_path: Path,
) -> None:
    profile = add_profile(db_session)
    add_contribution(db_session, profile=profile)
    output = tmp_path / "dry-run-dataset"

    report = run_export(db_session, output, dry_run=True)

    assert report["dry_run"] is True
    assert report["eligible_count"] == 1
    assert not output.exists()


def test_nonempty_output_is_protected_and_overwrite_is_explicit(
    db_session: Session,
    tmp_path: Path,
) -> None:
    profile = add_profile(db_session)
    add_contribution(db_session, profile=profile)
    output = tmp_path / "dataset"
    output.mkdir()
    marker = output / "keep.txt"
    marker.write_text("keep", encoding="utf-8")

    with pytest.raises(OutputDirectoryNotEmptyError):
        run_export(db_session, output)
    assert marker.read_text(encoding="utf-8") == "keep"

    report = run_export(db_session, output, overwrite=True)
    assert report["eligible_count"] == 1
    assert not marker.exists()
    assert (output / "metadata.csv").is_file()


def test_source_database_and_audio_are_byte_for_byte_unchanged(
    db_session: Session,
    tmp_path: Path,
) -> None:
    profile = add_profile(db_session)
    add_contribution(db_session, profile=profile)
    database_before = sha256(TEST_DATABASE)
    audio_before = storage_tree(TEST_STORAGE / "audio")

    report = run_export(db_session, tmp_path / "dataset")

    assert sha256(TEST_DATABASE) == database_before
    assert storage_tree(TEST_STORAGE / "audio") == audio_before
    assert report["source_preservation"]["database_unchanged"] is True
    assert report["source_preservation"]["audio_tree_unchanged"] is True


def test_fewer_than_three_speakers_creates_only_all_split(
    db_session: Session,
    tmp_path: Path,
) -> None:
    profile = add_profile(db_session)
    add_contribution(db_session, profile=profile)
    output = tmp_path / "dataset"

    report = run_export(db_session, output)

    assert report["split_behavior"]["mode"] == "all"
    assert report["warnings"]
    assert (output / "splits/all.csv").is_file()
    for misleading in ["train.csv", "validation.csv", "test.csv"]:
        assert not (output / "splits" / misleading).exists()


def test_three_speakers_create_speaker_disjoint_splits(
    db_session: Session,
    tmp_path: Path,
) -> None:
    for _ in range(3):
        profile = add_profile(db_session)
        add_contribution(db_session, profile=profile)
    output = tmp_path / "dataset"

    report = run_export(db_session, output, seed=DEFAULT_EXPORT_SEED)

    assert report["split_behavior"]["mode"] == "speaker_disjoint"
    split_speakers = {
        name: {row["speaker_id"] for row in read_csv(output / f"splits/{name}.csv")}
        for name in ["train", "validation", "test"]
    }
    assert all(split_speakers.values())
    assert split_speakers["train"].isdisjoint(split_speakers["validation"])
    assert split_speakers["train"].isdisjoint(split_speakers["test"])
    assert split_speakers["validation"].isdisjoint(split_speakers["test"])


def test_export_report_counts_are_complete_and_consistent(
    db_session: Session,
    tmp_path: Path,
) -> None:
    eligible_profile = add_profile(db_session)
    add_contribution(db_session, profile=eligible_profile)
    add_contribution(db_session, profile=add_profile(db_session), review_status="pending")
    add_contribution(db_session, profile=add_profile(db_session), consent=False)
    missing = add_contribution(
        db_session,
        profile=add_profile(db_session),
        audio_state="missing",
    )
    assert missing.audio_storage_key
    output = tmp_path / "dataset"

    report = run_export(db_session, output)
    stored_report = json.loads((output / "export_report.json").read_text(encoding="utf-8"))

    assert report["candidate_count"] == 4
    assert report["eligible_count"] == 1
    assert report["excluded_count"] == 3
    assert sum(report["exclusion_counts"].values()) == 3
    assert report["exclusion_counts"]["pending_review"] == 1
    assert report["exclusion_counts"]["consent_unknown"] == 1
    assert report["exclusion_counts"]["missing_audio"] == 1
    assert stored_report == report


def test_checksum_manifest_verifies_every_listed_export_file(
    db_session: Session,
    tmp_path: Path,
) -> None:
    profile = add_profile(db_session)
    add_contribution(db_session, profile=profile)
    output = tmp_path / "dataset"
    run_export(db_session, output)

    lines = (output / "checksums.sha256").read_text(encoding="utf-8").splitlines()
    assert lines
    for line in lines:
        expected, relative_path = line.split("  ", maxsplit=1)
        assert sha256(output / relative_path) == expected


def test_sensitive_prompt_metadata_is_excluded(
    db_session: Session,
    tmp_path: Path,
) -> None:
    profile = add_profile(db_session)
    add_contribution(
        db_session,
        profile=profile,
        prompt_text="Contact private-person@example.com for this prompt.",
    )

    report = run_export(db_session, tmp_path / "dataset")

    assert report["eligible_count"] == 0
    assert report["exclusion_counts"]["privacy_sensitive_metadata"] == 1


def test_generated_export_directories_are_gitignored() -> None:
    gitignore = Path(__file__).parents[2] / ".gitignore"
    entries = set(gitignore.read_text(encoding="utf-8").splitlines())

    assert "/exports/" in entries
    assert "/backend/exports/" in entries


def test_cli_parser_supports_required_options_and_default_seed(tmp_path: Path) -> None:
    args = build_parser().parse_args(
        [
            "--output",
            str(tmp_path / "dataset"),
            "--audio-mode",
            "original",
            "--dry-run",
            "--overwrite",
            "--include-checksums",
        ]
    )

    assert args.audio_mode == "original"
    assert args.dry_run is True
    assert args.overwrite is True
    assert args.include_checksums is True
    assert args.seed == 42
