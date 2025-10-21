from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class InlineDefineRequest(BaseModel):
    term: str = Field(..., description="The highlighted term or phrase")
    context: Optional[str] = Field(None, description="Article topic or short context")


class InlineDefineResponse(BaseModel):
    success: bool
    term: str
    definition: Optional[str] = None
    error: Optional[str] = None
