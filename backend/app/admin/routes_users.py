"""Admin user management (SPEC-011 6.3): search, card, block/unblock, roles, soft delete, bulk."""
from datetime import datetime
from typing import Optional
from uuid import UUID as PyUUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models.user import ROLE_RANK, ADMIN_ROLES, User
from app.models import Plan

from . import auth, models
from .audit import write_admin_audit
from .common import err_response, ok, paginate_params, require_confirm, reject_unknown_query_params
from .masking import ip_hash, mask_email, mask_telegram_id
from .models_billing import Payment, Subscription
from .rbac import can_assign_role, has_permission
from .schemas import BlockRequest, BulkBlockRequest, RoleAssignRequest, SoftDeleteUserRequest, UnblockRequest

settings = get_settings()
router = APIRouter(prefix="/admin/users", tags=["admin-users"])


def _user_card(db: Session, user: User, request: Request) -> dict:
    """Full operator card (SPEC-011 6.3). Sensitive fields are masked."""
    subscriptions = (
        db.query(Subscription)
        .filter(Subscription.user_id == user.id)
        .order_by(Subscription.created_at.desc())
        .limit(20)
        .all()
    )
    from app.habits.models import Habit, NotificationDelivery

    user_habits = db.query(Habit).filter(Habit.user_id == user.id).count()
    last_activity = (
        db.query(NotificationDelivery).filter(NotificationDelivery.user_id == user.id).order_by(NotificationDelivery.scheduled_at.desc()).first()
    )
    recent_actions = (
        db.query(models.AdminAuditLog)
        .filter(models.AdminAuditLog.resource_id == user.id)
        .order_by(models.AdminAuditLog.created_at.desc())
        .limit(10)
        .all()
    )
    return {
        "id": str(user.id),
        "email": mask_email(user.email),
        "first_name": user.first_name,
        "last_name": user.last_name,
        "status": "BLOCKED" if not user.is_active else ("DELETED" if user.deleted_at else "ACTIVE"),
        "registered_at": user.created_at.isoformat() if user.created_at else None,
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
        "timezone": user.timezone,
        "telegram": {
            "bound": bool(user.telegram_chat_id),
            "chat_id": mask_telegram_id(user.telegram_chat_id),
            "notifications_enabled": user.telegram_notifications_enabled,
        },
        "roles": {"current": user.role, "source": user.role_source},
        "plan": None,  # filled by caller when a plan exists
        "subscriptions": [
            {
                "id": str(s.id),
                "plan_code": s.plan_code,
                "status": s.status.value,
                "period_start": s.period_start.isoformat() if s.period_start else None,
                "period_end": s.period_end.isoformat() if s.period_end else None,
            }
            for s in subscriptions
        ],
        "habits_count": user_habits,
        "last_notification_at": last_activity.scheduled_at.isoformat() if last_activity else None,
        "recent_admin_actions": [
            {
                "id": str(a.id),
                "actor_role": a.actor_role,
                "action": a.action,
                "result": a.result.value,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
            for a in recent_actions
        ],
    }


@router.get("")
def list_users(
    request: Request,
    q: Optional[str] = None,
    status_filter: Optional[str] = None,
    role: Optional[str] = None,
    page: int = 1,
    pageSize: int = 20,
    sort: Optional[str] = None,
    db: Session = Depends(get_db),
    user: User = Depends(auth.require_permission("users:read")),
):
    """Search by internal id, masked Telegram id, email, name, status."""
    reject_unknown_query_params(request)
    page, page_size, sort = paginate_params(page, pageSize, sort)

    query = db.query(User).filter(User.deleted_at.is_(None))
    if q:
        q = q.strip()
        like = f"%{q}%"
        id_match = None
        try:
            id_match = User.id == PyUUID(q)
        except (ValueError, TypeError):
            pass
        query = query.filter(
            or_(
                User.email.ilike(like),
                User.first_name.ilike(like),
                User.last_name.ilike(like),
                id_match,
            )
        )
    if status_filter:
        if status_filter == "ACTIVE":
            query = query.filter(User.is_active.is_(True))
        elif status_filter == "BLOCKED":
            query = query.filter(User.is_active.is_(False))
        elif status_filter == "DELETED":
            query = query.filter(User.deleted_at.isnot(None))
        else:
            raise err_response("VALIDATION_ERROR", "status must be ACTIVE|BLOCKED|DELETED", 400)
    if role:
        if role not in ("user", *ADMIN_ROLES):
            raise err_response("VALIDATION_ERROR", "unknown role", 400)
        query = query.filter(User.role == role)

    total = query.count()
    if sort and sort.startswith("-"):
        col_name = sort[1:]
        col = getattr(User, col_name, None)
        items = query.order_by(col.desc() if col else User.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    else:
        col_name = sort or "created_at"
        col = getattr(User, col_name, None)
        items = query.order_by(col.desc() if col else User.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()

    return ok(
        {
            "items": [
                {
                    "id": str(u.id),
                    "email": mask_email(u.email),
                    "first_name": u.first_name,
                    "last_name": u.last_name,
                    "role": u.role,
                    "status": "BLOCKED" if not u.is_active else "ACTIVE",
                    "created_at": u.created_at.isoformat() if u.created_at else None,
                    "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
                }
                for u in items
            ],
            "page": page,
            "pageSize": page_size,
            "total": total,
        }
    )


@router.post("/bulk/block")
def bulk_block(
    payload: BulkBlockRequest,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("bulk:execute", critical=True)),
):
    """Mass action: preview -> confirm -> execution (SPEC-011 6.3, 9.4)."""
    if payload.preview:
        ids = list(dict.fromkeys(payload.user_ids))
        count = db.query(User).filter(User.id.in_(ids), User.is_active.is_(True), User.deleted_at.is_(None)).count()
        write_admin_audit(
            db,
            actor=actor,
            action="admin.bulk.previewed",
            resource_type="user",
            result=models.AuditResult.SUCCESS,
            reason=f"bulk block preview: {count} of {len(ids)}",
            request_id=getattr(request.state, "request_id", "unknown"),
        )
        return ok({"preview": True, "affected_count": count, "requested_count": len(ids)})

    require_confirm(payload, settings)
    if not payload.reason or len(payload.reason.strip()) < 10:
        raise err_response("VALIDATION_ERROR", "reason is required for execution (min 10 chars)", 400)
    ids = list(dict.fromkeys(payload.user_ids))
    targets = (
        db.query(User).filter(User.id.in_(ids), User.is_active.is_(True), User.deleted_at.is_(None)).all()
    )
    super_targets = [u for u in targets if u.role == "super_admin"]
    for u in super_targets:
        _guard_last_super_admin(db, u)

    blocked = []
    for u in targets:
        before = {"status": "ACTIVE"}
        u.is_active = False
        blocked.append(str(u.id))
    db.commit()
    write_admin_audit(
        db,
        actor=actor,
        action="admin.bulk.executed",
        resource_type="user",
        result=models.AuditResult.SUCCESS,
        reason=f"bulk block: {len(blocked)} users. {payload.reason[:200]}",
        request_id=getattr(request.state, "request_id", "unknown"),
        ip_hash=ip_hash(request.client.host if request.client else None, settings.AUDIT_IP_SALT),
        before_summary={"count": len(blocked)},
        after_summary={"blocked": blocked[:50], "count": len(blocked)},
    )
    return ok({"executed": True, "blocked_count": len(blocked), "user_ids": blocked})


@router.get("/{user_id}")
def get_user(
    user_id: PyUUID,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("users:read")),
):
    user = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).first()
    if not user:
        raise err_response("NOT_FOUND", "User not found", 404)
    card = _user_card(db, user, request)
    # IDOR guard: role info for admin-role users is only visible to admins
    if user.role in ("admin", "super_admin") and actor.role == "content_manager":
        raise err_response("FORBIDDEN", "Not enough privileges", 403)
    return ok(card)


