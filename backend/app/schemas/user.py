"""
User schemas
"""
from pydantic import EmailStr, Field
from uuid import UUID

from .base import BaseSchema, TimestampedSchema


class UserLoginRequest(BaseSchema):
    """User login request"""

    email: EmailStr
    password: str = Field(..., min_length=8)


class UserRegisterRequest(BaseSchema):
    """User registration request"""

    email: EmailStr
    password: str = Field(..., min_length=8)
    first_name: str = Field(..., min_length=1, max_length=255)
    last_name: str = Field(..., min_length=1, max_length=255)


class UserResponse(TimestampedSchema):
    """User response schema"""

    id: UUID
    email: str
    first_name: str | None
    last_name: str | None
    role: str
    timezone: str
    is_active: bool


class UserUpdate(BaseSchema):
    """User update request"""

    first_name: str | None = None
    last_name: str | None = None
    timezone: str | None = None


class UserDetailResponse(UserResponse):
    """Detailed user response"""

    pass
