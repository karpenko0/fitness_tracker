"""Admin authentication (SPEC-011 6.1): separate admin endpoint, admin session with
idle tracking, step-up for critical actions, MFA-ready login flow."""
import hashlib
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt
from sqlalchemy.orm import Session
from uuid import UUID as PyUUID

from app.config import get_settings
from app.database import get_db
from app.models.user import ADMIN_ROLES, User
from app.services.auth import decode_access_token, get_password_hash, verify_password

from . import models
from .masking import ip_hash, user_agent_hash

settings = get_settings()

security = HTTPBearer(auto_error=False)

# Action -> audit event naming (SPEC-011 10)
ADMIN_TOKEN_TYPE = "admin"


def _utcnow() -> datetime:
    return datetime.utcnow()


def _client_ip(request: Request) -> Optional[str]:
    if request.client:
        return request.client.host
    return None


def create_admin_token(user_id, session_id: uuid.UUID, role: str, expires_hours: Optional[int] = None) -> str:
    expire = _utcnow() + timedelta(hours=expires_hours or settings.ADMIN_TOKEN_HOURS)
    payload = {
        "sub": str(user_id),
        "sid": str(session_id),
        "role": role,
        "typ": ADMIN_TOKEN_TYPE,
        "exp": expire,
        "iat": _utcnow(),
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def hash_mfa_code(code: str) -> str:
    return hashlib.sha256(f"mfa:{settings.JWT_SECRET_KEY}:{code}".encode()).hexdigest()


def check_mfa_code(code: str, challenge) -> bool:
    """MFA verification hook (SPEC-011 14.1 — provider is an open decision).

    - Development only: a fixed dev code may be accepted when ADMIN_MFA_DEV_CODE is set.
    - Production without a configured verifier: fail closed (never accept).
    """
    if settings.ENVIRONMENT == "production":
        # No provider configured in this iteration: MFA logins fail closed.
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail={"code": "MFA_NOT_CONFIGURED", "message": "MFA provider is not configured for production"},
        )
    if settings.ADMIN_MFA_DEV_CODE and code == settings.ADMIN_MFA_DEV_CODE:
        return True
    return False


