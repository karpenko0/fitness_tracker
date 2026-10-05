"""SPEC-011 seed: three admin-role accounts + optional demo data for local/manual testing.

Usage (dev only — do NOT run against production data):

    # 1. apply migrations first
    python -m alembic upgrade head

    # 2. create the three admin accounts (idempotent by email)
    python scripts/seed_admin.py

    # 3. optionally seed demo content/billing data as well
    python scripts/seed_admin.py --with-demo-data

Accounts (password: $ADMIN_SEED_PASSWORD, default "Demo123!"):

    root@fittrack.demo      SUPER_ADMIN  (mfa_required=False)
    admin@fittrack.demo     ADMIN
    content@fittrack.demo   CONTENT_MANAGER
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import uuid
from datetime import date, datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

ADMIN_SEED_PASSWORD = os.environ.get("ADMIN_SEED_PASSWORD", "Demo123!")

ADMIN_ACCOUNTS = [
    # (email, first, last, role, mfa_required)
    ("root@fittrack.demo", "Римма", "Руководова", "super_admin", False),
    ("admin@fittrack.demo", "Артём", "Админов", "admin", False),
    ("content@fittrack.demo", "Катя", "Контентова", "content_manager", False),
]


def seed_admin_users(db) -> None:
    """Create or update the three admin accounts. Idempotent by email."""
    import app.models.user as um
    from app.services.auth import get_password_hash

    for email, first, last, role, mfa in ADMIN_ACCOUNTS:
        user = db.query(um.User).filter(um.User.email == email).first()
        if user is None:
            user = um.User(
                id=uuid.uuid4(),
                email=email,
                password_hash=get_password_hash(ADMIN_SEED_PASSWORD),
                first_name=first,
                last_name=last,
                role=role,
                timezone="Europe/Moscow",
                is_active=True,
                role_source="system",
                mfa_required=mfa,
                created_at=datetime.utcnow(),
            )
            db.add(user)
            print(f"created  {email} ({role})")
        else:
            user.password_hash = get_password_hash(ADMIN_SEED_PASSWORD)
            user.role = role
            user.role_source = "system"
            user.mfa_required = mfa
            user.is_active = True
            print(f"updated  {email} ({role})")
    db.commit()


def seed_demo_data(db) -> None:
    """Demo billing/content data so every admin page has something to show."""
    import app.models.plan as pm
    from app.admin import models_billing as ab
    from app.admin import models_content as ac

    plan = db.query(pm.Plan).filter(pm.Plan.code == "pro").first()
    if plan is None:
        plan = pm.Plan(
            id=uuid.uuid4(), code="pro", name="Pro", price=4900,
            currency="RUB", status="active", created_at=datetime.utcnow(),
        )
        db.add(plan)
        db.commit()
        print("created  plan 'pro' (4900 RUB)")

    # demo end users
    import app.models.user as um
    from app.services.auth import get_password_hash

    demo_users = {}
    for email, first, last in (
        ("ivan@example.com", "Иван", "Петров"),
        ("olga@example.com", "Ольга", "Смирнова"),
        ("blocked@example.com", "Боб", "Заблокиров"),
    ):
        u = db.query(um.User).filter(um.User.email == email).first()
        if u is None:
            u = um.User(
                id=uuid.uuid4(), email=email, first_name=first, last_name=last,
                role="user", timezone="Europe/Moscow",
                is_active=email != "blocked@example.com",
                password_hash=get_password_hash("User123!"),
                created_at=datetime.utcnow(),
            )
            db.add(u)
            db.commit()
            print(f"created  user {email}")
        demo_users[email] = u
    iv, ol = demo_users["ivan@example.com"], demo_users["olga@example.com"]

    # subscriptions
    for u, status in ((iv, ab.SubscriptionStatus.ACTIVE), (ol, ab.SubscriptionStatus.PAST_DUE)):
        if not db.query(ab.Subscription).filter(ab.Subscription.user_id == u.id).first():
            db.add(ab.Subscription(
                id=uuid.uuid4(), user_id=u.id, plan_id=plan.id, status=status,
                provider="stripe",
                period_start=date.today() - timedelta(days=10),
                period_end=date.today() + timedelta(days=20) if status == ab.SubscriptionStatus.ACTIVE else date.today() - timedelta(days=10),
                created_at=datetime.utcnow() - timedelta(days=10),
            ))
            print(f"created  subscription {u.email} ({status.value})")
    db.commit()

    # payment + processed webhook event for ivan
    sub = db.query(ab.Subscription).filter(ab.Subscription.user_id == iv.id).first()
    if not db.query(ab.Payment).filter(ab.Payment.user_id == iv.id).first():
        p = ab.Payment(
            id=uuid.uuid4(), user_id=iv.id, subscription_id=sub.id,
            status=ab.PaymentStatus.PAID, amount=4900, currency="RUB",
            provider="stripe", payment_method="card",
            provider_transaction_id=f"txn_{uuid.uuid4().hex[:12]}",
            created_at=datetime.utcnow() - timedelta(days=10),
            paid_at=datetime.utcnow() - timedelta(days=10),
        )
        db.add(p)
        db.flush()
        db.add(ab.PaymentWebhookEvent(
            id=uuid.uuid4(), payment_id=p.id, provider="stripe",
            event_id=f"evt_{uuid.uuid4().hex[:12]}", event_type="invoice.paid",
            status=ab.WebhookEventStatus.PROCESSED, signature_valid=True,
            payload_summary=json.dumps({"type": "invoice.paid"}),
            created_at=datetime.utcnow() - timedelta(days=10),
        ))
        print("created  payment (PAID) + processed webhook event for ivan@example.com")
    db.commit()

    # exercises: one published, one draft
    if not db.query(ac.Exercise).filter(ac.Exercise.slug == "back-squat").first():
        db.add(ac.Exercise(
            id=uuid.uuid4(), title="Приседания со штангой", slug="back-squat",
            description="Базовое упражнение для ног и ягодиц.", type="STRENGTH",
            difficulty=3, status=ac.ContentStatus.PUBLISHED, version=2,
            published_version=2, muscle_groups=["quadriceps", "glutes"],
            equipment=["barbell"], unit="повторения",
            created_at=datetime.utcnow() - timedelta(days=30),
        ))
        print("created  exercise 'Приседания со штангой' (PUBLISHED v2)")
    if not db.query(ac.Exercise).filter(ac.Exercise.slug == "treadmill-run").first():
        db.add(ac.Exercise(
            id=uuid.uuid4(), title="Бег на дорожке", slug="treadmill-run",
            description="Кардио на дорожке.", type="CARDIO", difficulty=1,
            status=ac.ContentStatus.DRAFT, version=1,
            created_at=datetime.utcnow() - timedelta(days=5),
        ))
        print("created  exercise 'Бег на дорожке' (DRAFT)")
    db.commit()

    # program in review
    if not db.query(ac.Program).filter(ac.Program.slug == "strength-start-6w").first():
        ex = db.query(ac.Exercise).filter(ac.Exercise.slug == "back-squat").first()
        db.add(ac.Program(
            id=uuid.uuid4(), title="Старт силы — 6 недель", slug="strength-start-6w",
            description="Базовая силовая программа для начинающих.", goal="сила",
            level="beginner", duration_minutes=45,
            weeks=[{"week": 1, "workouts": [{"day": "Пн", "exercises": [str(ex.id)]}]}],
            status=ac.ContentStatus.IN_REVIEW, version=1,
            created_at=datetime.utcnow() - timedelta(days=7),
        ))
        print("created  program 'Старт силы — 6 недель' (IN_REVIEW)")
    db.commit()

    # habit definition (published)
    if not db.query(ac.HabitDefinition).filter(ac.HabitDefinition.title == "Вода 1.5 л").first():
        db.add(ac.HabitDefinition(
            id=uuid.uuid4(), title="Вода 1.5 л",
            description="Пить воду в течение дня", goal_type="QUANTITY",
            target_value=1.5, unit="л", frequency="DAILY",
            allowed_min=0, allowed_max=3, status="PUBLISHED", version=1,
        ))
        print("created  habit 'Вода 1.5 л' (PUBLISHED)")
    db.commit()

    # challenge (published)
    if not db.query(ac.Challenge).filter(ac.Challenge.title == "10 тренировок за 2 недели").first():
        db.add(ac.Challenge(
            id=uuid.uuid4(), title="10 тренировок за 2 недели",
            description="Серия тренировок", type="WORKOUT_COUNT",
            starts_at=date.today() - timedelta(days=3),
            ends_at=date.today() + timedelta(days=11),
            rules={"min_workouts": 10}, target_value=10, visibility="PUBLIC",
            status=ac.ContentStatus.PUBLISHED, published_version=1, version=1,
        ))
        print("created  challenge '10 тренировок за 2 недели' (PUBLISHED)")
    db.commit()

    # active promo code
    if not db.query(ac.PromoCode).filter(ac.PromoCode.code_normalized == "FITSTART").first():
        code = "FITSTART"
        db.add(ac.PromoCode(
            id=uuid.uuid4(), code_normalized=code,
            code_hash=hashlib.sha256(f"promo:{code}".encode()).hexdigest(),
            discount_type="PERCENT", discount_value=20, currency="RUB",
            starts_at=date.today() - timedelta(days=2),
            ends_at=date.today() + timedelta(days=28),
            max_uses=100, used_count=0, status=ac.PromoCodeStatus.ACTIVE,
            version=1, reason="Запуск кампании",
        ))
        print("created  promo 'FITSTART' (20% PERCENT, ACTIVE)")
    db.commit()

    # notification template + campaign preview
    if not db.query(ac.NotificationTemplate).filter(ac.NotificationTemplate.event == "workout_reminder").first():
        nt = ac.NotificationTemplate(
            id=uuid.uuid4(), name="Напоминание о тренировке", event="workout_reminder",
            channels=["telegram"],
            templates={"ru": "Привет! Сегодня хорошая погода для тренировки {goal}"},
            timezone_policy="user", status="ACTIVE", version=1,
        )
        db.add(nt)
        db.flush()
        db.add(ac.NotificationCampaign(
            id=uuid.uuid4(), template_id=nt.id, name="Рассылка на понедельник",
            audience_segment={}, status=ac.CampaignStatus.PREVIEWED, expected_recipients=2,
        ))
        print("created  notification template 'workout_reminder' + campaign (PREVIEWED)")
    db.commit()


def main() -> None:
    parser = argparse.ArgumentParser(description="SPEC-011 admin seed (dev only)")
    parser.add_argument("--with-demo-data", action="store_true",
                        help="also seed demo billing/content data")
    args = parser.parse_args()

    from app.database import SessionLocal

    db = SessionLocal()
    try:
        seed_admin_users(db)
        if args.with_demo_data:
            seed_demo_data(db)
        print("done. Login with the accounts above (password: %s)" % ADMIN_SEED_PASSWORD)
    finally:
        db.close()


if __name__ == "__main__":
    main()
