"""Authentication tests for protected admin routes."""

from fastapi.testclient import TestClient

from app.config import settings


def test_missing_admin_key_is_unauthorized(client: TestClient) -> None:
    response = client.get("/api/admin/health")

    assert response.status_code == 401
    assert response.json() == {"detail": "Admin API key is required."}


def test_incorrect_admin_key_is_forbidden(client: TestClient) -> None:
    response = client.get(
        "/api/admin/health",
        headers={"X-Admin-Key": "wrong-key"},
    )

    assert response.status_code == 403
    assert response.json() == {"detail": "Invalid admin API key."}


def test_correct_admin_key_allows_request(client: TestClient) -> None:
    assert settings.admin_api_key == "test-admin-key"

    response = client.get(
        "/api/admin/health",
        headers={"X-Admin-Key": settings.admin_api_key},
    )

    assert response.status_code == 200
    assert response.json() == {"status": "healthy", "scope": "admin"}


def test_admin_keys_are_not_leaked_in_responses(client: TestClient) -> None:
    incorrect_key = "wrong-key"
    incorrect_response = client.get(
        "/api/admin/health",
        headers={"X-Admin-Key": incorrect_key},
    )
    correct_response = client.get(
        "/api/admin/health",
        headers={"X-Admin-Key": settings.admin_api_key},
    )

    assert settings.admin_api_key not in incorrect_response.text
    assert incorrect_key not in incorrect_response.text
    assert settings.admin_api_key not in correct_response.text
    assert incorrect_key not in correct_response.text


def test_existing_public_routes_do_not_require_admin_key(
    client: TestClient,
) -> None:
    health_response = client.get("/api/health")
    sentences_response = client.get("/api/sentences")

    assert health_response.status_code == 200
    assert sentences_response.status_code == 200


def test_admin_header_is_exposed_in_openapi(client: TestClient) -> None:
    operation = client.get("/openapi.json").json()["paths"]["/api/admin/health"][
        "get"
    ]

    assert any(
        parameter["name"] == "X-Admin-Key" and parameter["in"] == "header"
        for parameter in operation["parameters"]
    )
