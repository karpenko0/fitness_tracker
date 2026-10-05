"""Billing admin routes (SPEC-011 6.10, 11.5): read-only subscriptions/payments,
idempotent webhook replay. Manual status change is impossible: billing:manual_status
is granted to NO role, and the endpoint always answers 403."""
from datetime import datetime
from typing import Optional
from uuid import UUID as PyUUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models.user import User

from . import auth, models
from .audit import write_admin_audit
from .common import err_response, ok, paginate_params, require_confirm, reject_unknown_query_params
from .masking import ip_hash, mask_transaction_id
from .models_billing import (
    Payment,
    PaymentStatus,
    PaymentWebhookEvent,
    WebhookEventStatus,
    Subscription,
    SubscriptionStatus,
)
from .schemas_billing import ManualPaymentStatusRequest, WebhookReplayRequest

settings = get_settings()
router = APIRouter(prefix="/admin/billing", tags=["admin-billing"])

# Event type -> resulting payment status. The ONLY way statuses change in the admin domain.
WEBHOOK_STATUS_MAP = {
    "payment_succeeded": PaymentStatus.PAID,
    "payment_failed": PaymentStatus.FAILED,
    "payment_expired": PaymentStatus.EXPIRED,
    "payment_cancelled": PaymentStatus.CANCELLED,
    "refund_succeeded": PaymentStatus.REFUNDED,
}


def process_webhook_event(db: Session, event: PaymentWebhookEvent, replay: bool = False) -> dict:
    """Idempotent processing of a webhook event (same event N times -> same result)."""
    if not event.signature_valid:
        raise err_response("REPLAY_REFUSED", "Webhook signature is invalid; replay refused", 409)

    payment = db.query(Payment).filter(Payment.id == event.payment_id).first() if event.payment_id else None
    change = None
    if payment is not None:
        target = WEBHOOK_STATUS_MAP.get(event.event_type or "")
        if target is not None and payment.status != target:
            before = payment.status.value
            payment.status = target
            if target == PaymentStatus.PAID:
                payment.paid_at = payment.paid_at or datetime.utcnow()
            payment.version = (payment.version or 1) + 1
            change = {"before": before, "after": target.value}
        # already in target state -> no-op (idempotent)

    event.status = WebhookEventStatus.PROCESSED
    event.processed_at = datetime.utcnow()
    event.replay_count = (event.replay_count or 0) + (1 if replay else 0)
    if replay:
        event.last_replayed_at = datetime.utcnow()
    db.commit()
    return {"payment_id": str(payment.id) if payment else None, "change": change}


