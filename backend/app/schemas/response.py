"""
Common response schemas
"""
from pydantic import BaseModel, Field
from typing import Generic, TypeVar, Optional


T = TypeVar("T")


class ErrorDetail(BaseModel):
    """Error response detail"""

    code: str
    message: str
    traceId: str = Field(...)


class ErrorResponse(BaseModel):
    """Error response"""

    error: ErrorDetail


class PaginationMeta(BaseModel):
    """Pagination metadata"""

    page: int
    pageSize: int
    total: int


class SuccessResponse(BaseModel, Generic[T]):
    """Success response wrapper"""

    status: str = "success"
    data: T
