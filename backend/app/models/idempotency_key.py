"""Model for idempotency keys (SPEC-011: key reuse with a different body -> 409)"""
from sqlalchemy import Column, String, DateTime, func
from sqlalchemy.dialects.postgresql import UUID as UUID_PG
from datetime import datetime, timedelta
import uuid

from .base import Base


class IdempotencyKey(Base):
    __tablename__ = "idempotency_keys"

    key = Column(String(255), primary_key=True)
    user_id = Column(UUID_PG(as_uuid=True), nullable=True, index=True)
    method = Column(String(10), nullable=False)
    path = Column(String(1024), nullable=False)
    request_hash = Column(String(64), nullable=True)  # sha256 of method+path+body
    response_code = Column(String(10), nullable=True)
    response_body = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=True)

    def __repr__(self):
        return f"<IdempotencyKey(key={self.key}, path={self.path})>"


def key_expiry(created: datetime) -> datetime:
    return created + timedelta(hours=24)
