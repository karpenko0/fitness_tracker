"""
Plan model
"""
from sqlalchemy import Column, String, Text, Numeric, UUID, Enum
from sqlalchemy.dialects.postgresql import UUID as UUID_PG
import uuid
import enum

from .base import Base, BaseModel


class PlanStatus(str, enum.Enum):
    """Plan statuses"""
    ACTIVE = "active"
    INACTIVE = "inactive"
    ARCHIVED = "archived"


class Plan(Base, BaseModel):
    """Tariff plan model"""

    __tablename__ = "plans"

    id = Column(UUID_PG(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(255), unique=True, nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(50), default=PlanStatus.ACTIVE.value, nullable=False, index=True)
    price = Column(Numeric(10, 2), default=0, nullable=False)
    currency = Column(String(3), default="USD", nullable=False)

    def __repr__(self):
        return f"<Plan(id={self.id}, code={self.code}, status={self.status})>"
