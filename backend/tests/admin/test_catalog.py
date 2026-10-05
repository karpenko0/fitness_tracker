"""SPEC-011 11.7: catalogs, promo codes (limits, idempotent redemption), templates, campaigns, challenges."""
from datetime import date, timedelta

from tests.admin.conftest import make_user


def test_promo_percent_validation(actors):
    h = actors["headers"]["admin"]
    r = actors["admin_client"].post(
        "/api/v1/admin/promo-codes",
        json={"code": "OVER", "discount_type": "PERCENT", "discount_value": 101, "starts_at": "2026-01-01", "ends_at": "2026-12-31", "reason": "Перепроверка валидации"},
        headers={**h, "Idempotency-Key": "t-pr-1"},
    )
    assert r.status_code == 400
    # end before start
    r = actors["admin_client"].post(
        "/api/v1/admin/promo-codes",
        json={"code": "BAD", "discount_type": "PERCENT", "discount_value": 10, "starts_at": "2026-06-01", "ends_at": "2026-01-01", "reason": "Перепроверка валидации"},
        headers={**h, "Idempotency-Key": "t-pr-2"},
    )
    assert r.status_code == 400
    # negative discount is invalid (0 is the spec-allowed lower bound)
    r = actors["admin_client"].post(
        "/api/v1/admin/promo-codes",
        json={"code": "ZERO", "discount_type": "PERCENT", "discount_value": -5, "starts_at": "2026-01-01", "ends_at": "2026-12-31", "reason": "Перепроверка валидации"},
        headers={**h, "Idempotency-Key": "t-pr-3"},
    )
    assert r.status_code == 400


