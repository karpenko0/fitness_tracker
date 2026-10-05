"""Analytics, audit journal and exports (SPEC-011 6.11, 6.12, 9.7).

Every analytics response carries: period, applied filters, data source,
data delay and the update timestamp. Small sensitive segments are hidden
(min segment size from configuration). Exports are async, TTL-bounded and
one-time-download."""
import csv
import os
import threading
from datetime import date, datetime, timedelta
from typing import Optional
from uuid import UUID as PyUUID

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import SessionLocal, get_db
from app.models.user import ADMIN_ROLES, User

from . import auth, models
from .audit import write_admin_audit
from .common import err_response, ok, paginate_params, require_confirm, reject_unknown_query_params
from .masking import ip_hash, mask_email, mask_transaction_id, redact
from .models_billing import Payment, PaymentStatus, PaymentWebhookEvent, Subscription, SubscriptionStatus
from .models_content import Challenge, ContentStatus, Exercise, HabitDefinition, Program, PromoCode
from .schemas import ExportRequest

settings = get_settings()
router = APIRouter(prefix="/admin", tags=["admin-analytics"])

EXPORT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "exports")


def _now():
    return datetime.utcnow()


def _meta(period_start: date, period_end: date, filters: dict, source: str = "live") -> dict:
    return {
        "period": {"start": period_start.isoformat(), "end": period_end.isoformat()},
        "timezone": filters.get("timezone", "UTC"),
        "source": source,
        "data_delay_minutes": 0,
        "updated_at": _now().isoformat(),
        "filters": redact(filters),
        "min_segment_size": settings.ANALYTICS_MIN_SEGMENT_SIZE,
    }


def _segment_ok(db, segment_size: int) -> bool:
    """Sensitive aggregates are hidden below the minimal segment size (SPEC-011 6.11)."""
    return segment_size >= settings.ANALYTICS_MIN_SEGMENT_SIZE


