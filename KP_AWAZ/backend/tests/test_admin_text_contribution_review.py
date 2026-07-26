"""Protected donated-text list, detail, and review endpoint tests."""

from datetime import datetime, timezone
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import Profile, TextContribution
from tests.admin_contribution_review_helpers import admin_headers


BASE_ENDPOINT = "/api/admin/text-contributions"


def add_text_contribution(
    database: Session,
    *,
    submission_method: str = "manual",
    status: str = "queued",
    content: str = "ستړی مه شې، ښه راغلې.",
) -> TextContribution:
    profile = Profile(
        id=str(uuid4()),
        email="private@example.test",
        auth_provider="google",
        display_name="Text Contributor",
        preferred_language="Pashto",
        leaderboard_opt_in=False,
    )
    contribution = TextContribution(
        user_id=profile.id,
        contributor_name="Text Contributor",
        language="Pashto",
        submission_method=submission_method,
        text_type="file_batch" if submission_method == "file" else "sentence",
        text_content=content,
        original_filename="phrases.txt" if submission_method == "file" else None,
        mime_type="text/plain" if submission_method == "file" else None,
        file_size=len(content.encode("utf-8"))
        if submission_method == "file"
        else None,
        status=status,
        created_at=datetime(2026, 7, 26, tzinfo=timezone.utc),
    )
    database.add_all([profile, contribution])
    database.commit()
    database.refresh(contribution)
    return contribution


def test_text_queue_requires_admin_key(
    client: TestClient,
    db_session: Session,
) -> None:
    add_text_contribution(db_session)

    response = client.get(BASE_ENDPOINT)

    assert response.status_code == 401


def test_pending_text_queue_returns_safe_summary_without_full_content(
    client: TestClient,
    db_session: Session,
) -> None:
    contribution = add_text_contribution(db_session)

    response = client.get(
        BASE_ENDPOINT,
        headers=admin_headers(),
        params={"status": "pending", "limit": 20, "offset": 0},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["status"] == "pending"
    assert body["items"][0]["id"] == contribution.id
    assert body["items"][0]["reviewStatus"] == "pending"
    assert body["items"][0]["textContent"] is None
    assert body["items"][0]["textPreview"] == contribution.text_content
    assert body["items"][0]["ownerDisplayName"] == "Text Contributor"
    assert "userId" not in body["items"][0]
    assert "email" not in body["items"][0]


def test_file_text_summary_preserves_reviewable_file_metadata(
    client: TestClient,
    db_session: Session,
) -> None:
    add_text_contribution(db_session, submission_method="file", content="one\ntwo")

    response = client.get(BASE_ENDPOINT, headers=admin_headers())
    item = response.json()["items"][0]

    assert item["submissionMethod"] == "file"
    assert item["textType"] == "file_batch"
    assert item["originalFilename"] == "phrases.txt"
    assert item["mimeType"] == "text/plain"
    assert item["fileSize"] > 0


def test_text_detail_returns_full_content_only_to_admin(
    client: TestClient,
    db_session: Session,
) -> None:
    contribution = add_text_contribution(db_session, content="line one\nline two")

    response = client.get(
        f"{BASE_ENDPOINT}/{contribution.id}",
        headers=admin_headers(),
    )

    assert response.status_code == 200
    assert response.json()["textContent"] == "line one\nline two"


def test_missing_text_detail_returns_safe_not_found(
    client: TestClient,
) -> None:
    response = client.get(
        f"{BASE_ENDPOINT}/{uuid4()}",
        headers=admin_headers(),
    )

    assert response.status_code == 404
    assert response.json()["code"] == "TEXT_CONTRIBUTION_NOT_FOUND"


def test_queued_text_can_be_approved(
    client: TestClient,
    db_session: Session,
) -> None:
    contribution = add_text_contribution(db_session)

    response = client.patch(
        f"{BASE_ENDPOINT}/{contribution.id}/review",
        headers=admin_headers(),
        json={"status": "approved"},
    )
    db_session.expire_all()
    stored = db_session.get(TextContribution, contribution.id)

    assert response.status_code == 200
    assert response.json()["reviewStatus"] == "approved"
    assert response.json()["reviewedAt"].endswith("Z")
    assert stored is not None
    assert stored.status == "approved"
    assert stored.reviewed_at is not None


def test_text_rejection_requires_a_reason(
    client: TestClient,
    db_session: Session,
) -> None:
    contribution = add_text_contribution(db_session)

    response = client.patch(
        f"{BASE_ENDPOINT}/{contribution.id}/review",
        headers=admin_headers(),
        json={"status": "rejected"},
    )

    assert response.status_code == 400
    assert response.json()["code"] == "TEXT_REJECTION_REASON_REQUIRED"


def test_text_can_be_rejected_and_later_approved(
    client: TestClient,
    db_session: Session,
) -> None:
    contribution = add_text_contribution(db_session)
    reject = client.patch(
        f"{BASE_ENDPOINT}/{contribution.id}/review",
        headers=admin_headers(),
        json={"status": "rejected", "rejectionReason": "  Duplicate text.  "},
    )
    approve = client.patch(
        f"{BASE_ENDPOINT}/{contribution.id}/review",
        headers=admin_headers(),
        json={"status": "approved"},
    )

    assert reject.status_code == 200
    assert reject.json()["rejectionReason"] == "Duplicate text."
    assert approve.status_code == 200
    assert approve.json()["reviewStatus"] == "approved"
    assert approve.json()["rejectionReason"] is None


def test_text_queue_filters_database_status_without_loading_other_rows(
    client: TestClient,
    db_session: Session,
) -> None:
    add_text_contribution(db_session, status="queued")
    add_text_contribution(db_session, status="approved")
    add_text_contribution(db_session, status="rejected")

    approved = client.get(
        BASE_ENDPOINT,
        headers=admin_headers(),
        params={"status": "approved"},
    ).json()
    all_items = client.get(
        BASE_ENDPOINT,
        headers=admin_headers(),
        params={"status": "all"},
    ).json()

    assert approved["total"] == 1
    assert {item["reviewStatus"] for item in approved["items"]} == {"approved"}
    assert all_items["total"] == 3