@router.get("/subscriptions")
def list_subscriptions(
    request: Request,
    user_id: Optional[PyUUID] = None,
    status_filter: Optional[str] = None,
    plan: Optional[str] = None,
    page: int = 1,
    pageSize: int = 20,
    sort: Optional[str] = None,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("billing:read")),
):
    reject_unknown_query_params(request)
    page, page_size, sort = paginate_params(page, pageSize, sort)
    q = db.query(Subscription)
    if user_id:
        q = q.filter(Subscription.user_id == user_id)
    if status_filter:
        if status_filter not in [s.value for s in SubscriptionStatus]:
            raise err_response("VALIDATION_ERROR", f"unknown status: {status_filter}", 400)
        q = q.filter(Subscription.status == status_filter)
    if plan:
        q = q.filter(Subscription.plan_code == plan)
    total = q.count()
    items = (
        q.order_by(Subscription.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return ok(
        {
            "items": [
                {
                    "id": str(s.id),
                    "user_id": str(s.user_id),
                    "plan_code": s.plan_code,
                    "status": s.status.value,
                    "provider": s.provider,
                    "provider_transaction_id": mask_transaction_id(s.provider_transaction_id),
                    "period_start": s.period_start.isoformat() if s.period_start else None,
                    "period_end": s.period_end.isoformat() if s.period_end else None,
                    "created_at": s.created_at.isoformat() if s.created_at else None,
                }
                for s in items
            ],
            "page": page,
            "pageSize": page_size,
            "total": total,
        }
    )


@router.get("/payments")
def list_payments(
    request: Request,
    user_id: Optional[PyUUID] = None,
    status_filter: Optional[str] = None,
    provider: Optional[str] = None,
    page: int = 1,
    pageSize: int = 20,
    sort: Optional[str] = None,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("billing:read")),
):
    reject_unknown_query_params(request)
    page, page_size, sort = paginate_params(page, pageSize, sort)
    q = db.query(Payment)
    if user_id:
        q = q.filter(Payment.user_id == user_id)
    if status_filter:
        if status_filter not in [s.value for s in PaymentStatus]:
            raise err_response("VALIDATION_ERROR", f"unknown status: {status_filter}", 400)
        q = q.filter(Payment.status == status_filter)
    if provider:
        q = q.filter(Payment.provider == provider)
    total = q.count()
    items = q.order_by(Payment.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return ok(
        {
            "items": [
                {
                    "id": str(p.id),
                    "user_id": str(p.user_id),
                    "subscription_id": str(p.subscription_id) if p.subscription_id else None,
                    "status": p.status.value,
                    "amount": str(p.amount),
                    "currency": p.currency,
                    "provider": p.provider,
                    "payment_method": p.payment_method,
                    "provider_transaction_id": mask_transaction_id(p.provider_transaction_id),
                    "created_at": p.created_at.isoformat() if p.created_at else None,
                    "paid_at": p.paid_at.isoformat() if p.paid_at else None,
                    "refund_reason": p.refund_reason,
                    "webhook_events": [
                        {
                            "id": str(e.id),
                            "event_id": e.event_id,
                            "event_type": e.event_type,
                            "status": e.status.value,
                            "signature_valid": e.signature_valid,
                            "replay_count": e.replay_count,
                        }
                        for e in db.query(PaymentWebhookEvent).filter(PaymentWebhookEvent.payment_id == p.id).all()
                    ],
                }
                for p in items
            ],
            "page": page,
            "pageSize": page_size,
            "total": total,
        }
    )


@router.post("/webhooks/{event_id}/replay")
def replay_webhook(
    event_id: PyUUID,
    request: Request,
    payload: WebhookReplayRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("billing:replay", critical=True)),
):
    """Safe, idempotent reprocessing of a provider webhook (SPEC-011 6.10).
    Same key + same body -> same result; different body -> 409 IDEMPOTENCY_KEY_REUSED."""
    require_confirm(payload, settings)
    event = db.query(PaymentWebhookEvent).filter(PaymentWebhookEvent.id == event_id).first()
    if not event:
        raise err_response("NOT_FOUND", "Webhook event not found", 404)
    try:
        result = process_webhook_event(db, event, replay=True)
    except Exception as exc:
        if hasattr(exc, "status_code"):
            detail = getattr(exc, "detail", None)
            reason = f"{detail['code']}: {detail['message']}" if isinstance(detail, dict) else str(exc)
            write_admin_audit(
                db,
                actor=actor,
                action="admin.billing.webhook.replayed",
                resource_type="webhook_event",
                resource_id=event.id,
                result=models.AuditResult.DENIED,
                reason=reason,
                request_id=getattr(request.state, "request_id", "unknown"),
            )
            raise
        raise
    write_admin_audit(
        db,
        actor=actor,
        action="admin.billing.webhook.replayed",
        resource_type="webhook_event",
        resource_id=event.id,
        result=models.AuditResult.SUCCESS,
        reason=f"replay #{event.replay_count} event {event.event_id}",
        request_id=getattr(request.state, "request_id", "unknown"),
        ip_hash=ip_hash(request.client.host if request.client else None, settings.AUDIT_IP_SALT),
        after_summary={"payment_change": result.get("change")},
    )
    return ok({"replayed": True, "event_id": str(event.id), "replay_count": event.replay_count, **result})


@router.get("/webhooks")
def list_webhooks(
    request: Request,
    payment_id: Optional[PyUUID] = None,
    status_filter: Optional[str] = None,
    page: int = 1,
    pageSize: int = 20,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("billing:read")),
):
    reject_unknown_query_params(request)
    page, page_size, _ = paginate_params(page, pageSize, None)
    q = db.query(PaymentWebhookEvent)
    if payment_id:
        q = q.filter(PaymentWebhookEvent.payment_id == payment_id)
    if status_filter:
        q = q.filter(PaymentWebhookEvent.status == status_filter)
    total = q.count()
    items = q.order_by(PaymentWebhookEvent.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return ok(
        {
            "items": [
                {
                    "id": str(e.id),
                    "provider": e.provider,
                    "event_id": e.event_id,
                    "event_type": e.event_type,
                    "payment_id": str(e.payment_id) if e.payment_id else None,
                    "status": e.status.value,
                    "signature_valid": e.signature_valid,
                    "replay_count": e.replay_count,
                    "payload_summary": e.payload_summary,
                    "created_at": e.created_at.isoformat() if e.created_at else None,
                }
                for e in items
            ],
            "page": page,
            "pageSize": page_size,
            "total": total,
        }
    )


@router.post("/payments/{payment_id}/status")
def manual_payment_status(
    payment_id: PyUUID,
    payload: ManualPaymentStatusRequest,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.get_current_admin),
):
    """Manual payment status change is forbidden for EVERY role (SPEC-011 6.4, 11.5).
    The endpoint exists only to return a documented, audited refusal."""
    write_admin_audit(
        db,
        actor=actor,
        action="admin.billing.manual_status",
        resource_type="payment",
        resource_id=payment_id,
        result=models.AuditResult.DENIED,
        reason="billing:manual_status is granted to no role; use webhook/reconciliation",
        request_id=getattr(request.state, "request_id", "unknown"),
        ip_hash=ip_hash(request.client.host if request.client else None, settings.AUDIT_IP_SALT),
    )
    raise err_response(
        "FORBIDDEN",
        "Manual payment status change is not allowed; only provider webhook or reconciliation may change it",
        403,
    )