@router.get("/analytics/summary")
def analytics_summary(
    request: Request,
    period_days: int = 30,
    timezone: str = "UTC",
    plan: Optional[str] = None,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("analytics:read")),
):
    from app.habits.models import Habit, HabitTask, NotificationDelivery, NotificationStatus

    reject_unknown_query_params(request)
    if period_days < 1 or period_days > 365:
        raise err_response("VALIDATION_ERROR", "period_days must be 1..365", 400)
    today = date.today()
    start = today - timedelta(days=period_days - 1)
    start_dt = datetime.combine(start, datetime.min.time())

    filters = {"period_days": period_days, "timezone": timezone, "plan": plan}

    # Segment size guard (active users in the period)
    segment_size = (
        db.query(func.count(func.distinct(HabitTask.user_id))).filter(HabitTask.local_date >= start).scalar() or 0
    )
    sensitive_ok = _segment_ok(db, segment_size)

    dau = db.query(func.count(func.distinct(HabitTask.user_id))).filter(HabitTask.local_date == today).scalar()
    wau = db.query(func.count(func.distinct(HabitTask.user_id))).filter(HabitTask.local_date >= today - timedelta(days=6)).scalar()
    mau = db.query(func.count(func.distinct(HabitTask.user_id))).filter(HabitTask.local_date >= today - timedelta(days=29)).scalar()

    new_regs = db.query(func.count(User.id)).filter(User.created_at >= start_dt, User.deleted_at.is_(None)).scalar()

    # Retention: cohorts of users registered N days ago who were active the day after registration
    def retention(days: int) -> Optional[float]:
        cohort_day = today - timedelta(days=days + 1)
        cohort = (
            db.query(User.id)
            .filter(User.created_at >= datetime.combine(cohort_day, datetime.min.time()), User.created_at < datetime.combine(cohort_day + timedelta(days=1), datetime.min.time()), User.deleted_at.is_(None))
            .all()
        )
        if not cohort:
            return None
        cohort_ids = [c[0] for c in cohort]
        active_day = cohort_day + timedelta(days=1)
        active = (
            db.query(func.count(func.distinct(HabitTask.user_id)))
            .filter(HabitTask.user_id.in_(cohort_ids), HabitTask.local_date == active_day)
            .scalar()
        )
        return round(100.0 * active / len(cohort_ids), 1)

    active_subs = db.query(func.count(Subscription.id)).filter(Subscription.status == SubscriptionStatus.ACTIVE).scalar()
    expiring = db.query(func.count(Subscription.id)).filter(
        Subscription.status == SubscriptionStatus.ACTIVE,
        Subscription.period_end >= datetime.combine(today, datetime.min.time()),
        Subscription.period_end <= datetime.combine(today + timedelta(days=30), datetime.min.time()),
    ).scalar()
    churned = db.query(func.count(Subscription.id)).filter(
        Subscription.status == SubscriptionStatus.CANCELLED,
        Subscription.updated_at >= start_dt,
    ).scalar()

    pro_users = db.query(func.count(func.distinct(Subscription.user_id))).filter(Subscription.status == SubscriptionStatus.ACTIVE).scalar()
    all_users = db.query(func.count(User.id)).filter(User.deleted_at.is_(None)).scalar() or 1

    revenue_rows = db.query(func.sum(Payment.amount), func.count(Payment.id)).filter(
        Payment.status == PaymentStatus.PAID, Payment.paid_at >= start_dt
    ).one()
    revenue = float(revenue_rows[0] or 0)
    payments_ok = int(revenue_rows[1] or 0)
    payments_failed = db.query(func.count(Payment.id)).filter(Payment.status == PaymentStatus.FAILED, Payment.created_at >= start_dt).scalar()

    published = (
        db.query(Exercise.id).filter(Exercise.status == ContentStatus.PUBLISHED, Exercise.deleted_at.is_(None)).count()
        + db.query(Program.id).filter(Program.status == ContentStatus.PUBLISHED, Program.deleted_at.is_(None)).count()
    )
    sent = db.query(func.count(NotificationDelivery.id)).filter(NotificationDelivery.status == NotificationStatus.SENT).scalar()
    failed_notif = db.query(func.count(NotificationDelivery.id)).filter(NotificationDelivery.status == NotificationStatus.FAILED).scalar()
    challenges_active = db.query(func.count(Challenge.id)).filter(
        Challenge.status == ContentStatus.PUBLISHED, Challenge.starts_at <= today, Challenge.ends_at >= today, Challenge.deleted_at.is_(None)
    ).scalar()

    def guarded(value):
        return value if sensitive_ok else None

    return ok(
        {
            "meta": _meta(start, today, filters),
            "segment_size": segment_size,
            "active_users": {"dau": guarded(dau), "wau": guarded(wau), "mau": guarded(mau)},
            "registrations": {
                "new": new_regs,
                "funnel": {"registered": new_regs, "onboarded": None, "first_workout": None},
            },
            "workouts": {"completed": None, "note": "Нет данных: источник тренировок не подключён"},
            "retention": {"d1": guarded(retention(1)), "d7": guarded(retention(7)), "d30": guarded(retention(30))},
            "subscriptions": {
                "active": guarded(active_subs),
                "expiring_30d": guarded(expiring),
                "churned_period": guarded(churned),
                "free_to_pro_percent": guarded(round(100.0 * (pro_users or 0) / all_users, 1)),
            },
            "revenue": {
                "amount": guarded(f"{revenue:.2f}"),
                "currency": "USD",
                "payments_ok": payments_ok,
                "payments_failed": payments_failed,
                "success_rate": guarded(round(100.0 * payments_ok / (payments_ok + payments_failed), 1)) if (payments_ok + payments_failed) else None,
            },
            "content": {"published_total": published},
            "notifications": {"sent": sent, "failed": failed_notif},
            "challenges": {"active": challenges_active},
            "api_errors": {"client": None, "admin": None},
        }
    )


@router.get("/analytics/content")
def analytics_content(
    request: Request,
    period_days: int = 30,
    timezone: str = "UTC",
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("analytics:read")),
):
    """Limited analytics for CONTENT_MANAGER (SPEC-011 6.4 «Ограниченно»)."""
    from app.habits.models import HabitTask

    reject_unknown_query_params(request)
    today = date.today()
    start = today - timedelta(days=period_days - 1)
    usage_rows = (
        db.query(HabitTask.user_id, func.count(HabitTask.id).label("n"))
        .filter(HabitTask.local_date >= start)
        .group_by(HabitTask.user_id)
        .all()
    )
    exercises_by_type = (
        db.query(Exercise.type, func.count(Exercise.id)).filter(Exercise.status == ContentStatus.PUBLISHED, Exercise.deleted_at.is_(None)).group_by(Exercise.type).all()
    )
    programs_by_status = (
        db.query(Program.status, func.count(Program.id)).filter(Program.deleted_at.is_(None)).group_by(Program.status).all()
    )
    habits = db.query(func.count(HabitDefinition.id)).filter(HabitDefinition.status == "PUBLISHED").scalar()
    return ok(
        {
            "meta": _meta(start, today, {"period_days": period_days, "timezone": timezone}),
            "exercises_published_by_type": {t.value if hasattr(t, "value") else str(t): n for t, n in exercises_by_type},
            "programs_by_status": {s.value if hasattr(s, "value") else str(s): n for s, n in programs_by_status},
            "habits_published": habits,
            "habit_task_completions": sum(n for _, n in usage_rows),
            "habit_users_active": len(usage_rows),
        }
    )


