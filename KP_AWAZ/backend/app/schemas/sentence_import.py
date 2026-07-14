"""Response contracts reserved for the future TXT import endpoint."""

from pydantic import BaseModel, ConfigDict, Field


class ImportFileResultResponse(BaseModel):
    """Public import counts for one source file."""

    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    filename: str
    total_lines: int = Field(alias="totalLines")
    imported: int
    duplicates: int
    invalid: int


class SentenceImportResponse(BaseModel):
    """Public aggregate response for a future completed import batch."""

    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    batch_id: str = Field(alias="batchId")
    language: str
    files_received: int = Field(alias="filesReceived")
    total_lines: int = Field(alias="totalLines")
    imported: int
    duplicates: int
    invalid: int
    files: list[ImportFileResultResponse]
