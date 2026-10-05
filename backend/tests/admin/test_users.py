"""SPEC-011 11.3: block/unblock flow, roles, masking, bulk operations."""
import time

from tests.admin.conftest import make_user


def test_user_list_search_and_masking(actors, db_session):
    make_user(db_session, "user", email="findme@example.com", telegram_chat_id="777000111")
    r = actors["admin_client"].get("/api/v1/admin/users?q=findme@example.com", headers=actors["headers"]["admin"])
    assert r.status_code == 200
    items = r.json()["data"]["items"]
    assert len(items) == 1
    # email is masked in the list
    assert items[0]["email"] == "f***@example.com"
    # telegram chat id is masked in the card
    r = actors["admin_client"].get(f"/api/v1/admin/users/{items[0]['id']}", headers=actors["headers"]["admin"])
    assert r.status_code == 200
    card = r.json()["data"]
    assert "777000111" not in r.text
    assert card["telegram"]["chat_id"].endswith("111")
    assert card["telegram"]["chat_id"] != "777000111"


def test_block_requires_reason_and_confirm(actors, db_session):
    u = make_user(db_session, "user")
    h = actors["headers"]["super_admin"]
    r = actors["admin_client"].post(
        f"/api/v1/admin/users/{u.id}/block", json={"reason": "short", "confirm": True}, headers={**h, "Idempotency-Key": "t-bl-1"}
    )
    assert r.status_code == 400
    r = actors["admin_client"].post(
        f"/api/v1/admin/users/{u.id}/block",
        json={"reason": "Спам и нарушение правил", "confirm": False},
        headers={**h, "Idempotency-Key": "t-bl-2"},
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "CONFIRMATION_REQUIRED"


def test_block_unblock_flow_with_audit(actors, db_session):
    u = make_user(db_session, "user")
    h = actors["headers"]["super_admin"]
    r = actors["admin_client"].post(
        f"/api/v1/admin/users/{u.id}/block",
        json={"reason": "Спам и нарушение правил", "confirm": True},
        headers={**h, "Idempotency-Key": "t-bl-3"},
    )
    assert r.status_code == 200
    assert r.json()["data"]["status"] == "BLOCKED"
    db_session.refresh(u)
    assert u.is_active is False

    # audit contains before/after
    r = actors["admin_client"].get("/api/v1/admin/audit-logs?action=admin.user.blocked", headers=h)
    rows = r.json()["data"]["items"]
    assert any(
        row["before_summary"]["status"] == "ACTIVE" and row["after_summary"] == {"status": "BLOCKED"} for row in rows
    )

    # unblock
    r = actors["admin_client"].post(
        f"/api/v1/admin/users/{u.id}/unblock", json={"confirm": True}, headers={**h, "Idempotency-Key": "t-bl-4"}
    )
    assert r.status_code == 200
    db_session.refresh(u)
    assert u.is_active is True


def test_blocked_user_cannot_use_client_app(actors, db_session):
    u = actors["users"]["user"]
    h = actors["headers"]["super_admin"]
    actors["admin_client"].post(
        f"/api/v1/admin/users/{u.id}/block",
        json={"reason": "Нарушение правил сервиса", "confirm": True},
        headers={**h, "Idempotency-Key": "t-bl-5"},
    )
    # client request with the user's own token is rejected
    r = actors["admin_client"].get(
        "/api/v1/users/me", headers={"Authorization": f"Bearer {actors['tokens']['client']['user']}"}
    )
    assert r.status_code == 403
    # history is preserved (no physical delete)
    db_session.refresh(u)
    assert u.is_active is False and u.deleted_at is None


def test_self_block_forbidden_and_last_super_admin(actors, db_session):
    sa_id = actors["users"]["super_admin"].id
    # a SUPER_ADMIN cannot block themselves
    r = actors["admin_client"].post(
        f"/api/v1/admin/users/{sa_id}/block",
        json={"reason": "Trying to lock out myself", "confirm": True},
        headers={**actors["headers"]["super_admin"], "Idempotency-Key": "t-lsa-1"},
    )
    assert r.status_code == 409

    # an ADMIN can block a second SUPER_ADMIN while another SUPER_ADMIN is active
    second = make_user(db_session, "super_admin")
    r = actors["admin_client"].post(
        f"/api/v1/admin/users/{second.id}/block",
        json={"reason": "Вторая супер-админка блокируется", "confirm": True},
        headers={**actors["headers"]["admin"], "Idempotency-Key": "t-lsa-2"},
    )
    assert r.status_code == 200

    # the first SA is now the only active SUPER_ADMIN -> nobody may block it
    r = actors["admin_client"].post(
        f"/api/v1/admin/users/{sa_id}/block",
        json={"reason": "Последний супер админ", "confirm": True},
        headers={**actors["headers"]["admin"], "Idempotency-Key": "t-lsa-3"},
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "LAST_SUPER_ADMIN"


def test_admin_cannot_demote_super_admin(actors, db_session):
    from app.models import User

    sa2 = make_user(db_session, "super_admin")
    r = actors["admin_client"].post(
        f"/api/v1/admin/users/{sa2.id}/roles",
        json={"role": "admin", "confirm": True},
        headers={**actors["headers"]["admin"], "Idempotency-Key": "t-demote-1"},
    )
    assert r.status_code == 403
    db_session.refresh(sa2)
    assert sa2.role == "super_admin"


def test_role_assign_records_source(actors, db_session):
    u = make_user(db_session, "user")
    r = actors["admin_client"].post(
        f"/api/v1/admin/users/{u.id}/roles",
        json={"role": "content_manager", "confirm": True},
        headers={**actors["headers"]["admin"], "Idempotency-Key": "t-rs-1"},
    )
    assert r.status_code == 200
    assert r.json()["data"]["role"] == "content_manager"
    assert r.json()["data"]["role_source"].startswith("admin:")
    db_session.refresh(u)
    assert u.role == "content_manager"
    assert u.role_source.startswith("admin:")


def test_bulk_block_preview_then_execute(actors, db_session):
    victims = [make_user(db_session, "user") for _ in range(3)]
    h = actors["headers"]["admin"]
    r = actors["admin_client"].post(
        "/api/v1/admin/users/bulk/block",
        json={"user_ids": [str(v.id) for v in victims], "reason": "Массовая чистка спама", "preview": True},
        headers={**h, "Idempotency-Key": "t-bulk-1"},
    )
    assert r.status_code == 200
    assert r.json()["data"]["affected_count"] == 3

    r = actors["admin_client"].post(
        "/api/v1/admin/users/bulk/block",
        json={"user_ids": [str(v.id) for v in victims], "reason": "Массовая чистка спама", "confirm": True},
        headers={**h, "Idempotency-Key": "t-bulk-2"},
    )
    assert r.status_code == 200
    assert r.json()["data"]["blocked_count"] == 3
    # audited
    r = actors["admin_client"].get("/api/v1/admin/audit-logs?action=admin.bulk.executed", headers=h)
    assert any(row["after_summary"]["count"] == 3 for row in r.json()["data"]["items"])


def test_export_endpoint_masks_sensitive_data(actors, db_session):
    make_user(db_session, "user", email="exportme@example.com", telegram_chat_id="555000222")
    h = {**actors["headers"]["admin"], "Idempotency-Key": "t-exp-1"}
    r = actors["admin_client"].post("/api/v1/admin/exports", json={"entity_type": "users", "confirm": True}, headers=h)
    assert r.status_code == 201
    export_id = r.json()["data"]["id"]
    body = None
    for _ in range(20):
        time.sleep(0.25)
        r = actors["admin_client"].get(f"/api/v1/admin/exports/{export_id}/download", headers=actors["headers"]["admin"])
        if r.status_code == 200:
            body = r.text
            break
    assert body is not None
    assert "exportme" not in body  # email masked in export
    assert "e***@example.com" in body
