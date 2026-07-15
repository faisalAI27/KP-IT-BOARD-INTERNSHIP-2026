"""Public response schemas for Supabase-authenticated identities."""

from pydantic import BaseModel


class AuthenticatedUserResponse(BaseModel):
    """Minimal verified user fields safe to return to the same caller."""

    id: str
    email: str | None
    provider: str | None
