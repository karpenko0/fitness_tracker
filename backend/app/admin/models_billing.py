"""Billing domain models (SPEC-011 6.10). Admin panel is read-only over these tables:
statuses change only via provider webhook / reconciliation (billing:manual_status is
granted to no role)."""
import enum
import uuid

from sqlalchemy import Boolean, Column, DateTime, Enum, ForeignKey, Index, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import UUID as UUID_PG

from ..models.base import Base, BaseModel


class SubscriptionStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    TRIALING = "TRIALING"
    PAST_DUE = "PAST_DUE"
    CANCELLED = "CANCELLED"
    EXPIRED = "EXPIRED"
    PAUSED = "PAUSED"


class PaymentStatus(str, enum.Enum):
    CREATED = "CREATED"
    PENDING = "PENDING"
    PAID = "PAID"
    REFUNDED = "REFUNDED"
    FAILED = "FAILED"
    EXPIRED = "EXPIRED"
    CANCELLED = "CANCELLED"


class WebhookEventStatus(str, enum.Enum):
    RECEIVED = "RECEIVED"
    VALIDATED = "VALIDATED"
    PROCESSED = "PROCESSED"
    FAILED = "FAILED"
    DUPLICATE = "DUPLICATE"


class Subscription(Base, BaseModel):
    __tablename__ = "subscriptions"

    id = Column(UUID_PG(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID_PG(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    plan_id = Column(UUID_PG(as_uuid=True), ForeignKey("plans.id"), nullable=True, index=True)
    plan_code = Column(String(255), nullable=True)
    status = Column(Enum(SubscriptionStatus), default=SubscriptionStatus.ACTIVE, nullable=False, index=True)
    provider = Column(String(64), default="telegram_stars", nullable=False)
    provider_transaction_id = Column(String(255), nullable=True, index=True)
    period_start = Column(DateTime(timezone=True), nullable=True)
    period_end = Column(DateTime(timezone=True), nullable=True, index=True)
    cancel_at_period_end = Column(Boolean, default=False, nullable=False)
    version = Column(Integer, default=1, nullable=False)


class Payment(Base, BaseModel):
    __tablename__ = "payments"

    id = Column(UUID_PG(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID_PG(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    subscription_id = Column(UUID_PG(as_uuid=True), ForeignKey("subscriptions.id"), nullable=True, index=True)
    status = Column(Enum(PaymentStatus), default=PaymentStatus.CREATED, nullable=False, index=True)
    amount = Column(Numeric(12, 2), nullable=False)
    currency = Column(String(3), default="USD", nullable=False)
    provider = Column(String(64), default="telegram_stars", nullable=False)
    payment_method = Column(String(64), nullable=True)
    provider_transaction_id = Column(String(255), nullable=True, index=True)
    paid_at = Column(DateTime(timezone=True), nullable=True)
    refund_reason = Column(String(255), nullable=True)  # only set when provider confirmed refund
    version = Column(Integer, default=1, nullable=False)

    __table_args__ = (
        Index("ix_payments_user_status", "user_id", "status"),
    )


class PaymentWebhookEvent(Base, BaseModel):
    """Provider webhook event history. Payload is stored redacted (no secrets/card data)."""

    __tablename__ = "payment_webhook_events"

    id = Column(UUID_PG(as_uuid=True), primary_key=True, default=uuid.uuid4)
    provider = Column(String(64), nullable=False)
    event_id = Column(String(255), nullable=False, index=True)  # provider event id, idempotency anchor
    event_type = Column(String(128), nullable=True)
    payment_id = Column(UUID_PG(as_uuid=True), ForeignKey("payments.id"), nullable=True, index=True)
    status = Column(Enum(WebhookEventStatus), default=WebhookEventStatus.RECEIVED, nullable=False, index=True)
    signature_valid = Column(Boolean, default=True, nullable=False)
    payload_summary = Column(String, nullable=True)  # redacted summary, never full card data
    replay_count = Column(Integer, default=0, nullable=False)
    last_replayed_at = Column(DateTime(timezone=True), nullable=True)
    processed_at = Column(DateTime(timezone=True), nullable=True)
    error = Column(String(512), nullable=True)

    __table_args__ = (
        Index("uq_payment_webhook_events_provider_event", "provider", "event_id", unique=True),
    )
