from app.database import SessionLocal
from app.models import AuditLog, User
from app.services.auth import get_password_hash


def test_audit_log_written_for_plan_creation(client):
    db = SessionLocal()
    try:
        user = User(
            email='audit@example.com',
            password_hash=get_password_hash('Password123'),
            first_name='Audit',
            last_name='User',
            role='content_manager',
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    finally:
        db.close()

    login_resp = client.post('/api/v1/auth/login', json={
        'email': 'audit@example.com',
        'password': 'Password123'
    })
    assert login_resp.status_code == 200
    token = login_resp.json()['access_token']

    response = client.post(
        '/api/v1/product/plan',
        json={
            'code': 'plan_audit',
            'name': 'Plan Audit',
            'price': 29.99,
            'currency': 'USD',
        },
        headers={'Authorization': f'Bearer {token}'},
    )

    assert response.status_code == 200

    db = SessionLocal()
    try:
        entry = db.query(AuditLog).filter(AuditLog.action == 'create_plan').order_by(AuditLog.created_at.desc()).first()
        assert entry is not None
        assert entry.user_id == user.id
        assert entry.entity_type == 'plan'
    finally:
        db.close()
