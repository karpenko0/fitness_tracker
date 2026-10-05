"""SPEC-011 11.9: analytics meta, audit log completeness, exports one-time/TTL."""
import time
from datetime import datetime, timedelta

from app.admin.models_core import AdminExport
from tests.admin.conftest import make_user


def test_analytics_meta_fields(actors):
    r = actors["admin_client"].get("/api/v1/admin/analytics/summary?period_days=30", headers=actors["headers"]["admin"])
    assert r.status_code == 200
    meta = r.json()["data"]["meta"]
    assert meta["period"]["end"]
    assert "source" in meta
    assert "updated_at" in meta
    assert "filters" in meta
    assert "min_segment_size" in meta


def test_analytics_segment_size_zero_returns_nulls(actors):
    """No habit activity -> sensitive per-user values must be None (min segment size, SPEC-011 7.3)."""
    r = actors["admin_client"].get("/api/v1/admin/analytics/summary?period_days=30", headers=actors["headers"]["admin"])
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["segment_size"] == 0
    assert data["active_users"]["dau"] is None
    assert data["subscriptions"]["active"] is None
    assert data["revenue"]["amount"] is None


def test_audit_log_fields_and_read_denied_for_cm(actors, db_session):
    u = make_user(db_session, "user")
    h = actors["headers"]["super_admin"]
    actors["admin_client"].post(
        f"/api/v1/admin/users/{u.id}/block",
        json={"reason": "Тестовая блокировка для аудита", "confirm": True},
        headers={**h, "Idempotency-Key": "t-au-1"},
    )

    r = actors["admin_client"].get("/api/v1/admin/audit-logs?resource_type=user", headers=h)
    assert r.status_code == 200
    row = next(
        x for x in r.json()["data"]["items"] if x["action"] == "admin.user.blocked" and x["resource_id"] == str(u.id)
    )
    assert row["actor_user_id"] == str(actors["users"]["super_admin"].id)
    assert row["actor_role"] == "super_admin"
    assert row["result"] == "SUCCESS"
    assert row["request_id"]
    assert row["created_at"]
    # the audit read itself is recorded
    r = actors["admin_client"].get("/api/v1/admin/audit-logs?action=admin.audit.read", headers=h)
    assert any(x["action"] == "admin.audit.read" for x in r.json()["data"]["items"])

    # CM cannot read audit logs
    r = actors["admin_client"].get("/api/v1/admin/audit-logs", headers=actors["headers"]["content_manager"])
    assert r.status_code == 403


def test_audit_search_by_request_id(actors, db_session):
    """SPEC-011 11: the operator can reconstruct every audit record for one request id."""
    u = make_user(db_session, "user")
    h = actors["headers"]["super_admin"]
    r = actors["admin_client"].post(
        f"/api/v1/admin/users/{u.id}/block",
        json={"reason": "Тестовая блокировка для поиска по requestId", "confirm": True},
        headers={**h, "Idempotency-Key": "t-au-rid"},
    )
    assert r.status_code == 200
    rid = r.headers["X-Request-Id"]

    r = actors["admin_client"].get(f"/api/v1/admin/audit-logs?request_id={rid}", headers=h)
    assert r.status_code == 200
    items = r.json()["data"]["items"]
    assert items, "expected audit rows for the block request id"
    assert all(x["request_id"] == rid for x in items)
    assert any(x["action"] == "admin.user.blocked" and x["resource_id"] == str(u.id) for x in items)


def test_audit_log_invalid_result_filter(actors):
    r = actors["admin_client"].get("/api/v1/admin/audit-logs?result=WEIRD", headers=actors["headers"]["super_admin"])
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


def _wait_for_export(actors, export_id, tries=20):
    h = actors["headers"]["admin"]
    for _ in range(tries):
        time.sleep(0.25)
        r = actors["admin_client"].get(f"/api/v1/admin/exports/{export_id}/download", headers=h)
        if r.status_code == 200:
            return r
    return r


def test_export_one_time_and_ttl(actors, db_session):
    from uuid import UUID

    make_user(db_session, "user")
    h = {**actors["headers"]["admin"], "Idempotency-Key": "t-xp-1"}
    r = actors["admin_client"].post("/api/v1/admin/exports", json={"entity_type": "users", "confirm": True}, headers=h)
    assert r.status_code == 201
    export_id = r.json()["data"]["id"]
    assert r.json()["data"]["ttl_minutes"] > 0

    r = _wait_for_export(actors, export_id)
    assert r.status_code == 200
    assert "email" in r.text  # header row present

    # one-time: second download fails
    r = actors["admin_client"].get(f"/api/v1/admin/exports/{export_id}/download", headers=actors["headers"]["admin"])
    assert r.status_code == 410
    assert r.json()["error"]["code"] == "ALREADY_DOWNLOADED"

    # TTL: expire a fresh export and try to download it
    r = actors["admin_client"].post("/api/v1/admin/exports", json={"entity_type": "users", "confirm": True}, headers={**h, "Idempotency-Key": "t-xp-2"})
    export_id2 = r.json()["data"]["id"]
    time.sleep(0.5)
    exp = db_session.query(AdminExport).filter(AdminExport.id == UUID(export_id2)).first()
    exp.expires_at = datetime.utcnow() - timedelta(seconds=1)
    db_session.commit()
    r = actors["admin_client"].get(f"/api/v1/admin/exports/{export_id2}/download", headers=actors["headers"]["admin"])
    assert r.status_code == 410
    assert r.json()["error"]["code"] in ("EXPIRED", "ALREADY_DOWNLOADED")  # expired before READY or after — both 410


def test_export_unknown_kind_rejected(actors):
    r = actors["admin_client"].post(
        "/api/v1/admin/exports", json={"entity_type": "secret", "confirm": True}, headers={**actors["headers"]["admin"], "Idempotency-Key": "t-xp-3"}
    )
    assert r.status_code == 400


def test_non_admin_cannot_export(actors):
    r = actors["admin_client"].post(
        "/api/v1/admin/exports", json={"entity_type": "users", "confirm": True}, headers={**actors["headers"]["content_manager"], "Idempotency-Key": "t-xp-4"}
    )
    assert r.status_code == 403