def test_promo_full_lifecycle_with_limit(actors, db_session):
    h = actors["headers"]["admin"]
    r = actors["admin_client"].post(
        "/api/v1/admin/promo-codes",
        json={
            "code": "LIMIT1",
            "discount_type": "PERCENT",
            "discount_value": 50,
            "starts_at": "2026-01-01",
            "ends_at": "2026-12-31",
            "max_uses": 1,
            "reason": "Код с ограничением в один раз",
        },
        headers={**h, "Idempotency-Key": "t-pl-1"},
    )
    assert r.status_code == 201
    code_id = r.json()["data"]["id"]
    assert actors["admin_client"].patch(f"/api/v1/admin/promo-codes/{code_id}", json={"status": "ACTIVE"}, headers={**h, "Idempotency-Key": "t-pl-2"}).status_code == 200

    u1 = make_user(db_session, "user")
    r = actors["admin_client"].post(
        f"/api/v1/admin/promo-codes/{code_id}/redeem",
        json={"user_id": str(u1.id), "idempotency_key": "red-1"},
        headers={**h, "Idempotency-Key": "t-pl-3"},
    )
    assert r.status_code == 200
    assert r.json()["data"]["already_applied"] is False

    # same idempotency key -> original result, no double count
    r = actors["admin_client"].post(
        f"/api/v1/admin/promo-codes/{code_id}/redeem",
        json={"user_id": str(u1.id), "idempotency_key": "red-1"},
        headers={**h, "Idempotency-Key": "t-pl-4"},
    )
    assert r.status_code == 200
    assert r.json()["data"]["already_applied"] is True

    # second user exceeds the limit (atomic counter + unique (code,user) guard)
    u2 = make_user(db_session, "user")
    r = actors["admin_client"].post(
        f"/api/v1/admin/promo-codes/{code_id}/redeem",
        json={"user_id": str(u2.id), "idempotency_key": "red-2"},
        headers={**h, "Idempotency-Key": "t-pl-5"},
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "LIMIT_REACHED"
    db_session.refresh(u2)


def test_promo_archive_cannot_reactivate_and_terms_audited(actors, db_session):
    h = actors["headers"]["admin"]
    r = actors["admin_client"].post(
        "/api/v1/admin/promo-codes",
        json={"code": "ARCH", "discount_type": "FIXED", "discount_value": 10, "starts_at": "2026-01-01", "ends_at": "2026-12-31", "reason": "Код для архивации теста"},
        headers={**h, "Idempotency-Key": "t-pa-1"},
    )
    code_id = r.json()["data"]["id"]
    actors["admin_client"].patch(f"/api/v1/admin/promo-codes/{code_id}", json={"status": "ACTIVE"}, headers={**h, "Idempotency-Key": "t-pa-2"})
    actors["admin_client"].patch(f"/api/v1/admin/promo-codes/{code_id}", json={"status": "ARCHIVED"}, headers={**h, "Idempotency-Key": "t-pa-3"})
    r = actors["admin_client"].patch(f"/api/v1/admin/promo-codes/{code_id}", json={"status": "ACTIVE"}, headers={**h, "Idempotency-Key": "t-pa-4"})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "ARCHIVED"
    # denied reactivation is audited
    r = actors["admin_client"].get("/api/v1/admin/audit-logs?action=admin.promo.disabled&result=DENIED", headers=h)
    assert any(row["resource_id"] == code_id for row in r.json()["data"]["items"])
    # limit changes are audited with before/after
    r = actors["admin_client"].patch(
        f"/api/v1/admin/promo-codes/{code_id}", json={"max_uses": 5}, headers={**h, "Idempotency-Key": "t-pa-5"}
    )
    assert r.status_code == 200
    r = actors["admin_client"].get("/api/v1/admin/audit-logs?action=admin.promo.terms_changed", headers=h)
    assert any(row["resource_id"] == code_id and row["before_summary"]["max_uses"] != row["after_summary"]["max_uses"] for row in r.json()["data"]["items"])


def test_template_rejects_unknown_variables(actors):
    h = actors["headers"]["admin"]
    r = actors["admin_client"].post(
        "/api/v1/admin/notifications",
        json={
            "name": "Приветствие",
            "event": "welcome",
            "channels": ["TELEGRAM"],
            "templates": {"ru": "Привет, {password} и {user_name}!"},
        },
        headers={**h, "Idempotency-Key": "t-tpl-1"},
    )
    assert r.status_code == 400
    assert "{password}" in str(r.json()["error"]["details"])


def test_campaign_preview_confirm_no_resend(actors, db_session):
    h = actors["headers"]["admin"]
    # template must be ACTIVE for a campaign
    r = actors["admin_client"].post(
        "/api/v1/admin/notifications",
        json={
            "name": "Напоминание",
            "event": "remind",
            "channels": ["TELEGRAM"],
            "templates": {"ru": "Привет, {user_name}! Начни {workout_name}."},
        },
        headers={**h, "Idempotency-Key": "t-cmp-1"},
    )
    assert r.status_code == 201
    tpl_id = r.json()["data"]["id"]
    actors["admin_client"].patch(f"/api/v1/admin/notifications/{tpl_id}", json={"status": "ACTIVE"}, headers={**h, "Idempotency-Key": "t-cmp-1b"})
    make_user(db_session, "user")  # at least one regular active user

    r = actors["admin_client"].post(
        "/api/v1/admin/notifications/campaigns",
        json={"template_id": tpl_id, "name": "Еженедельное напоминание", "reason": "Плановая рассылка"},
        headers={**h, "Idempotency-Key": "t-cmp-2"},
    )
    assert r.status_code == 201, r.text
    camp_id = r.json()["data"]["id"]
    # sending is a SUPER_ADMIN permission (notifications:send)
    hs = {**actors["headers"]["super_admin"], "Idempotency-Key": "t-cmp-3"}

    # confirm before preview is invalid
    r = actors["admin_client"].post(
        f"/api/v1/admin/notifications/campaigns/{camp_id}/confirm", json={"confirm": True}, headers=hs
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "INVALID_TRANSITION"

    r = actors["admin_client"].post(f"/api/v1/admin/notifications/campaigns/{camp_id}/preview", json={}, headers={**h, "Idempotency-Key": "t-cmp-4"})
    assert r.status_code == 200
    assert r.json()["data"]["preview"]["recipients"] >= 1

    r = actors["admin_client"].post(
        f"/api/v1/admin/notifications/campaigns/{camp_id}/confirm", json={"confirm": True}, headers={**actors["headers"]["super_admin"], "Idempotency-Key": "t-cmp-5"}
    )
    assert r.status_code == 200
    assert r.json()["data"]["status"] == "SENT"
    assert r.json()["data"]["sent_count"] >= 1

    # duplicate send is impossible
    r = actors["admin_client"].post(
        f"/api/v1/admin/notifications/campaigns/{camp_id}/confirm", json={"confirm": True}, headers={**actors["headers"]["super_admin"], "Idempotency-Key": "t-cmp-6"}
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "ALREADY_SENT"


def test_challenge_versioning(actors, db_session):
    from app.admin.models_content import ChallengeVersion

    h = actors["headers"]["admin"]
    r = actors["admin_client"].post(
        "/api/v1/admin/challenges",
        json={
            "title": "30 дней бега",
            "description": "Пробеги 30 дней",
            "type": "STREAK",
            "starts_at": (date.today() - timedelta(days=1)).isoformat(),
            "ends_at": (date.today() + timedelta(days=30)).isoformat(),
            "rules": {"days_required": 20},
            "target_value": 20,
        },
        headers={**h, "Idempotency-Key": "t-ch-1"},
    )
    assert r.status_code == 201, r.text
    ch_id = r.json()["data"]["id"]
    r = actors["admin_client"].post(f"/api/v1/admin/challenges/{ch_id}/publish", json={"confirm": True}, headers={**h, "Idempotency-Key": "t-ch-2"})
    assert r.status_code == 200
    assert r.json()["data"]["published_version"] == 1

    # a rule change on a published challenge requires a new version
    r = actors["admin_client"].patch(f"/api/v1/admin/challenges/{ch_id}", json={"rules": {"days_required": 25}}, headers={**h, "Idempotency-Key": "t-ch-3"})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "MUST_CREATE_NEW_VERSION"
    r = actors["admin_client"].patch(
        f"/api/v1/admin/challenges/{ch_id}", json={"rules": {"days_required": 25}, "create_new_version": True}, headers={**h, "Idempotency-Key": "t-ch-4"}
    )
    assert r.status_code == 200
    assert r.json()["data"]["published_version"] == 2
    from uuid import UUID

    assert db_session.query(ChallengeVersion).filter(ChallengeVersion.challenge_id == UUID(ch_id)).count() == 2


def test_habit_catalog_numeric_validation(actors):
    h = actors["headers"]["admin"]
    # target outside [min, max]
    r = actors["admin_client"].post(
        "/api/v1/admin/habits",
        json={"title": "Вода", "goal_type": "QUANTITY", "target_value": 5000, "unit": "ml", "frequency": "DAILY", "allowed_min": 500, "allowed_max": 3000},
        headers={**h, "Idempotency-Key": "t-hb-1"},
    )
    assert r.status_code == 400
    # valid
    r = actors["admin_client"].post(
        "/api/v1/admin/habits",
        json={"title": "Вода", "goal_type": "QUANTITY", "target_value": 2000, "unit": "ml", "frequency": "DAILY", "allowed_min": 500, "allowed_max": 3000},
        headers={**h, "Idempotency-Key": "t-hb-2"},
    )
    assert r.status_code == 201, r.text
