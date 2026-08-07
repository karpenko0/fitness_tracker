"""
Product Feature model
"""
from sqlalchemy import Column, String, Text, Boolean, UUID, Enum
from sqlalchemy.dialects.postgresql import UUID as UUID_PG
import uuid
import enum

from .base import Base, BaseModel


class ReleaseStage(str, enum.Enum):
    """Release stages for features"""
    ALPHA = "alpha"
    BETA = "beta"
    PRODUCTION = "production"


class ProductFeature(Base, BaseModel):
    """Product feature model"""

    __tablename__ = "product_features"

    id = Column(UUID_PG(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(255), unique=True, nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    release_stage = Column(String(50), nullable=False, default=ReleaseStage.ALPHA.value)
    enabled = Column(Boolean, default=False, nullable=False, index=True)

    def __repr__(self):
        return f"<ProductFeature(id={self.id}, code={self.code}, enabled={self.enabled})>"
