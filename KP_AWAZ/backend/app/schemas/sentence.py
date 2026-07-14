"""Public sentence response schemas."""

from pydantic import BaseModel, ConfigDict


class SentenceResponse(BaseModel):
    """Fields exposed for one sentence prompt."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    language: str
    text: str
    meaning: str | None


class SentenceListResponse(BaseModel):
    """Envelope used by the frontend sentence service."""

    data: list[SentenceResponse]
