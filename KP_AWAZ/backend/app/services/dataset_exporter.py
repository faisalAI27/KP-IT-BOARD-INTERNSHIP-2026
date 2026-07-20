"""Read-only preparation of privacy-safe approved voice datasets."""

from __future__ import annotations

import csv
import hashlib
import json
import math
import random
import re
import shutil
import tempfile
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Contribution, Profile, WithdrawalRequest
from app.services.audio_storage import (
    AudioStorageError,
    get_raw_audio_storage_root,
    resolve_audio_storage_path,
)
from app.services.dataset_export_service import (
    export_eligible_contributions_statement,
)
from app.services.withdrawal_service import EXPORT_EXCLUSION_STATUSES
from app.utils.audio_validation import (
    AUDIO_MIME_FILENAME_EXTENSIONS,
    AudioValidationError,
    normalize_audio_mime_type,
    validate_audio_signature,
)


DEFAULT_EXPORT_SEED = 42
METADATA_FIELDS = (
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
)
EXCLUSION_REASONS = (
    "pending_review",
    "rejected_review",
    "legacy_unowned",
    "consent_unknown",
    "withdrawn",
    "invalid_metadata",
    "privacy_sensitive_metadata",
    "unsafe_audio_path",
    "unsupported_format",
    "missing_audio",
    "empty_audio",
)
EMAIL_PATTERN = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)
UUID_PATTERN = re.compile(
    r"\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b",
    re.I,
)
SECRET_FIELD_PATTERN = re.compile(
    r"\b(?:access_token|refresh_token|admin_api_key|supabase_secret_key)\b",
    re.I,
)
ABSOLUTE_PATH_PATTERN = re.compile(
    r"(?:^|[\s\"'])(?:/(?:Users|home|private|tmp|var|etc)/|[A-Z]:\\)",
    re.I,
)


class DatasetExporterError(RuntimeError):
    """Safe CLI-facing exporter failure."""


class InvalidExportOptionError(DatasetExporterError):
    pass


class UnsafeExportOutputError(DatasetExporterError):
    pass


class OutputDirectoryNotEmptyError(DatasetExporterError):
    pass


class DatasetExportReadError(DatasetExporterError):
    pass


class DatasetExportWriteError(DatasetExporterError):
    pass


class SourcePreservationError(DatasetExporterError):
    pass


class DatasetPrivacyError(DatasetExporterError):
    pass


@dataclass(frozen=True, slots=True)
class PreparedSample:
    internal_id: str
    owner_id: str
    source_path: Path
    source_sha256: str
    extension: str
    prompt_text: str
    language: str
    contribution_mode: str
    duration_seconds: float | None
    audio_mime_type: str
    submitted_at: datetime
    approved_at: datetime
    consent_policy_version: str


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as error:
        raise DatasetExportReadError("A source file could not be read safely.") from error
    return digest.hexdigest()


def _tree_fingerprint(root: Path) -> tuple[tuple[str, str], ...]:
    if not root.exists():
        return ()
    entries: list[tuple[str, str]] = []
    try:
        paths = sorted(root.rglob("*"), key=lambda item: item.as_posix())
    except OSError as error:
        raise DatasetExportReadError("The configured audio storage could not be read.") from error
    for path in paths:
        relative = path.relative_to(root).as_posix()
        if path.is_symlink():
            entries.append((relative, "symlink"))
        elif path.is_file():
            entries.append((relative, _sha256_file(path)))
    return tuple(entries)


def _is_relative_to(candidate: Path, parent: Path) -> bool:
    try:
        candidate.relative_to(parent)
        return True
    except ValueError:
        return False