def issue_admin_session(db: Session, user: User, request: Request) -> models.AdminSession:
    """Create an ACTIVE admin session for a verified admin user."""
    session = models.AdminSession(
        user_id=user.id,
        role=user.role,
        status=models.AdminSessionStatus.ACTIVE,
        last_activity_at=_utcnow(),
        ip_hash=ip_hash(_client_ip(request), settings.AUDIT_IP_SALT),
        user_agent_hash=user_agent_hash(request.headers.get("User-Agent"), settings.AUDIT_IP_SALT),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def start_login(db: Session, user: User, request: Request) -> dict:
    """First login step: returns either the token or an MFA challenge request."""
    if settings.ADMIN_MFA_ENABLED and user.mfa_required:
        challenge = models.AdminMfaChallenge(
            user_id=user.id,
            method="app_push_stub",
            code_hash=hash_mfa_code(""),  # replaced when the provider delivers the code (MFA-ready stub)
            expires_at=_utcnow() + timedelta(seconds=settings.ADMIN_MFA_WINDOW_SECONDS),
        )
        # In dev mode the challenge code is fixed (ADMIN_MFA_DEV_CODE); re-hash it.
        if settings.ENVIRONMENT != "production" and settings.ADMIN_MFA_DEV_CODE:
            challenge.code_hash = hash_mfa_code(settings.ADMIN_MFA_DEV_CODE)
        db.add(challenge)
        db.commit()
        db.refresh(challenge)
        return {"mfa_required": True, "challenge_id": str(challenge.id)}

    session = issue_admin_session(db, user, request)
    token = create_admin_token(user.id, session.id, user.role)
    return {"mfa_required": False, "access_token": token, "admin_session_id": str(session.id)}


def finish_mfa_login(db: Session, user: User, request: Request, challenge_id: PyUUID, code: str) -> dict:
    challenge = db.query(models.AdminMfaChallenge).filter(models.AdminMfaChallenge.id == challenge_id).first()
    if not challenge or challenge.consumed or challenge.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": "MFA_INVALID_CHALLENGE"})
    if challenge.is_expired():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": "MFA_EXPIRED"})
    if challenge.attempts >= settings.ADMIN_MFA_MAX_ATTEMPTS:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": "MFA_TOO_MANY_ATTEMPTS"})

    challenge.attempts += 1
    if not check_mfa_code(code, challenge) or challenge.code_hash != hash_mfa_code(code):
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": "MFA_INVALID_CODE"})

    challenge.consumed = True
    challenge.verified_at = _utcnow()
    session = issue_admin_session(db, user, request)
    token = create_admin_token(user.id, session.id, user.role)
    return {"mfa_required": False, "access_token": token, "admin_session_id": str(session.id)}


def _touch_session(db: Session, admin_session: models.AdminSession, now: datetime):
    idle_limit = timedelta(minutes=settings.ADMIN_SESSION_IDLE_MINUTES)
    if admin_session.last_activity_at and now - admin_session.last_activity_at > idle_limit:
        admin_session.status = models.AdminSessionStatus.IDLE
    admin_session.last_activity_at = now
    admin_session.version = (admin_session.version or 1) + 1
    db.add(admin_session)
    db.commit()


def get_current_admin(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    """Resolve the admin-panel caller: token, user, role, admin session (SPEC-011 6.1).

    Raises 401 for missing/invalid/expired/revoked tokens, 403 for non-admin users.
    """
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": "UNAUTHENTICATED"})

    try:
        payload = decode_access_token(credentials.credentials)
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": "INVALID_TOKEN"})

    if payload.get("typ") != ADMIN_TOKEN_TYPE:
        # A regular client token must never open admin endpoints
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"code": "FORBIDDEN"})

    try:
        user_id = PyUUID(str(payload.get("sub")))
        session_id = PyUUID(str(payload.get("sid")))
    except (ValueError, TypeError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": "INVALID_TOKEN"})

    user = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": "UNAUTHENTICATED"})
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": "UNAUTHENTICATED"})
    if user.role not in ADMIN_ROLES:
        # 11.1: user without admin role gets 403 FORBIDDEN
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"code": "FORBIDDEN"})

    admin_session = db.query(models.AdminSession).filter(models.AdminSession.id == session_id).first()
    if not admin_session or admin_session.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": "SESSION_NOT_FOUND"})
    if admin_session.status in (models.AdminSessionStatus.REVOKED, models.AdminSessionStatus.EXPIRED):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": "SESSION_REVOKED"})

    _touch_session(db, admin_session, _utcnow())
    request.state.admin_session = admin_session
    return user


def require_permission(permission: str, critical: bool = False):
    """FastAPI dependency: re-checks the permission on every request (deny-by-default).

    critical=True enforces step-up: an IDLE session must re-authenticate (SPEC-011 6.1.3).
    Denials are recorded in the admin audit log as admin.permission.denied.
    """

    def dependency(
        request: Request,
        user: User = Depends(get_current_admin),
        db: Session = Depends(get_db),
    ) -> User:
        if not has_permission(user.role, permission):
            _denied(db, request, user, permission)
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"code": "FORBIDDEN"})

        if critical:
            session = getattr(request.state, "admin_session", None)
            if session is None or session.status != models.AdminSessionStatus.ACTIVE:
                _denied(db, request, user, permission, reason="STEP_UP_REQUIRED")
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail={"code": "STEP_UP_REQUIRED", "message": "Сессия неактивна: войдите заново для критичного действия"},
                )
        return user

    return dependency


def has_permission(role: str, permission: str) -> bool:
    from .rbac import has_permission as _hp

    return _hp(role, permission)


def _denied(db: Session, request: Request, user: User, permission: str, reason: str | None = None):
    from .audit import write_admin_audit

    try:
        write_admin_audit(
            db,
            actor=user,
            action="admin.permission.denied",
            resource_type="permission",
            resource_id=None,
            result=models.AuditResult.DENIED,
            reason=reason or f"permission {permission} denied for role {user.role}",
            request_id=getattr(request, "request_id", "unknown"),
            ip_hash=ip_hash(_client_ip(request), settings.AUDIT_IP_SALT),
        )
    except Exception:
        # Audit failure must not mask the 403
        db.rollback()
