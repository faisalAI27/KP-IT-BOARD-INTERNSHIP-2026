"""Explicit CORS and safe production-error behavior."""

import asyncio
import json
from types import SimpleNamespace

from fastapi import Request
from fastapi.testclient import TestClient
import pytest
from pydantic import ValidationError

from app.config import Settings, settings
from app.main import unexpected_error_handler


def test_cors_preflight_allows_only_configured_headers_and_methods(
    client: TestClient,
) -> None:
    origin = settings.frontend_origins[0]
    response = client.options(
        "/api/admin/health",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "X-Admin-Key, Authorization",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    allowed_headers = response.headers["access-control-allow-headers"].lower()
    assert "x-admin-key" in allowed_headers
    assert "authorization" in allowed_headers
    assert "*" not in response.headers["access-control-allow-methods"]


def test_cors_does_not_approve_unknown_origin(client: TestClient) -> None:
    response = client.options(
        "/api/admin/health",
        headers={
            "Origin": "https://unapproved.example.test",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "X-Admin-Key",
        },
    )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_wildcard_cors_configuration_is_rejected() -> None:
    with pytest.raises(ValidationError, match="explicit HTTP origins"):
        Settings(_env_file=None, environment="development", frontend_origins=["*"])


def test_unexpected_error_response_never_echoes_internal_details() -> None:
    private_detail = "private-token-and-filesystem-detail"
    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/example",
            "headers": [],
            "query_string": b"",
            "route": SimpleNamespace(path="/api/example"),
        }
    )

    response = asyncio.run(
        unexpected_error_handler(request, RuntimeError(private_detail))
    )
    body = json.loads(response.body)

    assert response.status_code == 500
    assert body == {
        "message": "The request could not be completed.",
        "code": "INTERNAL_SERVER_ERROR",
    }
    assert private_detail not in response.body.decode()
