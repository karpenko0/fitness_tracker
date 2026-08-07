"""Model for idempotency keys"""
from sqlalchemy import Column, String, DateTime, func
from sqlalchemy.dialects.postgresql import UUID as UUID_PG
import uuid

from .base import Base


class IdempotencyKey(Base):
    __tablename__ = "idempotency_keys"

    key = Column(String(255), primary_key=True)
    user_id = Column(UUID_PG(as_uuid=True), nullable=True, index=True)
    method = Column(String(10), nullable=False)
    path = Column(String(1024), nullable=False)
    response_code = Column(String(10), nullable=True)
    response_body = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    def __repr__(self):
        return f"<IdempotencyKey(key={self.key}, path={self.path})>"
