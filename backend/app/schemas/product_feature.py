"""
Product Feature schemas
"""
from pydantic import Field
from uuid import UUID

from .base import BaseSchema, TimestampedSchema


class ProductFeatureCreate(BaseSchema):
    """Create product feature request"""

    code: str = Field(..., min_length=1, max_length=255)
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    release_stage: str = Field(default="alpha")
    enabled: bool = False


class ProductFeatureUpdate(BaseSchema):
    """Update product feature request"""

    name: str | None = None
    description: str | None = None
    release_stage: str | None = None
    enabled: bool | None = None


class ProductFeatureResponse(TimestampedSchema):
    """Product feature response"""

    id: UUID
    code: str
    name: str
    description: str | None
    release_stage: str
    enabled: bool


class ProductFeatureListResponse(BaseSchema):
    """List of product features"""

    page: int
    pageSize: int
    total: int
    items: list[ProductFeatureResponse]
