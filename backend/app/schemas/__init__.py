"""
Pydantic schemas for API
"""
from .base import BaseSchema, TimestampedSchema
from .user import (
    UserLoginRequest,
    UserRegisterRequest,
    UserResponse,
    UserDetailResponse,
    UserUpdate,
)
from .product_feature import (
    ProductFeatureCreate,
    ProductFeatureUpdate,
    ProductFeatureResponse,
    ProductFeatureListResponse,
)
from .plan import (
    PlanCreate,
    PlanUpdate,
    PlanResponse,
    PlanListResponse,
)
from .response import (
    ErrorDetail,
    ErrorResponse,
    PaginationMeta,
    SuccessResponse,
)

__all__ = [
    "BaseSchema",
    "TimestampedSchema",
    "UserLoginRequest",
    "UserRegisterRequest",
    "UserResponse",
    "UserDetailResponse",
    "ProductFeatureCreate",
    "ProductFeatureUpdate",
    "ProductFeatureResponse",
    "ProductFeatureListResponse",
    "PlanCreate",
    "PlanUpdate",
    "PlanResponse",
    "PlanListResponse",
    "ErrorDetail",
    "ErrorResponse",
    "PaginationMeta",
    "SuccessResponse",
]
