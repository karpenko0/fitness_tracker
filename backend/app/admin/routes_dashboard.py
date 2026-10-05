"""Admin dashboard (SPEC-011 6.2). Every widget: value (or None = «Нет данных»),
period, last update time and a link to the filtered list."""
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models.user import User
from app.models.plan import Plan

from . import auth, models
from .models_billing import Payment, PaymentStatus, PaymentWebhookEvent, Subscription, SubscriptionStatus
from .models_content import Challenge, ContentStatus, Exercise, Program
from .rbac import has_permission

settings = get_settings()
router = APIRouter(prefix="/admin", tags=["admin-dashboard"])


def _widget(value, period: str, href: str, note: Optional[str] = None) -> dict:
    return {"value": value, "period": period, "updated_at": datetime.utcnow().isoformat(), "href": href, "note": note}


@router.get("/dashboard")
def dashboard(request: Request, db: Session = Depends(get_db), user: User = Depends(auth.get_current_admin)):
    now = datetime.utcnow()
    today = now.date()
    d7 = today - timedelta(days=6)
    d30 = today - timedelta(days=29)

    can_billing = has_permission(user.role, "billing:read")

    def active_users_period(start: date) -> Optional[int]:
        from app.habits.models import HabitTask

        return (
            db.query(func.count(func.distinct(HabitTask.user_id)))
            .filter(HabitTask.local_date >= start)
            .scalar()
        )

    users_active_today = active_users_period(today)
    users_active_7 = active_users_period(d7)
    users_active_30 = active_users_period(d30)
    new_reg_7 = db.query(func.count(User.id)).filter(User.created_at >= datetime.combine(d7, datetime.min.time())).scalar()
    new_reg_30 = db.query(func.count(User.id)).filter(User.created_at >= datetime.combine(d30, datetime.min.time())).scalar()

    widgets = [
        _widget(users_active_today, "today", "/admin/analytics?metric=active_users"),
        _widget(users_active_7, "7d", "/admin/analytics?metric=active_users"),
        _widget(users_active_30, "30d", "/admin/analytics?metric=active_users"),
        _widget(new_reg_7, "7d", "/admin/analytics?metric=registrations"),
        _widget(new_reg_30, "30d", "/admin/analytics?metric=registrations"),
        _widget(None, "30d", "/admin/analytics?metric=workouts", note="Нет данных: источник тренировок не подключён"),
    ]

    if can_billing:
        active_subs = db.query(func.count(Subscription.id)).filter(Subscription.status == SubscriptionStatus.ACTIVE).scalar()
        mrr_rows = (
            db.query(Plan.price, Plan.currency)
            .join(Subscription, Subscription.plan_id == Plan.id)
            .filter(Subscription.status == SubscriptionStatus.ACTIVE)
            .all()
        )
        mrr = sum(float(p) for p, _ in mrr_rows) if mrr_rows else 0
        mrr_cur = mrr_rows[0][1] if mrr_rows else "USD"
        payments_ok = (
            db.query(func.count(Payment.id))
            .filter(Payment.status == PaymentStatus.PAID, Payment.paid_at >= datetime.combine(d30, datetime.min.time()))
            .scalar()
        )
        payments_failed = (
            db.query(func.count(Payment.id))
            .filter(Payment.status == PaymentStatus.FAILED, Payment.created_at >= datetime.combine(d30, datetime.min.time()))
            .scalar()
        )
        widgets += [
            _widget(active_subs, "now", "/admin/billing/subscriptions"),
            _widget({"amount": f"{mrr:.2f}", "currency": mrr_cur}, "mrr", "/admin/billing/subscriptions"),
            _widget(payments_ok, "30d", "/admin/billing/payments?status=PAID"),
            _widget(payments_failed, "30d", "/admin/billing/payments?status=FAILED"),
        ]

    # Content widgets
    published = (
        db.query(Exercise.id)
        .filter(Exercise.status == ContentStatus.PUBLISHED, Exercise.deleted_at.is_(None))
        .count()
        + db.query(Program.id).filter(Program.status == ContentStatus.PUBLISHED, Program.deleted_at.is_(None)).count()
    )
    pending = (
        db.query(Exercise.id)
        .filter(Exercise.status.in_([ContentStatus.DRAFT, ContentStatus.IN_REVIEW]), Exercise.deleted_at.is_(None))
        .count()
        + db.query(Program.id).filter(Program.status.in_([ContentStatus.DRAFT, ContentStatus.IN_REVIEW]), Program.deleted_at.is_(None)).count()
    )
    widgets += [
        _widget(published, "now", "/admin/exercises"),
        _widget(pending, "now", "/admin/programs"),
    ]

    # Notifications delivery
    from app.habits.models import NotificationDelivery, NotificationStatus

    sent = db.query(func.count(NotificationDelivery.id)).filter(NotificationDelivery.status == NotificationStatus.SENT).scalar()
    failed_notif = db.query(func.count(NotificationDelivery.id)).filter(NotificationDelivery.status == NotificationStatus.FAILED).scalar()
    widgets += [_widget(sent, "total", "/admin/notifications"), _widget(failed_notif, "total", "/admin/notifications")]

    # Active challenges
    challenges = db.query(func.count(Challenge.id)).filter(
        Challenge.status == ContentStatus.PUBLISHED,
        Challenge.starts_at <= today,
        Challenge.ends_at >= today,
        Challenge.deleted_at.is_(None),
    ).scalar()
    widgets.append(_widget(challenges, "now", "/admin/challenges"))

    # Security warnings & webhook errors
    denied = db.query(func.count(models.AdminAuditLog.id)).filter(
        models.AdminAuditLog.result == models.AuditResult.DENIED,
        models.AdminAuditLog.created_at >= now - timedelta(hours=24),
    ).scalar()
    webhook_errors = db.query(func.count(PaymentWebhookEvent.id)).filter(
        PaymentWebhookEvent.status == "FAILED",
        PaymentWebhookEvent.created_at >= now - timedelta(hours=24),
    ).scalar()
    widgets += [
        _widget(denied, "24h", "/admin/audit-logs?result=DENIED"),
        _widget(webhook_errors, "24h", "/admin/billing/webhooks"),
    ]

    return {"data": {"widgets": widgets, "updated_at": now.isoformat()}}
