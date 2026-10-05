"""Admin panel models (SPEC-011): sessions, MFA challenges, audit log, exports, analytics aggregates."""
import enum
import hashlib
import uuid
from datetime import datetime, timedelta

from sqlalchemy import Boolean, Column, DateTime, Enum, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID as UUID_PG, JSONB
from sqlalchemy import JSON
from sqlalchemy.types import JSON as _JSON

from ..models.base import Base, BaseModel

# JSONB on PostgreSQL, plain JSON elsewhere (SQLite in tests)
JsonB = _JSON().with_variant(JSONB(), "postgresql")


class AdminSessionStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    IDLE = "IDLE"
    REVOKED = "REVOKED"
    EXPIRED = "EXPIRED"


class AuditResult(str, enum.Enum):
    SUCCESS = "SUCCESS"
    DENIED = "DENIED"
    FAILED = "FAILED"


class AdminSession(Base, BaseModel):
    """Separate authenticated session of an admin-panel employee (SPEC-011 6.1)."""

    __tablename__ = "admin_sessions"

    id = Column(UUID_PG(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID_PG(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    role = Column(String(50), nullable=False)
    status = Column(Enum(AdminSessionStatus), default=AdminSessionStatus.ACTIVE, nullable=False, index=True)
    last_activity_at = Column(DateTime(timezone=True), nullable=True)
    ip_hash = Column(String(128), nullable=True)
    user_agent_hash = Column(String(128), nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    version = Column(Integer, default=1, nullable=False)

    __table_args__ = (
        Index("ix_admin_sessions_user_id_status", "user_id", "status"),
    )


class AdminMfaChallenge(Base, BaseModel):
    """MFA-ready challenge: created at login, verified before the admin token is issued."""

    __tablename__ = "admin_mfa_challenges"

    id = Column(UUID_PG(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID_PG(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    method = Column(String(32), default="app_push_stub", nullable=False)
    code_hash = Column(String(64), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    attempts = Column(Integer, default=0, nullable=False)
    verified_at = Column(DateTime(timezone=True), nullable=True)
    consumed = Column(Boolean, default=False, nullable=False)

    def is_expired(self, now: datetime | None = None) -> bool:
        now = now or datetime.utcnow()
        return now > self.expires_at.replace(tzinfo=None) if self.expires_at.tzinfo is None else now > self.expires_at


class AdminAuditLog(Base, BaseModel):
    """Append-only audit journal (SPEC-011 8.2). Never updated by regular admins."""

    __tablename__ = "admin_audit_logs"

    id = Column(UUID_PG(as_uuid=True), primary_key=True, default=uuid.uuid4)
    actor_user_id = Column(UUID_PG(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    actor_role = Column(String(32), nullable=False)
    action = Column(String(80), nullable=False)
    resource_type = Column(String(64), nullable=False)
    resource_id = Column(UUID_PG(as_uuid=True), nullable=True, index=True)
    result = Column(Enum(AuditResult), default=AuditResult.SUCCESS, nullable=False)
    reason = Column(Text, nullable=True)
    request_id = Column(String(100), nullable=False)
    ip_hash = Column(String(128), nullable=True)
    before_summary = Column(JsonB, nullable=True)
    after_summary = Column(JsonB, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False, index=True)

    __table_args__ = (
        Index("ix_admin_audit_actor_created", "actor_user_id", "created_at"),
        Index("ix_admin_audit_resource_created", "resource_type", "resource_id", "created_at"),
        Index("ix_admin_audit_action_created", "action", "created_at"),
    )


class ExportStatus(str, enum.Enum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    READY = "READY"
    FAILED = "FAILED"


class AdminExport(Base, BaseModel):
    """Async CSV export job: TTL link, one-time download (SPEC-011 9.7)."""

    __tablename__ = "admin_exports"

    id = Column(UUID_PG(as_uuid=True), primary_key=True, default=uuid.uuid4)
    requested_by = Column(UUID_PG(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    entity_type = Column(String(64), nullable=False)
    filters = Column(JsonB, nullable=True)
    status = Column(Enum(ExportStatus), default=ExportStatus.PENDING, nullable=False, index=True)
    file_path = Column(String(512), nullable=True)
    rows_count = Column(Integer, default=0, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    downloaded_at = Column(DateTime(timezone=True), nullable=True)
    error = Column(Text, nullable=True)


class AnalyticsDailyAggregate(Base, BaseModel):
    """Pre-aggregated daily product metrics (SPEC-011 6.11)."""

    __tablename__ = "analytics_daily_aggregates"

    day = Column(DateTime(timezone=True), primary_key=True)
    active_users = Column(Integer, default=0, nullable=False)
    new_registrations = Column(Integer, default=0, nullable=False)
    workouts_completed = Column(Integer, default=0, nullable=False)
    active_subscriptions = Column(Integer, default=0, nullable=False)
    mrr = Column(String(32), default="0", nullable=False)
    revenue = Column(String(32), default="0", nullable=False)
    payments_ok = Column(Integer, default=0, nullable=False)
    payments_failed = Column(Integer, default=0, nullable=False)
    content_published = Column(Integer, default=0, nullable=False)
    notifications_sent = Column(Integer, default=0, nullable=False)
    notifications_failed = Column(Integer, default=0, nullable=False)
    challenges_active = Column(Integer, default=0, nullable=False)
    api_errors_client = Column(Integer, default=0, nullable=False)
    api_errors_admin = Column(Integer, default=0, nullable=False)


def hash_secret(value: str | None, salt: str) -> str | None:
    """Deterministic salted hash for IP / user-agent (never store raw values)."""
    if not value:
        return None
    return hashlib.sha256(f"{salt}:{value}".encode("utf-8")).hexdigest()[:64]