def _validate_output_path(
    *,
    output: Path,
    audio_roots: tuple[Path, ...],
    database_path: Path | None,
    dry_run: bool,
    overwrite: bool,
) -> Path:
    if output.exists() and output.is_symlink():
        raise UnsafeExportOutputError("The export output cannot be a symbolic link.")
    resolved = output.expanduser().resolve(strict=False)
    protected_paths = list(audio_roots)
    if database_path is not None:
        protected_paths.append(database_path.resolve())
    for protected in protected_paths:
        if (
            resolved == protected
            or _is_relative_to(resolved, protected)
            or _is_relative_to(protected, resolved)
        ):
            raise UnsafeExportOutputError(
                "The export output overlaps configured source data."
            )
    if dry_run or not resolved.exists():
        return resolved
    if not resolved.is_dir():
        raise UnsafeExportOutputError("The export output must be a directory.")
    try:
        nonempty = any(resolved.iterdir())
    except OSError as error:
        raise UnsafeExportOutputError("The export output could not be inspected.") from error
    if nonempty and not overwrite:
        raise OutputDirectoryNotEmptyError(
            "The export output is not empty. Use --overwrite to replace it."
        )
    return resolved


def _safe_audio_path(
    *,
    storage_key: str,
) -> Path:
    try:
        return resolve_audio_storage_path(storage_key)
    except AudioStorageError as error:
        raise ValueError("unsafe storage key") from error


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _utc_iso(value: datetime) -> str:
    return _as_utc(value).isoformat().replace("+00:00", "Z")


def _withdrawal_applies(
    request: WithdrawalRequest,
    contribution: Contribution,
) -> bool:
    if request.user_id != contribution.user_id:
        return False
    if request.scope == "contribution":
        return request.contribution_id == contribution.id
    return request.scope == "all" and request.requested_at >= contribution.created_at


def _contains_sensitive_text(value: str) -> bool:
    return bool(
        EMAIL_PATTERN.search(value)
        or UUID_PATTERN.search(value)
        or SECRET_FIELD_PATTERN.search(value)
        or ABSOLUTE_PATH_PATTERN.search(value)
    )


def _metadata_values(
    contribution: Contribution,
) -> tuple[str, str, str, float | None, datetime, datetime, str] | None:
    mode = contribution.contribution_type
    language = contribution.language.strip() if isinstance(contribution.language, str) else ""
    if mode == "guided":
        prompt = (
            contribution.sentence_text
            if isinstance(contribution.sentence_text, str)
            else ""
        )
        if not prompt.strip():
            return None
    elif mode == "open_recording":
        prompt = contribution.topic if isinstance(contribution.topic, str) else ""
    else:
        return None
    duration = contribution.duration_seconds
    if (
        not language
        or not isinstance(contribution.created_at, datetime)
        or not isinstance(contribution.reviewed_at, datetime)
        or not isinstance(contribution.consent_policy_version, str)
        or not contribution.consent_policy_version.strip()
        or (duration is not None and (not math.isfinite(duration) or duration < 0))
    ):
        return None
    return (
        prompt,
        language,
        mode,
        duration,
        contribution.created_at,
        contribution.reviewed_at,
        contribution.consent_policy_version.strip(),
    )


