"""
Base schemas
"""
from pydantic import BaseModel, ConfigDict
from datetime import datetime
from uuid import UUID


class BaseSchema(BaseModel):
    """Base schema with common fields"""

    model_config = ConfigDict(from_attributes=True)


class TimestampedSchema(BaseSchema):
    """Schema with timestamps"""

    created_at: datetime
    updated_at: datetime
