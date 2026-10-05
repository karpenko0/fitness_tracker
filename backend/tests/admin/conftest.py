"""Fixtures for admin panel (SPEC-011) tests."""
import uuid as uuid_mod

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.database import engine
from app.models import User
from app.main import app
from app.services.auth import get_password_hash

PASSWORD = "Passw0rd!"


def make_user(db, role, email=None, **kw):
    email = email or f"t{uuid_mod.uuid4().hex[:10]}@fittrack.dev"
    u = User(email=email, password_hash=get_password_hash(PASSWORD), first_name="Test", last_name="User", role=role, **kw)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


@pytest.fixture(scope="session")
def admin_client():
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture()
def actors(db_session, admin_client):
    """Create one user per admin role + a plain client user; return tokens and headers."""
    users = {
        "super_admin": make_user(db_session, "super_admin"),
        "admin": make_user(db_session, "admin"),
        "content_manager": make_user(db_session, "content_manager"),
        "user": make_user(db_session, "user"),
    }
    tokens, headers = {}, {}
    for role, u in users.items():
        if role != "user":
            r = admin_client.post("/api/v1/admin/auth/login", json={"email": u.email, "password": PASSWORD})
            assert r.status_code == 200, r.text
            tokens[role] = r.json()["data"]["access_token"]
        # client token (regular JWT, typ != admin)
        r = admin_client.post("/api/v1/auth/login", json={"email": u.email, "password": PASSWORD})
        assert r.status_code == 200, r.text
        client_tokens = tokens.setdefault("client", {})
        client_tokens[role] = r.json()["access_token"]
        headers[role] = {"Authorization": f"Bearer {tokens[role]}"} if role in ("super_admin", "admin", "content_manager") else {"Authorization": f"Bearer {client_tokens[role]}"}
    return {"users": users, "tokens": tokens, "headers": headers, "admin_client": admin_client}