def _prepare_candidate(
    contribution: Contribution,
    *,
    profile_ids: set[str],
    active_withdrawals: list[WithdrawalRequest],
) -> tuple[PreparedSample | None, str | None]:
    if contribution.review_status == "pending":
        return None, "pending_review"
    if contribution.review_status == "rejected":
        return None, "rejected_review"
    if contribution.review_status != "approved":
        return None, "invalid_metadata"
    if contribution.user_id is None or contribution.user_id not in profile_ids:
        return None, "legacy_unowned"
    if not contribution.has_structured_consent:
        return None, "consent_unknown"
    if any(
        _withdrawal_applies(request, contribution)
        for request in active_withdrawals
    ):
        return None, "withdrawn"

    metadata = _metadata_values(contribution)
    if metadata is None:
        return None, "invalid_metadata"
    prompt, language, mode, duration, submitted_at, approved_at, policy_version = metadata
    if _contains_sensitive_text(prompt):
        return None, "privacy_sensitive_metadata"

    try:
        mime_type = normalize_audio_mime_type(contribution.mime_type)
        allowed_extensions = AUDIO_MIME_FILENAME_EXTENSIONS[mime_type]
    except (AudioValidationError, KeyError, TypeError):
        return None, "unsupported_format"

    key_suffix = Path(PurePosixPath(contribution.audio_storage_key).name).suffix
    extension = key_suffix.removeprefix(".").lower()
    if not extension or extension not in allowed_extensions:
        return None, "unsupported_format"
    try:
        source_path = _safe_audio_path(
            storage_key=contribution.audio_storage_key,
        )
    except (TypeError, ValueError):
        return None, "unsafe_audio_path"
    if not source_path.exists():
        return None, "missing_audio"
    if source_path.is_symlink() or not source_path.is_file():
        return None, "unsafe_audio_path"
    try:
        size = source_path.stat().st_size
    except OSError:
        return None, "missing_audio"
    if size <= 0:
        return None, "empty_audio"
    if not isinstance(contribution.file_size, int) or contribution.file_size != size:
        return None, "invalid_metadata"
    try:
        with source_path.open("rb") as source:
            header = source.read(64)
        validate_audio_signature(header, mime_type)
        source_sha256 = _sha256_file(source_path)
    except AudioValidationError:
        return None, "unsupported_format"
    except OSError:
        return None, "missing_audio"

    return (
        PreparedSample(
            internal_id=contribution.id,
            owner_id=contribution.user_id,
            source_path=source_path,
            source_sha256=source_sha256,
            extension=extension,
            prompt_text=prompt,
            language=language,
            contribution_mode=mode,
            duration_seconds=duration,
            audio_mime_type=mime_type,
            submitted_at=submitted_at,
            approved_at=approved_at,
            consent_policy_version=policy_version,
        ),
        None,
    )


def _speaker_and_split_assignments(
    samples: list[PreparedSample],
    seed: int,
) -> tuple[dict[str, str], dict[str, str], dict[str, object], list[str]]:
    owner_ids = sorted({sample.owner_id for sample in samples})
    random.Random(seed).shuffle(owner_ids)
    speaker_by_owner = {
        owner_id: f"speaker_{index:04d}"
        for index, owner_id in enumerate(owner_ids, start=1)
    }
    speaker_ids = sorted(speaker_by_owner.values())
    if len(speaker_ids) < 3:
        split_by_speaker = {speaker_id: "all" for speaker_id in speaker_ids}
        warning = (
            "Fewer than three eligible speakers were available; only splits/all.csv "
            "was created and no train/validation/test claim is made."
        )
        return (
            speaker_by_owner,
            split_by_speaker,
            {"mode": "all", "speaker_counts": {"all": len(speaker_ids)}},
            [warning],
        )

    random.Random(seed + 1).shuffle(speaker_ids)
    validation_count = max(1, int(len(speaker_ids) * 0.10))
    test_count = max(1, int(len(speaker_ids) * 0.10))
    train_count = len(speaker_ids) - validation_count - test_count
    train_speakers = set(speaker_ids[:train_count])
    validation_speakers = set(
        speaker_ids[train_count : train_count + validation_count]
    )
    split_by_speaker = {
        speaker_id: (
            "train"
            if speaker_id in train_speakers
            else "validation"
            if speaker_id in validation_speakers
            else "test"
        )
        for speaker_id in speaker_ids
    }
    return (
        speaker_by_owner,
        split_by_speaker,
        {
            "mode": "speaker_disjoint",
            "speaker_counts": {
                "train": train_count,
                "validation": validation_count,
                "test": test_count,
            },
        },
        [],
    )


