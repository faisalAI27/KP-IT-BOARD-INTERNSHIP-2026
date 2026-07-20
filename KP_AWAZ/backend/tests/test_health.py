"""Tests for the public health endpoint."""

from fastapi.testclient import TestClient


def test_health_endpoint(client: TestClient) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json()["status"] == "healthy"
    assert response.json()["service"] == "KP AWAZ API"


def test_readiness_reports_only_safe_aggregate_checks(client: TestClient) -> None:
    response = client.get("/api/readiness")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "checks": {
            "database": "ok",
            "databaseStorage": "ok",
            "audioStorage": "ok",
        },
    }
    serialized = response.text.lower()
    assert "path" not in serialized
    assert "secret" not in serialized
    assert "email" not in serialized
