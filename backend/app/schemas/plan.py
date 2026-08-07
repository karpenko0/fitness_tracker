"""
Plan schemas
"""
from pydantic import Field
from uuid import UUID
from decimal import Decimal

from .base import BaseSchema, TimestampedSchema


class PlanCreate(BaseSchema):
    """Create plan request"""

    code: str = Field(..., min_length=1, max_length=255)
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    status: str = Field(default="active")
    price: Decimal = Field(default=0)
    currency: str = Field(default="USD", max_length=3)


class PlanUpdate(BaseSchema):
    """Update plan request"""

    name: str | None = None
    description: str | None = None
    status: str | None = None
    price: Decimal | None = None
    currency: str | None = None


class PlanResponse(TimestampedSchema):
    """Plan response"""

    id: UUID
    code: str
    name: str
    description: str | None
    status: str
    price: Decimal
    currency: str


class PlanListResponse(BaseSchema):
    """List of plans"""

    page: int
    pageSize: int
    total: int
    items: list[PlanResponse]
