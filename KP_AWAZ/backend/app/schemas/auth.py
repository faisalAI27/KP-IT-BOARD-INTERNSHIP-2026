"""Public request and response schemas for Supabase authentication."""

import re

from pydantic import BaseModel, field_validator


EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


class AccountStatusRequest(BaseModel):
    """One normalized email accepted by the server-side account lookup."""

    email: str

    @field_validator("email")
    @classmethod
    def normalize_and_validate_email(cls, value: str) -> str:
        cleaned_email = value.strip().lower() if isinstance(value, str) else ""
        if (
            not cleaned_email
            or len(cleaned_email) > 254
            or EMAIL_PATTERN.fullmatch(cleaned_email) is None
        ):
            raise ValueError("Enter a valid email address.")
        return cleaned_email


class AccountStatusResponse(BaseModel):
    """The only public fact returned by the account-status endpoint."""

    accountExists: bool


class AuthenticatedUserResponse(BaseModel):
    """Minimal verified user fields safe to return to the same caller."""

    id: str
    email: str | None
    provider: str | None
