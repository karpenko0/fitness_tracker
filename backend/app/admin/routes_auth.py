"""Admin auth routes (SPEC-011 6.1): separate login endpoint, MFA-ready flow, sessions, roles matrix."""
from datetime import datetime
from typing import Optional
from uuid import UUID as PyUUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models.user import ADMIN_ROLES, User
from app.services.auth import verify_password

from . import auth, models
from .audit import write_admin_audit
from .common import err_response, ok
from .masking import ip_hash, user_agent_hash
from .rbac import PERMISSIONS_BY_ROLE, permission_matrix_for_ui
from .schemas import LoginRequest, MfaVerifyRequest, RevokeSessionRequest

settings = get_settings()
router = APIRouter(prefix="/admin", tags=["admin-auth"])


def _login_event(db: Session, request: Request, user: User, success: bool, detail: Optional[dict] = None):
    write_admin_audit(
        db,
        actor=user,
        action="admin.login.success" if success else "admin.login.failed",
        resource_type="admin_session",
        resource_id=None,
        result=models.AuditResult.SUCCESS if success else models.AuditResult.DENIED,
        reason=(detail or {}).get("reason"),
        request_id=getattr(request.state, "request_id", "unknown"),
        ip_hash=ip_hash(request.client.host if request.client else None, settings.AUDIT_IP_SALT),
        commit=False,
    )
    db.commit()


@router.post("/auth/login")
def admin_login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    """Separate admin login (SPEC-011 6.1.1). Never trust the UI: backend re-checks
    password, account status and admin role."""
    user = db.query(User).filter(User.email == payload.email, User.deleted_at.is_(None)).first()
    if not user or not verify_password(payload.password, user.password_hash):
        # Audit the failed attempt only when the account exists (actor_user_id is NOT NULL,
        # FK users.id — an unknown email cannot be attributed).
        if user:
            _login_event(db, request, user, success=False, detail={"reason": "invalid credentials"})
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": "INVALID_CREDENTIALS"})

    if not user.is_active:
        _login_event(db, request, user, success=False, detail={"reason": "account blocked"})
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": "ACCOUNT_BLOCKED"})

    if user.role not in ADMIN_ROLES:
        # 11.1: user without admin role -> 403 FORBIDDEN
        _login_event(db, request, user, success=False, detail={"reason": "no admin role"})
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"code": "FORBIDDEN"})

    result = auth.start_login(db, user, request)
    user.last_login_at = datetime.utcnow()
    db.commit()
    _login_event(db, request, user, success=True)

    data = {
        "role": user.role,
        "user_id": str(user.id),
    }
    if result.get("mfa_required"):
        data.update({"mfa_required": True, "challenge_id": result["challenge_id"]})
    else:
        data.update({"access_token": result["access_token"], "token_type": "bearer", "admin_session_id": result["admin_session_id"]})
    return ok(data)


@router.post("/auth/mfa/verify")
def admin_mfa_verify(payload: MfaVerifyRequest, request: Request, db: Session = Depends(get_db)):
    """MFA-ready step: verify the challenge code and issue the admin token."""
    user = db.query(User).filter(User.email == payload.email, User.deleted_at.is_(None)).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": "INVALID_CREDENTIALS"})
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"code": "FORBIDDEN"})

    result = auth.finish_mfa_login(db, user, request, payload.challenge_id, payload.code)
    _login_event(db, request, user, success=True, detail={"reason": "mfa verified"})
    return ok(
        {
            "role": user.role,
            "user_id": str(user.id),
            "access_token": result["access_token"],
            "token_type": "bearer",
            "admin_session_id": result["admin_session_id"],
        }
    )


@router.get("/sessions")
def list_admin_sessions(
    request: Request,
    user: User = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
):
    sessions = (
        db.query(models.AdminSession)
        .filter(models.AdminSession.user_id == user.id, models.AdminSession.status != models.AdminSessionStatus.EXPIRED)
        .order_by(models.AdminSession.created_at.desc())
        .all()
    )
    return ok(
        [
            {
                "id": str(s.id),
                "status": s.status.value,
                "last_activity_at": s.last_activity_at.isoformat() if s.last_activity_at else None,
                "created_at": s.created_at.isoformat() if s.created_at else None,
                "is_current": str(s.id) == str(getattr(request.state, "admin_session", None) and request.state.admin_session.id),
            }
            for s in sessions
        ]
    )


@router.post("/sessions/{session_id}/revoke")
def revoke_admin_session(
    session_id: PyUUID,
    payload: RevokeSessionRequest,
    request: Request,
    user: User = Depends(auth.require_permission("users:admin_session_revoke", critical=True)),
    db: Session = Depends(get_db),
):
    from .common import require_confirm

    require_confirm(payload, settings)

    # An admin may revoke their own sessions or (ADMIN/SUPER_ADMIN) sessions of users they can view
    session = db.query(models.AdminSession).filter(models.AdminSession.id == session_id).first()
    if not session:
        raise err_response("NOT_FOUND", "Session not found", 404)

    if session.user_id != user.id and not user.role in ("admin", "super_admin"):
        raise err_response("FORBIDDEN", "You can only revoke your own sessions", 403)
    if session.user_id != user.id and session.role in ("admin", "super_admin") and user.role == "admin":
        raise err_response("FORBIDDEN", "ADMIN cannot revoke another admin's session", 403)

    target = db.query(User).filter(User.id == session.user_id).first()
    before = {"status": session.status.value}
    session.status = models.AdminSessionStatus.REVOKED
    session.revoked_at = datetime.utcnow()
    db.commit()
    write_admin_audit(
        db,
        actor=user,
        action="admin.session.revoked",
        resource_type="admin_session",
        resource_id=session.id,
        reason=payload.reason if hasattr(payload, "reason") else None,
        request_id=getattr(request.state, "request_id", "unknown"),
        ip_hash=ip_hash(request.client.host if request.client else None, settings.AUDIT_IP_SALT),
        before_summary=before,
        after_summary={"status": session.status.value},
    )
    return ok({"revoked": True, "session_id": str(session.id)})


@router.get("/roles")
def roles_matrix(
    request: Request,
    user: User = Depends(auth.require_permission("roles:read")),
):
    """Roles and permissions matrix (SPEC-011 6.4)."""
    return ok(
        {
            "roles": [
                {
                    "role": r,
                    "permissions": sorted(PERMISSIONS_BY_ROLE.get(r, set())),
                }
                for r in (
                    "content_manager",
                    "admin",
                    "super_admin",
                )
            ],
            "current_role": user.role,
        }
    )


@router.get("/me")
def admin_me(request: Request, user: User = Depends(auth.get_current_admin)):
    return ok(
        {
            "user_id": str(user.id),
            "email": user.email,
            "role": user.role,
            "role_source": user.role_source,
            "mfa_required": user.mfa_required,
            "permissions": sorted(PERMISSIONS_BY_ROLE.get(user.role, set())),
        }
    )
