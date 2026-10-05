"""SPEC-011 11.1: access and RBAC."""
from datetime import datetime, timedelta
from uuid import UUID

from jose import jwt as pyjwt

from app.admin.models_core import AdminSession, AdminSessionStatus
from app.config import get_settings
from app.services.auth import decode_access_token


def test_non_admin_user_gets_403(actors):
    r = actors["admin_client"].get("/api/v1/admin/me", headers=actors["headers"]["user"])
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "FORBIDDEN"


def test_no_token_gets_401(actors):
    r = actors["admin_client"].get("/api/v1/admin/me")
    assert r.status_code == 401


def test_expired_token_gets_401(actors):
    settings = get_settings()
    token = pyjwt.encode(
        {
            "sub": str(actors["users"]["super_admin"].id),
            "sid": "00000000-0000-0000-0000-000000000000",
            "role": "super_admin",
            "typ": "admin",
            "exp": datetime.utcnow() - timedelta(hours=1),
        },
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )
    r = actors["admin_client"].get("/api/v1/admin/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401


def test_revoked_session_gets_401(actors, db_session):
    token = actors["tokens"]["super_admin"]
    payload = decode_access_token(token)
    session = db_session.query(AdminSession).filter(AdminSession.id == UUID(payload["sid"])).first()
    assert session is not None
    session.status = AdminSessionStatus.REVOKED
    db_session.commit()
    r = actors["admin_client"].get("/api/v1/admin/me", headers=actors["headers"]["super_admin"])
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "SESSION_REVOKED"


def test_client_role_login_admin_endpoint_forbidden(actors):
    r = actors["admin_client"].post(
        "/api/v1/admin/auth/login", json={"email": actors["users"]["user"].email, "password": "Passw0rd!"}
    )
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "FORBIDDEN"


def test_content_manager_cannot_see_users_billing_roles(actors):
    h = actors["headers"]["content_manager"]
    assert actors["admin_client"].get("/api/v1/admin/users", headers=h).status_code == 403
    assert actors["admin_client"].get("/api/v1/admin/billing/payments", headers=h).status_code == 403
    assert actors["admin_client"].get("/api/v1/admin/roles", headers=h).status_code == 403
    assert actors["admin_client"].get("/api/v1/admin/audit-logs", headers=h).status_code == 403
    # but content endpoints are allowed; promo codes are not (ADMIN+)
    assert actors["admin_client"].get("/api/v1/admin/exercises", headers=h).status_code == 200
    assert actors["admin_client"].get("/api/v1/admin/challenges", headers=h).status_code == 200
    assert actors["admin_client"].get("/api/v1/admin/promo-codes", headers=h).status_code == 403


def test_admin_cannot_assign_super_admin(actors, db_session):
    from tests.admin.conftest import make_user

    victim = make_user(db_session, "user")
    r = actors["admin_client"].post(
        f"/api/v1/admin/users/{victim.id}/roles",
        json={"role": "super_admin", "confirm": True},
        headers={**actors["headers"]["admin"], "Idempotency-Key": "t-cannot-sa-1"},
    )
    assert r.status_code == 403
    # denial is audited
    r = actors["admin_client"].get(
        "/api/v1/admin/audit-logs?action=admin.role.changed&result=DENIED", headers=actors["headers"]["admin"]
    )
    assert r.status_code == 200
    rows = r.json()["data"]["items"]
    assert any(row["resource_id"] == str(victim.id) for row in rows)


def test_unknown_role_deny_by_default(actors, db_session):
    from tests.admin.conftest import make_user

    u = make_user(db_session, "weird_role")
    r = actors["admin_client"].post("/api/v1/admin/auth/login", json={"email": u.email, "password": "Passw0rd!"})
    assert r.status_code == 403


def test_idle_session_requires_step_up(actors, db_session):
    from app.models import User

    token = actors["tokens"]["super_admin"]
    payload = decode_access_token(token)
    session_id = UUID(payload["sid"])

    def mark_idle():
        s = db_session.query(AdminSession).filter(AdminSession.id == session_id).first()
        s.last_activity_at = datetime.utcnow() - timedelta(minutes=31)
        db_session.commit()

    # revive: non-critical request after idle works and re-activates the session
    mark_idle()
    r = actors["admin_client"].get("/api/v1/admin/me", headers=actors["headers"]["super_admin"])
    assert r.status_code == 200

    # make it idle again; a CRITICAL action must now require fresh authentication
    mark_idle()
    victim = db_session.query(User).filter(User.role == "user").first()
    r = actors["admin_client"].post(
        f"/api/v1/admin/users/{victim.id}/block",
        json={"reason": "Step-up check reason", "confirm": True},
        headers={**actors["headers"]["super_admin"], "Idempotency-Key": "t-stepup-1"},
    )
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "STEP_UP_REQUIRED"


def test_privilege_escalation_via_body_rejected(actors, db_session):
    """role is assigned only by the dedicated endpoint (SPEC-011 12.4)."""
    from tests.admin.conftest import make_user

    u = make_user(db_session, "user")
    # unknown DTO field in the assign-role payload -> 400
    r = actors["admin_client"].post(
        f"/api/v1/admin/users/{u.id}/roles",
        json={"role": "admin", "confirm": True, "extra_role": "super_admin"},
        headers={**actors["headers"]["admin"], "Idempotency-Key": "t-esc-1"},
    )
    assert r.status_code == 400
    # ADMIN assigning super_admin via the dedicated endpoint -> 403
    r = actors["admin_client"].post(
        f"/api/v1/admin/users/{u.id}/roles",
        json={"role": "super_admin", "confirm": True},
        headers={**actors["headers"]["admin"], "Idempotency-Key": "t-esc-2"},
    )
    assert r.status_code == 403
