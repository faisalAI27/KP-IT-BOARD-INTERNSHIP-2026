"""Protected phrase-management response and update contracts."""

from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict, Field, model_validator


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


class PhraseImportSummaryResponse(BaseModel):
    received: int = Field(ge=0)
    created: int = Field(ge=0)
    duplicates: int = Field(ge=0)
    invalid: int = Field(ge=0)


class AdminPhraseResponse(BaseModel):
    id: str
    text: str
    language: str
    category: str | None
    dialect: str | None
    source: str | None
    difficulty: str | None
    active: bool
    created_at: datetime
    updated_at: datetime
    times_assigned: int = Field(ge=0)
    recordings_submitted: int = Field(ge=0)
    pending_count: int = Field(ge=0)
    approved_count: int = Field(ge=0)
    rejected_count: int = Field(ge=0)

    @model_validator(mode="after")
    def normalize_timestamps(self) -> "AdminPhraseResponse":
        self.created_at = _as_utc(self.created_at)
        self.updated_at = _as_utc(self.updated_at)
        return self


class AdminPhraseListResponse(BaseModel):
    items: list[AdminPhraseResponse]
    total: int = Field(ge=0)
    limit: int = Field(ge=1, le=100)
    offset: int = Field(ge=0)
    order: str


class PhraseUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str | None = Field(default=None, max_length=500)
    language: str | None = Field(default=None, max_length=100)
    category: str | None = Field(default=None, max_length=100)
    dialect: str | None = Field(default=None, max_length=100)
    source: str | None = Field(default=None, max_length=255)
    difficulty: str | None = Field(default=None, max_length=50)
    active: bool | None = None

    @model_validator(mode="after")
    def require_one_update(self) -> "PhraseUpdateRequest":
        if not self.model_fields_set:
            raise ValueError("At least one phrase field must be supplied.")
        return self
