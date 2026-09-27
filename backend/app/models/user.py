"""
User model
"""
from sqlalchemy import Column, String, Boolean, UUID, Enum, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import UUID as UUID_PG
import uuid
import enum
from datetime import datetime, timedelta

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
    # Telegram fields
    telegram_chat_id = Column(String(255), nullable=True, unique=True)  # Telegram chat ID can be used as a unique identifier
    telegram_notifications_enabled = Column(Boolean, default=False, nullable=False)
    # Telegram binding fields
    telegram_bind_token = Column(String(255), nullable=True)  # hashed token for binding
    telegram_bind_token_expires_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    audit_logs = relationship("AuditLog", back_populates="user")

    def __repr__(self):
        return f"<User(id={self.id}, email={self.email}, role={self.role})>"

    def generate_telegram_bind_token(self) -> str:
        """Generate a one-time binding token for Telegram account linking.
        Returns the plain token (to be shown to the user) and stores the hash.
        """
        import secrets
        import hashlib
        
        # Generate a secure random token
        plain_token = secrets.token_urlsafe(32)
        # Hash the token for storage
        hashed_token = hashlib.sha256(plain_token.encode()).hexdigest()
        # Set expiration to 10 minutes from now
        self.telegram_bind_token = hashed_token
        self.telegram_bind_token_expires_at = datetime.now() + timedelta(minutes=10)
        return plain_token