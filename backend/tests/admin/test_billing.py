"""SPEC-011 11.4/11.5: billing read-only, masking, webhook replay idempotency."""
from app.admin.models_billing import (
    Payment,
    PaymentStatus,
    PaymentWebhookEvent,
    Subscription,
    SubscriptionStatus,
)
from app.models import Plan
from tests.admin.conftest import make_user

BASE = "/api/v1/admin/billing"


def _seed_payment(db_session, email="buyer@fittrack.dev"):
    u = make_user(db_session, "user", email=email)
    plan = Plan(code="pro-test", name="Pro Test", price=29.99)
    db_session.add(plan)
    db_session.commit()
    sub = Subscription(user_id=u.id, plan_id=plan.id, status=SubscriptionStatus.ACTIVE)
    db_session.add(sub)
    db_session.commit()
    pay = Payment(
        user_id=u.id,
        amount=29.99,
        currency="USD",
        provider="telegram_stars",
        status=PaymentStatus.PENDING,
        provider_transaction_id="tx-abc-1234",
    )
    db_session.add(pay)
    db_session.commit()
    ev = PaymentWebhookEvent(
        provider="telegram_stars",
        event_id=f"evt-{pay.id}",
        event_type="payment_succeeded",
        payment_id=pay.id,
        signature_valid=True,
    )
    db_session.add(ev)
    db_session.commit()
    db_session.refresh(u)
    db_session.refresh(pay)
    db_session.refresh(ev)
    return u, pay, ev


def test_manual_status_change_always_403(actors, db_session):
    _, pay, _ = _seed_payment(db_session)
    for role in ("content_manager", "admin", "super_admin"):
        r = actors["admin_client"].post(
            f"{BASE}/payments/{pay.id}/status",
            json={"status": "PAID", "reason": "x"},
            headers={**actors["headers"][role], "Idempotency-Key": f"t-ms-{role}"},
        )
        assert r.status_code == 403
        assert r.json()["error"]["code"] == "FORBIDDEN"
    # denials are audited
    r = actors["admin_client"].get("/api/v1/admin/audit-logs?action=admin.billing.manual_status", headers=actors["headers"]["super_admin"])
    assert r.status_code == 200
    assert len(r.json()["data"]["items"]) >= 3


def test_payment_list_masks_transaction_id(actors, db_session):
    _, pay, _ = _seed_payment(db_session)
    r = actors["admin_client"].get(BASE + "/payments", headers=actors["headers"]["super_admin"])
    assert r.status_code == 200
    item = next(i for i in r.json()["data"]["items"] if i["id"] == str(pay.id))
    assert item["provider_transaction_id"] == "****1234"
    assert "tx-abc-1234" not in r.text


def test_replay_idempotent_updates_once(actors, db_session):
    _, pay, ev = _seed_payment(db_session)
    r = actors["admin_client"].post(
        f"{BASE}/webhooks/{ev.id}/replay", json={"confirm": True}, headers={**actors["headers"]["super_admin"], "Idempotency-Key": "t-replay-1"}
    )
    assert r.status_code == 200
    assert r.json()["data"]["change"] == {"before": "PENDING", "after": "PAID"}
    db_session.refresh(pay)
    assert pay.status == PaymentStatus.PAID

    # replay again: no change, replay_count increments, result stays PAID
    r = actors["admin_client"].post(
        f"{BASE}/webhooks/{ev.id}/replay", json={"confirm": True}, headers={**actors["headers"]["super_admin"], "Idempotency-Key": "t-replay-2"}
    )
    assert r.status_code == 200
    assert r.json()["data"]["change"] is None
    assert r.json()["data"]["replay_count"] == 2
    db_session.refresh(pay)
    assert pay.status == PaymentStatus.PAID


def test_replay_invalid_signature_refused(actors, db_session):
    _, pay, ev = _seed_payment(db_session)
    ev.signature_valid = False
    db_session.commit()
    r = actors["admin_client"].post(
        f"{BASE}/webhooks/{ev.id}/replay", json={"confirm": True}, headers={**actors["headers"]["super_admin"], "Idempotency-Key": "t-replay-3"}
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "REPLAY_REFUSED"
    db_session.refresh(pay)
    assert pay.status == PaymentStatus.PENDING


def test_subscription_list(actors, db_session):
    u, _, _ = _seed_payment(db_session)
    r = actors["admin_client"].get(BASE + "/subscriptions", headers=actors["headers"]["super_admin"])
    assert r.status_code == 200
    assert r.json()["data"]["total"] >= 1
