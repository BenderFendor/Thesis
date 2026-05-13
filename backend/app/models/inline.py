"""Inline."""

from __future__ import annotations


from pydantic import Field

from app.models.base import StrictBaseModel


class InlineDefineRequest(StrictBaseModel):
    """Inline Define Request."""

    term: str = Field(..., description="The highlighted term or phrase")
    context: str | None = Field(None, description="Article topic or short context")


class InlineDefineResponse(StrictBaseModel):
    """Inline Define Response."""

    success: bool
    term: str
    definition: str | None = None
    error: str | None = None
