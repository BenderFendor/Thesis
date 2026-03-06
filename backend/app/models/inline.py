from __future__ import annotations

from typing import Optional

from pydantic import Field

from app.models.base import StrictBaseModel


class InlineDefineRequest(StrictBaseModel):
    term: str = Field(..., description="The highlighted term or phrase")
    context: Optional[str] = Field(None, description="Article topic or short context")


class InlineDefineResponse(StrictBaseModel):
    success: bool
    term: str
    definition: Optional[str] = None
    error: Optional[str] = None
