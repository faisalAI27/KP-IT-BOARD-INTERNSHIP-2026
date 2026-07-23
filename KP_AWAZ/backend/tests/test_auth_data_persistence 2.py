"""Regression coverage for durable user data across auth-session changes."""

from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import Profile
from tests.conftest import (
    TEST_AUTHORIZATION,
    TEST_USER_ID,
    authenticate_test_user,
)
from tests.points_ledger_helpers import add_point_entry, add_points_contribution


OTHER_USER_ID = "d699f75f-2707-45f1-84ef-2d4730be3358"


def test_same_verified_identity_restores_profile_contribution_audio_and_points(
    client: TestClient,
    db_session: Session,
    test_storage_root: Path,
) -> None:
    """A session ending must not mutate durable application data."""

    authenticate_test_user(email="person@example.com", provider="google")
    assert client.get(
        "/api/profile/me", headers=TEST_AUTHORIZATION
    ).status_code == 200
    saved_profile = client.patch(
        "/api/profile/me",
        headers=TEST_AUTHORIZATION,
        json={
            "displayName": "Persistent Voice",
            "preferredLanguage": "Hindko",
            "leaderboardOptIn": True,
        },
    ).json()

    storage_key = "audio/contributions/persistent-recording.webm"
    audio_path = test_storage_root / storage_key
    audio_path.parent.mkdir(parents=True, exist_ok=True)
    audio_path.write_bytes(b"persistent-audio-bytes")
    contribution = add_points_contribution(
        db_session,
        user_id=TEST_USER_ID,
        review_status="approved",
        review_revision=1,
        audio_storage_key=storage_key,
    )
    add_point_entry(
        db_session,
        user_id=TEST_USER_ID,
        contribution_id=contribution.id,
        review_revision=1,
        entry_type="approval_award",
        points_delta=1,
    )

    # Browser sign-out has no backend deletion call. Re-authenticate the same
    # verified Supabase identity through the other supported provider.
    authenticate_test_user(email="person@example.com", provider="email")

    restored_profile = client.get(
        "/api/profile/me", headers=TEST_AUTHORIZATION
    ).json()
    contributions = client.get(
        "/api/contributions/me", headers=TEST_AUTHORIZATION
    ).json()
    points = client.get(
        "/api/profile/me/points", headers=TEST_AUTHORIZATION
    ).json()
    statistics = client.get(
        "/api/profile/me/statistics", headers=TEST_AUTHORIZATION
    ).json()

    assert restored_profile["id"] == saved_profile["id"] == TEST_USER_ID
    assert restored_profile["displayName"] == "Persistent Voice"
    assert restored_profile["preferredLanguage"] == "Hindko"
    assert restored_profile["leaderboardOptIn"] is True
    assert restored_profile["authProvider"] == "email"
    assert contributions["total"] == 1
    assert contributions["items"][0]["id"] == contribution.id
    assert points["balance"] == 1
    assert points["total"] == 1
    assert statistics["approvedContributions"] == 1
    assert audio_path.read_bytes() == b"persistent-audio-bytes"


def test_different_verified_identity_remains_a_separate_account(
    client: TestClient,
    db_session: Session,
) -> None:
    authenticate_test_user(email="shared@example.com", provider="google")
    first = client.get("/api/profile/me", headers=TEST_AUTHORIZATION).json()
    client.patch(
        "/api/profile/me",
        headers=TEST_AUTHORIZATION,
        json={"displayName": "First Account"},
    )

    authenticate_test_user(
        OTHER_USER_ID,
        email="shared@example.com",
        provider="email",
    )
    second = client.get("/api/profile/me", headers=TEST_AUTHORIZATION).json()

    assert first["id"] == TEST_USER_ID
    assert second["id"] == OTHER_USER_ID
    assert second["displayName"] != "First Account"
    assert db_session.get(Profile, TEST_USER_ID).display_name == "First Account"
    assert db_session.get(Profile, OTHER_USER_ID) is not None
    assert client.get(
        "/api/contributions/me", headers=TEST_AUTHORIZATION
    ).json()["total"] == 0