def _guard_last_super_admin(db: Session, target: User) -> None:
    """SPEC-011 6.3: the last active SUPER_ADMIN cannot be blocked/deleted."""
    if target.role == "super_admin":
        active_supers = (
            db.query(User)
            .filter(User.role == "super_admin", User.is_active.is_(True), User.deleted_at.is_(None))
            .count()
        )
        if active_supers <= 1:
            raise err_response("LAST_SUPER_ADMIN", "Cannot block the last active SUPER_ADMIN", 409)


@router.post("/{user_id}/block")
def block_user(
    user_id: PyUUID,
    payload: BlockRequest,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("users:block", critical=True)),
):
    require_confirm(payload, settings)
    user = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).first()
    if not user:
        raise err_response("NOT_FOUND", "User not found", 404)
    if not user.is_active:
        raise err_response("ALREADY_BLOCKED", "User is already blocked", 409)
    if user.id == actor.id and user.role == "super_admin":
        raise err_response("FORBIDDEN", "You cannot block yourself", 409)
    _guard_last_super_admin(db, user)

    before = {"status": "ACTIVE", "role": user.role}
    user.is_active = False
    db.commit()
    # Blocking never touches workout/payment/subscription history (SPEC-011 6.3).
    write_admin_audit(
        db,
        actor=actor,
        action="admin.user.blocked",
        resource_type="user",
        resource_id=user.id,
        reason=payload.reason,
        request_id=getattr(request.state, "request_id", "unknown"),
        ip_hash=ip_hash(request.client.host if request.client else None, settings.AUDIT_IP_SALT),
        before_summary=before,
        after_summary={"status": "BLOCKED"},
    )
    return ok({"id": str(user.id), "status": "BLOCKED"})


