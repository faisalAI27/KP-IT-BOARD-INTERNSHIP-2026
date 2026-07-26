"""Public sentence response schemas."""

from pydantic import BaseModel, ConfigDict, Field


class SentenceResponse(BaseModel):
    """Fields exposed for one sentence prompt."""

    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True,
        serialize_by_alias=True,
    )

    id: str
    language: str
    text: str
    roman_text: str | None = Field(alias="romanText")
    meaning: str | None


class SentenceListResponse(BaseModel):
    """Envelope used by the frontend sentence service."""

    data: list[SentenceResponse]
