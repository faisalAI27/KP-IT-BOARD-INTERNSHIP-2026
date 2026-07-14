"""Response schemas for protected admin endpoints."""

from pydantic import BaseModel


class AdminHealthResponse(BaseModel):
    """Result returned when admin authentication succeeds."""

    status: str
    scope: str
