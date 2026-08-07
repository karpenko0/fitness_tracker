import pytest

from app.services.auth import get_password_hash, verify_password, create_access_token, decode_access_token
from app.models import User
from app.database import SessionLocal
from app.config import get_settings


def test_password_hash_and_verify():
    password = "StrongPass123"
    hashed = get_password_hash(password)
    assert verify_password(password, hashed)
    assert not verify_password("wrong", hashed)


def test_jwt_token():
    token = create_access_token("user-id-123")
    payload = decode_access_token(token)
    assert payload["sub"] == "user-id-123"


def test_register_and_login(client):
    response = client.post("/api/v1/auth/register", json={
        "email": "test@example.com",
        "password": "Password123",
        "first_name": "Test",
        "last_name": "User"
    })
    assert response.status_code == 200
    assert response.json()["email"] == "test@example.com"

    response = client.post("/api/v1/auth/login", json={
        "email": "test@example.com",
        "password": "Password123"
    })
    assert response.status_code == 200
    assert "access_token" in response.json()
