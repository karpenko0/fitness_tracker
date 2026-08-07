"""
Audit Log model
"""
from sqlalchemy import Column, String, Text, UUID, ForeignKey, DateTime, func, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import UUID as UUID_PG
import uuid

from .base import Base


class AuditLog(Base):
    """Audit log model for tracking administrative actions"""

    __tablename__ = "audit_logs"

    id = Column(UUID_PG(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID_PG(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    action = Column(String(255), nullable=False)
    entity_type = Column(String(255), nullable=True)
    entity_id = Column(UUID_PG(as_uuid=True), nullable=True, index=True)
    changes = Column(JSON, nullable=True)
    status = Column(String(50), nullable=True)  # success, failure
    trace_id = Column(String(255), nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        default=func.now(),
        nullable=False,
        index=True
    )

    # Relationships
    user = relationship("User", back_populates="audit_logs")

    def __repr__(self):
        return f"<AuditLog(id={self.id}, action={self.action}, user_id={self.user_id})>"