def _metadata_rows(
    samples: list[PreparedSample],
    *,
    seed: int,
) -> tuple[list[dict[str, object]], dict[str, object], list[str]]:
    ordered = sorted(
        samples,
        key=lambda sample: (_as_utc(sample.submitted_at), sample.internal_id),
    )
    speaker_by_owner, split_by_speaker, split_report, warnings = (
        _speaker_and_split_assignments(ordered, seed)
    )
    rows: list[dict[str, object]] = []
    for index, sample in enumerate(ordered, start=1):
        sample_id = f"sample_{index:06d}"
        speaker_id = speaker_by_owner[sample.owner_id]
        rows.append(
            {
                "sample_id": sample_id,
                "audio_path": f"audio/{sample_id}.{sample.extension}",
                "speaker_id": speaker_id,
                "prompt_text": sample.prompt_text,
                "language": sample.language,
                "contribution_mode": sample.contribution_mode,
                "duration_seconds": sample.duration_seconds,
                "audio_mime_type": sample.audio_mime_type,
                "submitted_at": _utc_iso(sample.submitted_at),
                "approved_at": _utc_iso(sample.approved_at),
                "consent_policy_version": sample.consent_policy_version,
                "dataset_split": split_by_speaker[speaker_id],
            }
        )
    split_report["sample_counts"] = dict(
        sorted(Counter(str(row["dataset_split"]) for row in rows).items())
    )
    return rows, split_report, warnings


def _write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    try:
        with path.open("w", encoding="utf-8", newline="") as destination:
            writer = csv.DictWriter(destination, fieldnames=METADATA_FIELDS)
            writer.writeheader()
            writer.writerows(rows)
    except OSError as error:
        raise DatasetExportWriteError("Dataset metadata could not be written.") from error


