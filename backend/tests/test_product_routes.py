import pytest
from app.services.auth import get_password_hash
from app.database import SessionLocal
from app.models import User


def test_create_feature_requires_auth(client):
    response = client.post('/api/v1/product/feature', json={
        'code': 'feat_1',
        'name': 'Feature 1',
        'release_stage': 'alpha',
        'enabled': True,
    })

    assert response.status_code in (401, 403)


def test_create_plan_denied_for_normal_user(client):
    client.post('/api/v1/auth/register', json={
        'email': 'user@example.com',
        'password': 'Password123',
        'first_name': 'User',
        'last_name': 'Normal'
    })

    login_resp = client.post('/api/v1/auth/login', json={
        'email': 'user@example.com',
        'password': 'Password123'
    })
    assert login_resp.status_code == 200
    token = login_resp.json()['access_token']

    response = client.post(
        '/api/v1/product/plan',
        json={
            'code': 'plan_1',
            'name': 'Plan 1',
            'price': 9.99,
            'currency': 'USD',
        },
        headers={'Authorization': f'Bearer {token}'},
    )

    assert response.status_code == 403


def test_create_plan_allowed_for_content_manager(client):
    db = SessionLocal()
    try:
        user = User(
            email='manager@example.com',
            password_hash=get_password_hash('Password123'),
            first_name='Manager',
            last_name='User',
            role='content_manager',
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    finally:
        db.close()

    login_resp = client.post('/api/v1/auth/login', json={
        'email': 'manager@example.com',
        'password': 'Password123'
    })
    assert login_resp.status_code == 200
    token = login_resp.json()['access_token']

    response = client.post(
        '/api/v1/product/plan',
        json={
            'code': 'plan_2',
            'name': 'Plan 2',
            'price': 19.99,
            'currency': 'USD',
        },
        headers={'Authorization': f'Bearer {token}'},
    )

    assert response.status_code == 200
    assert response.json()['data']['id']
