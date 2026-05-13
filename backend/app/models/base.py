"""Base."""

from pydantic import BaseModel, ConfigDict


class StrictBaseModel(BaseModel):
    """Strict Base Model."""

    model_config = ConfigDict(strict=True)
