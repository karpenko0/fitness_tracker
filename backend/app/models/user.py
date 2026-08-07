"""
User model
"""
from sqlalchemy import Column, String, Boolean, UUID, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import UUID as UUID_PG
import uuid
import enum

from .base import Base, BaseModel


class UserRole(str, enum.Enum):
    """User roles"""
    USER = "user"
    CONTENT_MANAGER = "content_manager"
    ADMIN = "admin"


class User(Base, BaseModel):
    """User model"""

    __tablename__ = "users"

    id = Column(UUID_PG(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    first_name = Column(String(255), nullable=True)
    last_name = Column(String(255), nullable=True)
    role = Column(String(50), default=UserRole.USER.value, nullable=False, index=True)
    timezone = Column(String(50), default="UTC", nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)

    # Relationships
    audit_logs = relationship("AuditLog", back_populates="user")

    def __repr__(self):
        return f"<User(id={self.id}, email={self.email}, role={self.role})>"
