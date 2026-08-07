import os

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-1234567890123456")

from app.database import engine
from app.models import Base
from app.main import app

Base.metadata.create_all(bind=engine)


@pytest.fixture(scope="session")
def client():
    return TestClient(app)