@router.post("/{user_id}/unblock")
def unblock_user(
    user_id: PyUUID,
    payload: UnblockRequest,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("users:block", critical=True)),
):
    require_confirm(payload, settings)
    user = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).first()
    if not user:
        raise err_response("NOT_FOUND", "User not found", 404)
    if user.is_active:
        raise err_response("ALREADY_ACTIVE", "User is already active", 409)

    before = {"status": "BLOCKED"}
    user.is_active = True
    db.commit()
    write_admin_audit(
        db,
        actor=actor,
        action="admin.user.unblocked",
        resource_type="user",
        resource_id=user.id,
        reason=payload.reason,
        request_id=getattr(request.state, "request_id", "unknown"),
        ip_hash=ip_hash(request.client.host if request.client else None, settings.AUDIT_IP_SALT),
        before_summary=before,
        after_summary={"status": "ACTIVE"},
    )
    return ok({"id": str(user.id), "status": "ACTIVE"})


@router.post("/{user_id}/roles")
def assign_role(
    user_id: PyUUID,
    payload: RoleAssignRequest,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("users:roles", critical=True)),
):
    """Assign a role from the allowed set. ADMIN cannot grant SUPER_ADMIN (11.1)."""
    require_confirm(payload, settings)
    if payload.role not in ("user", *ADMIN_ROLES):
        raise err_response("VALIDATION_ERROR", f"Unknown role: {payload.role}", 400)
    if payload.role == "super_admin" and actor.role != "super_admin":
        write_admin_audit(
            db,
            actor=actor,
            action="admin.role.changed",
            resource_type="user",
            resource_id=user_id,
            result=models.AuditResult.DENIED,
            reason="ADMIN cannot grant SUPER_ADMIN",
            request_id=getattr(request.state, "request_id", "unknown"),
        )
        raise err_response("FORBIDDEN", "Cannot assign SUPER_ADMIN", 403)
    if not can_assign_role(actor.role, payload.role):
        raise err_response("FORBIDDEN", "Cannot assign a role above your own", 403)

    user = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).first()
    if not user:
        raise err_response("NOT_FOUND", "User not found", 404)
    if user.role == "super_admin" and payload.role != "super_admin" and actor.role != "super_admin":
        raise err_response("FORBIDDEN", "Only SUPER_ADMIN can demote a SUPER_ADMIN", 403)

    before = {"role": user.role, "role_source": user.role_source}
    user.role = payload.role
    user.role_source = f"admin:{actor.id}"
    db.commit()
    write_admin_audit(
        db,
        actor=actor,
        action="admin.role.changed",
        resource_type="user",
        resource_id=user.id,
        reason=f"role {before['role']} -> {payload.role}",
        request_id=getattr(request.state, "request_id", "unknown"),
        ip_hash=ip_hash(request.client.host if request.client else None, settings.AUDIT_IP_SALT),
        before_summary=before,
        after_summary={"role": user.role, "role_source": user.role_source},
    )
    return ok({"id": str(user.id), "role": user.role, "role_source": user.role_source})