@router.get("/audit-logs")
def audit_logs(
    request: Request,
    actor_user_id: Optional[PyUUID] = None,
    action: Optional[str] = None,
    resource_type: Optional[str] = None,
    result: Optional[str] = None,
    request_id: Optional[str] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    page: int = 1,
    pageSize: int = 20,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("audit:read")),
):
    """Read the admin action journal (append-only; redacted; SPEC-011 6.12)."""
    reject_unknown_query_params(request)
    page, page_size, _ = paginate_params(page, pageSize, None)
    if result and result not in ("SUCCESS", "DENIED", "FAILED"):
        raise err_response("VALIDATION_ERROR", "result must be SUCCESS|DENIED|FAILED", 400)
    q = db.query(models.AdminAuditLog)
    if actor_user_id:
        q = q.filter(models.AdminAuditLog.actor_user_id == actor_user_id)
    if action:
        q = q.filter(models.AdminAuditLog.action == action)
    if resource_type:
        q = q.filter(models.AdminAuditLog.resource_type == resource_type)
    if result:
        q = q.filter(models.AdminAuditLog.result == result)
    if request_id:
        q = q.filter(models.AdminAuditLog.request_id == request_id)
    if start_date:
        q = q.filter(models.AdminAuditLog.created_at >= datetime.combine(start_date, datetime.min.time()))
    if end_date:
        q = q.filter(models.AdminAuditLog.created_at < datetime.combine(end_date + timedelta(days=1), datetime.min.time()))
    total = q.count()
    items = q.order_by(models.AdminAuditLog.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()

    # Reading the audit journal itself is audited (SPEC-011 10)
    write_admin_audit(
        db,
        actor=actor,
        action="admin.audit.read",
        resource_type="admin_audit_logs",
        result=models.AuditResult.SUCCESS,
        reason=f"query: action={action} resource={resource_type} result={result} request_id={request_id}",
        request_id=getattr(request.state, "request_id", "unknown"),
        ip_hash=ip_hash(request.client.host if request.client else None, settings.AUDIT_IP_SALT),
    )
    return ok(
        {
            "items": [
                {
                    "id": str(a.id),
                    "actor_user_id": str(a.actor_user_id),
                    "actor_role": a.actor_role,
                    "action": a.action,
                    "resource_type": a.resource_type,
                    "resource_id": str(a.resource_id) if a.resource_id else None,
                    "result": a.result.value,
                    "reason": a.reason,
                    "request_id": a.request_id,
                    "before_summary": a.before_summary,
                    "after_summary": a.after_summary,
                    "created_at": a.created_at.isoformat() if a.created_at else None,
                }
                for a in items
            ],
            "page": page,
            "pageSize": page_size,
            "total": total,
        }
    )


# ============================= EXPORTS =============================

def _build_export_csv(entity_type: str, filters: dict) -> str:
    """Generate CSV for an allowed entity. All rows are masked (SPEC-011 9.3, 11.6)."""
    os.makedirs(EXPORT_DIR, exist_ok=True)
    path = os.path.join(EXPORT_DIR, f"{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{entity_type}.csv")
    db = SessionLocal()
    try:
        rows, header = [], None
        if entity_type == "users":
            q = db.query(User).filter(User.deleted_at.is_(None)).limit(settings.ADMIN_EXPORT_MAX_ROWS)
            if filters.get("status") == "BLOCKED":
                q = q.filter(User.is_active.is_(False))
            for u in q:
                rows.append([str(u.id), mask_email(u.email), u.first_name or "", u.last_name or "", u.role, "BLOCKED" if not u.is_active else "ACTIVE", u.created_at.isoformat() if u.created_at else ""])
            header = ["id", "email", "first_name", "last_name", "role", "status", "created_at"]
        elif entity_type == "payments":
            q = db.query(Payment).limit(settings.ADMIN_EXPORT_MAX_ROWS)
            if filters.get("status"):
                q = q.filter(Payment.status == filters["status"])
            for p in q:
                rows.append([str(p.id), str(p.user_id), p.status.value, str(p.amount), p.currency, p.provider, mask_transaction_id(p.provider_transaction_id), p.created_at.isoformat() if p.created_at else ""])
            header = ["id", "user_id", "status", "amount", "currency", "provider", "provider_transaction_id", "created_at"]
        elif entity_type == "subscriptions":
            q = db.query(Subscription).limit(settings.ADMIN_EXPORT_MAX_ROWS)
            if filters.get("status"):
                q = q.filter(Subscription.status == filters["status"])
            for s in q:
                rows.append([str(s.id), str(s.user_id), s.plan_code or "", s.status.value, mask_transaction_id(s.provider_transaction_id), s.period_end.isoformat() if s.period_end else ""])
            header = ["id", "user_id", "plan_code", "status", "provider_transaction_id", "period_end"]
        elif entity_type == "exercises":
            q = db.query(Exercise).filter(Exercise.deleted_at.is_(None)).limit(settings.ADMIN_EXPORT_MAX_ROWS)
            for e in q:
                rows.append([str(e.id), e.title, e.slug, e.type.value if hasattr(e.type, "value") else str(e.type), e.status.value if hasattr(e.status, "value") else str(e.status)])
            header = ["id", "title", "slug", "type", "status"]
        elif entity_type == "programs":
            q = db.query(Program).filter(Program.deleted_at.is_(None)).limit(settings.ADMIN_EXPORT_MAX_ROWS)
            for p in q:
                rows.append([str(p.id), p.title, p.slug, p.status.value, str(p.published_version), str(p.duration_minutes or "")])
            header = ["id", "title", "slug", "status", "published_version", "duration_minutes"]
        elif entity_type == "promo_codes":
            q = db.query(PromoCode).filter(PromoCode.deleted_at.is_(None)).limit(settings.ADMIN_EXPORT_MAX_ROWS)
            for p in q:
                rows.append([p.code_normalized, p.discount_type.value if hasattr(p.discount_type, "value") else str(p.discount_type), str(p.discount_value), p.currency, p.starts_at.isoformat(), p.ends_at.isoformat(), str(p.max_uses), str(p.used_count), p.status.value if hasattr(p.status, "value") else str(p.status)])
            header = ["code", "discount_type", "discount_value", "currency", "starts_at", "ends_at", "max_uses", "used_count", "status"]
        elif entity_type == "audit_logs":
            q = db.query(models.AdminAuditLog).order_by(models.AdminAuditLog.created_at.desc()).limit(settings.ADMIN_EXPORT_MAX_ROWS)
            for a in q:
                rows.append([str(a.id), a.actor_role, a.action, a.resource_type, str(a.resource_id) if a.resource_id else "", a.result.value, a.reason or "", a.request_id, a.created_at.isoformat() if a.created_at else ""])
            header = ["id", "actor_role", "action", "resource_type", "resource_id", "result", "reason", "request_id", "created_at"]
        elif entity_type == "notifications":
            from app.habits.models import NotificationDelivery

            q = db.query(NotificationDelivery).limit(settings.ADMIN_EXPORT_MAX_ROWS)
            for d in q:
                rows.append([str(d.id), str(d.user_id), d.channel.value if hasattr(d.channel, "value") else str(d.channel), d.status.value if hasattr(d.status, "value") else str(d.status), str(d.attempt_count), d.scheduled_at.isoformat() if d.scheduled_at else ""])
            header = ["id", "user_id", "channel", "status", "attempt_count", "scheduled_at"]
        elif entity_type == "challenges":
            q = db.query(Challenge).filter(Challenge.deleted_at.is_(None)).limit(settings.ADMIN_EXPORT_MAX_ROWS)
            for c in q:
                rows.append([str(c.id), c.title, c.type.value if hasattr(c.type, "value") else str(c.type), c.starts_at.isoformat(), c.ends_at.isoformat(), c.status.value if hasattr(c.status, "value") else str(c.status)])
            header = ["id", "title", "type", "starts_at", "ends_at", "status"]
        elif entity_type == "habits":
            q = db.query(HabitDefinition).filter(HabitDefinition.deleted_at.is_(None)).limit(settings.ADMIN_EXPORT_MAX_ROWS)
            for h in q:
                rows.append([str(h.id), h.title, h.goal_type.value if hasattr(h.goal_type, "value") else str(h.goal_type), str(h.target_value or ""), h.status.value if hasattr(h.status, "value") else str(h.status)])
            header = ["id", "title", "goal_type", "target_value", "status"]
        else:
            raise err_response("VALIDATION_ERROR", f"export not allowed for entity {entity_type}", 400)

        with open(path, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(header)
            writer.writerows(rows)
        return path, len(rows)
    finally:
        db.close()


def _export_worker(export_id: PyUUID):
    db = SessionLocal()
    try:
        export = db.query(models.AdminExport).filter(models.AdminExport.id == export_id).first()
        if not export:
            return
        export.status = models.ExportStatus.PROCESSING
        db.commit()
        try:
            path, count = _build_export_csv(export.entity_type, export.filters or {})
            export.file_path = path
            export.rows_count = count
            export.status = models.ExportStatus.READY
            export.expires_at = datetime.utcnow() + timedelta(minutes=settings.ADMIN_EXPORT_TTL_MINUTES)
        except Exception as exc:
            export.status = models.ExportStatus.FAILED
            export.error = str(exc)[:500]
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


@router.post("/exports", status_code=201)
def create_export(
    request: Request,
    payload: ExportRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("exports:create", critical=True)),
):
    require_confirm(payload, settings)
    export = models.AdminExport(
        requested_by=actor.id,
        entity_type=payload.entity_type,
        filters=redact(payload.filters or {}),
        status=models.ExportStatus.PENDING,
    )
    db.add(export)
    db.commit()
    db.refresh(export)
    write_admin_audit(
        db,
        actor=actor,
        action="admin.analytics.export_requested",
        resource_type="admin_export",
        resource_id=export.id,
        reason=f"export {payload.entity_type} filters={payload.filters}",
        request_id=getattr(request.state, "request_id", "unknown"),
        ip_hash=ip_hash(request.client.host if request.client else None, settings.AUDIT_IP_SALT),
    )
    thread = threading.Thread(target=_export_worker, args=(export.id,), daemon=True)
    thread.start()
    return ok({"id": str(export.id), "status": "PENDING", "ttl_minutes": settings.ADMIN_EXPORT_TTL_MINUTES})


@router.get("/exports")
def list_exports(
    request: Request,
    page: int = 1,
    pageSize: int = 20,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("exports:create")),
):
    reject_unknown_query_params(request)
    page, page_size, _ = paginate_params(page, pageSize, None)
    q = db.query(models.AdminExport)
    if actor.role != "super_admin":
        q = q.filter(models.AdminExport.requested_by == actor.id)
    total = q.count()
    items = q.order_by(models.AdminExport.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return ok(
        {
            "items": [
                {
                    "id": str(e.id),
                    "entity_type": e.entity_type,
                    "status": e.status.value,
                    "rows_count": e.rows_count,
                    "expires_at": e.expires_at.isoformat() if e.expires_at else None,
                    "downloaded": e.downloaded_at is not None,
                    "created_at": e.created_at.isoformat() if e.created_at else None,
                }
                for e in items
            ],
            "page": page,
            "pageSize": page_size,
            "total": total,
        }
    )


@router.get("/exports/{export_id}/download")
def download_export(
    export_id: PyUUID,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("exports:create")),
):
    """One-time, TTL-bounded download (SPEC-011 9.7)."""
    e = db.query(models.AdminExport).filter(models.AdminExport.id == export_id).first()
    if not e:
        raise err_response("NOT_FOUND", "Export not found", 404)
    if e.requested_by != actor.id and actor.role != "super_admin":
        raise err_response("FORBIDDEN", "Not your export", 403)
    if e.status != models.ExportStatus.READY:
        raise err_response("NOT_READY", f"Export is {e.status.value}", 409)
    if e.downloaded_at is not None:
        raise err_response("ALREADY_DOWNLOADED", "Export link is one-time", 410)
    if e.expires_at and e.expires_at < datetime.utcnow():
        raise err_response("EXPIRED", "Export link has expired", 410)
    if not e.file_path or not os.path.exists(e.file_path):
        raise err_response("NOT_FOUND", "Export file missing", 404)
    e.downloaded_at = datetime.utcnow()
    db.commit()
    return FileResponse(e.file_path, media_type="text/csv", filename=f"export_{e.entity_type}.csv")