def _write_json(path: Path, value: object) -> None:
    try:
        path.write_text(
            json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    except OSError as error:
        raise DatasetExportWriteError("A dataset manifest could not be written.") from error


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    try:
        with path.open("w", encoding="utf-8", newline="\n") as destination:
            for row in rows:
                destination.write(
                    json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n"
                )
    except OSError as error:
        raise DatasetExportWriteError("Dataset metadata could not be written.") from error


def _write_readme(path: Path, report: dict[str, object]) -> None:
    try:
        path.write_text(_readme(report), encoding="utf-8")
    except OSError as error:
        raise DatasetExportWriteError("The dataset README could not be written.") from error


def _readme(report: dict[str, object]) -> str:
    split_mode = report["split_behavior"]["mode"]
    split_copy = (
        "All eligible samples are listed in `splits/all.csv` because fewer than "
        "three eligible speakers were available."
        if split_mode == "all"
        else "Train, validation, and test CSV files are speaker-disjoint."
    )
    return f"""# KP AWAZ approved dataset export

This internal preparation contains only approved, authenticated, consented voice
contributions that passed storage, format, metadata, and withdrawal checks.

- Samples: {report['eligible_count']}
- Export-local speakers: {report['distinct_speaker_count']}
- Audio mode: original
- Consent policy is recorded per sample.

`prompt_text` is the stored sentence or topic associated with the contribution.
It must not be described as a manually verified transcript unless a separate
verification process has occurred.

{split_copy}

Identifiers in this export are local to this dataset. No email, display name,
account identifier, internal storage path, authentication token, administrator
credential, rejection reason, or reversible contributor mapping is included.
Source records and source audio are not modified by this export.
"""


def _write_checksums(root: Path) -> None:
    lines = []
    for path in sorted(root.rglob("*"), key=lambda item: item.as_posix()):
        if path.is_file() and path.name != "checksums.sha256":
            lines.append(f"{_sha256_file(path)}  {path.relative_to(root).as_posix()}")
    try:
        (root / "checksums.sha256").write_text("\n".join(lines) + "\n", encoding="utf-8")
    except OSError as error:
        raise DatasetExportWriteError("The checksum manifest could not be written.") from error


def _privacy_scan(
    root: Path,
    *,
    sensitive_values: set[str],
) -> None:
    encoded_sensitive = [
        value.encode("utf-8")
        for value in sensitive_values
        if isinstance(value, str) and len(value) >= 8
    ]
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        try:
            content = path.read_bytes()
        except OSError as error:
            raise DatasetPrivacyError("The completed export could not be privacy-scanned.") from error
        if any(secret in content for secret in encoded_sensitive):
            raise DatasetPrivacyError("The completed export failed its privacy scan.")
        if path.suffix.lower() in {".md", ".csv", ".json", ".jsonl", ".sha256"}:
            text = content.decode("utf-8", errors="strict")
            if (
                EMAIL_PATTERN.search(text)
                or UUID_PATTERN.search(text)
                or SECRET_FIELD_PATTERN.search(text)
                or ABSOLUTE_PATH_PATTERN.search(text)
            ):
                raise DatasetPrivacyError("The completed export failed its privacy scan.")


def _publish_staging(staging: Path, output: Path) -> None:
    prior: Path | None = None
    if output.exists():
        prior = output.with_name(f".{output.name}.previous-{uuid4().hex}")
        try:
            output.rename(prior)
        except OSError as error:
            raise DatasetExportWriteError("The existing export could not be replaced safely.") from error
    try:
        staging.rename(output)
    except OSError as error:
        if prior is not None and not output.exists():
            prior.rename(output)
        raise DatasetExportWriteError("The completed dataset could not be published.") from error
    if prior is not None:
        shutil.rmtree(prior, ignore_errors=True)


def export_approved_dataset(
    *,
    database: Session,
    output: Path,
    audio_mode: str = "original",
    dry_run: bool = False,
    overwrite: bool = False,
    include_checksums: bool = False,
    seed: int = DEFAULT_EXPORT_SEED,
    database_path: Path | None = None,
    audio_root: Path | None = None,
    audio_subdirectory: str | None = None,
) -> dict[str, object]:
    """Inspect source data read-only and optionally publish a private export."""

    if audio_mode != "original":
        raise InvalidExportOptionError("Only --audio-mode original is supported.")
    if not isinstance(seed, int):
        raise InvalidExportOptionError("The export seed must be an integer.")
    resolved_audio_root = (
        audio_root.resolve()
        if audio_root is not None
        else (settings.storage_root / settings.audio_storage_subdirectory).resolve()
    )
    _ = audio_subdirectory  # Retained for CLI compatibility with older callers.
    resolved_audio_roots = tuple(
        dict.fromkeys((resolved_audio_root, get_raw_audio_storage_root()))
    )
    resolved_database_path = database_path.resolve() if database_path is not None else None
    resolved_output = _validate_output_path(
        output=output,
        audio_roots=resolved_audio_roots,
        database_path=resolved_database_path,
        dry_run=dry_run,
        overwrite=overwrite,
    )
    database_before = (
        _sha256_file(resolved_database_path)
        if resolved_database_path is not None and resolved_database_path.exists()
        else None
    )
    audio_tree_before = tuple(
        _tree_fingerprint(root) for root in resolved_audio_roots
    )

    try:
        contributions = list(
            database.scalars(
                select(Contribution).order_by(
                    Contribution.created_at.asc(), Contribution.id.asc()
                )
            ).all()
        )
        profiles = list(database.scalars(select(Profile)).all())
        active_withdrawals = list(
            database.scalars(
                select(WithdrawalRequest).where(
                    WithdrawalRequest.status.in_(EXPORT_EXCLUSION_STATUSES)
                )
            ).all()
        )
        canonical_ids = set(
            database.scalars(
                export_eligible_contributions_statement().with_only_columns(
                    Contribution.id
                )
            ).all()
        )
    except SQLAlchemyError as error:
        database.rollback()
        raise DatasetExportReadError("Dataset candidates could not be loaded.") from error

    profile_ids = {profile.id for profile in profiles}
    exclusion_counts: Counter[str] = Counter()
    prepared: list[PreparedSample] = []
    for contribution in contributions:
        sample, exclusion = _prepare_candidate(
            contribution,
            profile_ids=profile_ids,
            active_withdrawals=active_withdrawals,
        )
        if sample is None:
            exclusion_counts[exclusion or "invalid_metadata"] += 1
        else:
            if contribution.id not in canonical_ids:
                raise DatasetExportReadError(
                    "Dataset eligibility rules are internally inconsistent."
                )
            prepared.append(sample)

    sensitive_values = {
        *(root.as_posix() for root in resolved_audio_roots),
        *(contribution.id for contribution in contributions),
        *(contribution.audio_storage_key for contribution in contributions),
        *(profile.id for profile in profiles),
        *(profile.email for profile in profiles if profile.email),
    }
    database.rollback()
    database_after = (
        _sha256_file(resolved_database_path)
        if resolved_database_path is not None and resolved_database_path.exists()
        else None
    )
    database_unchanged = (
        database_before == database_after if database_before is not None else None
    )
    if database_unchanged is False:
        raise SourcePreservationError("The source database changed during export.")

    rows, split_report, warnings = _metadata_rows(prepared, seed=seed)
    report: dict[str, object] = {
        "schema_version": "1.0",
        "generated_at": _utc_iso(datetime.now(timezone.utc)),
        "audio_mode": audio_mode,
        "seed": seed,
        "dry_run": dry_run,
        "candidate_count": len(contributions),
        "eligible_count": len(prepared),
        "excluded_count": len(contributions) - len(prepared),
        "exclusion_counts": {
            reason: exclusion_counts.get(reason, 0) for reason in EXCLUSION_REASONS
        },
        "distinct_speaker_count": len({sample.owner_id for sample in prepared}),
        "audio_file_count": len(prepared),
        "split_behavior": split_report,
        "warnings": warnings,
        "checksums_included": bool(include_checksums and not dry_run),
        "privacy_scan": {"passed": True, "scope": "metadata and export files"},
        "source_preservation": {
            "database_unchanged": database_unchanged,
            "audio_tree_unchanged": True,
            "audio_files_checked": sum(len(tree) for tree in audio_tree_before),
        },
    }

    if dry_run:
        audio_tree_after = tuple(
            _tree_fingerprint(root) for root in resolved_audio_roots
        )
        if audio_tree_before != audio_tree_after:
            raise SourcePreservationError("Source audio changed during export inspection.")
        return report

    try:
        resolved_output.parent.mkdir(parents=True, exist_ok=True)
        staging = Path(
            tempfile.mkdtemp(
                prefix=f".{resolved_output.name}.staging-",
                dir=resolved_output.parent,
            )
        )
    except OSError as error:
        raise DatasetExportWriteError("The export staging directory could not be created.") from error

    try:
        audio_directory = staging / "audio"
        splits_directory = staging / "splits"
        audio_directory.mkdir()
        splits_directory.mkdir()
        sample_by_id = {
            row["sample_id"]: sample for row, sample in zip(rows, sorted(
                prepared,
                key=lambda item: (_as_utc(item.submitted_at), item.internal_id),
            ), strict=True)
        }
        for row in rows:
            sample = sample_by_id[str(row["sample_id"])]
            destination = staging / str(row["audio_path"])
            shutil.copyfile(sample.source_path, destination)
            if _sha256_file(destination) != sample.source_sha256:
                raise DatasetExportWriteError("A copied audio file failed verification.")

        _write_csv(staging / "metadata.csv", rows)
        _write_jsonl(staging / "metadata.jsonl", rows)
        if split_report["mode"] == "all":
            _write_csv(splits_directory / "all.csv", rows)
        else:
            for split_name in ("train", "validation", "test"):
                _write_csv(
                    splits_directory / f"{split_name}.csv",
                    [row for row in rows if row["dataset_split"] == split_name],
                )

        _write_readme(staging / "README.md", report)
        audio_tree_after = tuple(
            _tree_fingerprint(root) for root in resolved_audio_roots
        )
        if audio_tree_before != audio_tree_after:
            raise SourcePreservationError("Source audio changed during export.")
        for sample in prepared:
            if _sha256_file(sample.source_path) != sample.source_sha256:
                raise SourcePreservationError("Source audio changed during export.")
        if database_before is not None:
            database_final = _sha256_file(resolved_database_path)
            if database_before != database_final:
                raise SourcePreservationError(
                    "The source database changed during export."
                )
        _write_json(staging / "export_report.json", report)
        if include_checksums:
            _write_checksums(staging)
        _privacy_scan(staging, sensitive_values=sensitive_values)
        _publish_staging(staging, resolved_output)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    return report
