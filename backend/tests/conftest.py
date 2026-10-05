import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-1234567890123456")
# Raise rate limits in tests (a dedicated test tightens them on demand)
os.environ.setdefault("RATE_LIMIT_REQUESTS", "1000000")
os.environ.setdefault("ADMIN_RATE_LIMIT_REQUESTS", "1000000")
os.environ.setdefault("ADMIN_EXPORT_RATE_LIMIT_REQUESTS", "1000000")
os.environ.setdefault("MEDIA_STORAGE_DIR", "/tmp/fitness-tracker-test-media")

from app.database import engine
from app.models import Base
from app.main import app

# Create a sessionmaker for testing
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(autouse=True)
def fresh_database():
    """Reset the in-memory database before every test for full isolation."""
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield


@pytest.fixture(scope="function")
def db_session():
    """Create a fresh database session for each test."""
    session = TestingSessionLocal()

    yield session

    session.close()


@pytest.fixture(scope="session")
def client():
    return TestClient(app)