@router.delete("/{user_id}/roles/{role}")
def remove_role(
    user_id: PyUUID,
    role: str,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("users:roles", critical=True)),
):
    if role not in ADMIN_ROLES:
        raise err_response("VALIDATION_ERROR", f"Unknown admin role: {role}", 400)
    if role == "super_admin" and actor.role != "super_admin":
        raise err_response("FORBIDDEN", "Only SUPER_ADMIN can remove SUPER_ADMIN", 403)
    user = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).first()
    if not user:
        raise err_response("NOT_FOUND", "User not found", 404)
    if user.role != role:
        raise err_response("NOT_FOUND", "User does not have this role", 404)
    if user.role == "super_admin":
        _guard_last_super_admin(db, user)

    before = {"role": user.role, "role_source": user.role_source}
    user.role = "user"
    user.role_source = f"admin:{actor.id}"
    db.commit()
    write_admin_audit(
        db,
        actor=actor,
        action="admin.role.changed",
        resource_type="user",
        resource_id=user.id,
        reason=f"removed role {role}",
        request_id=getattr(request.state, "request_id", "unknown"),
        ip_hash=ip_hash(request.client.host if request.client else None, settings.AUDIT_IP_SALT),
        before_summary=before,
        after_summary={"role": user.role},
    )
    return ok({"id": str(user.id), "role": user.role})


@router.post("/{user_id}/soft-delete")
def soft_delete_user(
    user_id: PyUUID,
    payload: SoftDeleteUserRequest,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("users:delete", critical=True)),
):
    """Soft delete (+optional anonymization). Physical deletion is impossible from the UI (SPEC-011 6.3)."""
    require_confirm(payload, settings)
    user = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).first()
    if not user:
        raise err_response("NOT_FOUND", "User not found", 404)
    if user.id == actor.id:
        raise err_response("FORBIDDEN", "You cannot delete yourself", 409)
    if user.role == "super_admin":
        _guard_last_super_admin(db, user)

    before = {"status": "ACTIVE" if user.is_active else "BLOCKED", "role": user.role}
    user.deleted_at = datetime.utcnow()
    if payload.anonymize:
        user.first_name = None
        user.last_name = None
        user.telegram_chat_id = None
        user.telegram_notifications_enabled = False
    db.commit()
    write_admin_audit(
        db,
        actor=actor,
        action="admin.user.soft_deleted",
        resource_type="user",
        resource_id=user.id,
        reason=payload.reason,
        request_id=getattr(request.state, "request_id", "unknown"),
        ip_hash=ip_hash(request.client.host if request.client else None, settings.AUDIT_IP_SALT),
        before_summary=before,
        after_summary={"status": "DELETED", "anonymized": payload.anonymize},
    )
    return ok({"id": str(user.id), "status": "DELETED"})


@router.get("/{user_id}/audit")
def user_audit_history(
    user_id: PyUUID,
    request: Request,
    page: int = 1,
    pageSize: int = 20,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("audit:read")),
):
    reject_unknown_query_params(request)
    page, page_size, _ = paginate_params(page, pageSize, None)
    query = db.query(models.AdminAuditLog).filter(models.AdminAuditLog.resource_id == user_id)
    total = query.count()
    items = query.order_by(models.AdminAuditLog.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return ok(
        {
            "items": [
                {
                    "id": str(a.id),
                    "actor_user_id": str(a.actor_user_id),
                    "actor_role": a.actor_role,
                    "action": a.action,
                    "result": a.result.value,
                    "reason": a.reason,
                    "request_id": a.request_id,
                    "created_at": a.created_at.isoformat() if a.created_at else None,
                    "before_summary": a.before_summary,
                    "after_summary": a.after_summary,
                }
                for a in items
            ],
            "page": page,
            "pageSize": page_size,
            "total": total,
        }
    )
