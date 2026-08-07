from app.models import IdempotencyKey
from app.database import SessionLocal


def test_idempotency_key_model():
    db = SessionLocal()
    try:
        key = IdempotencyKey(key="test-key", method="POST", path="/test", response_code="200", response_body='{"ok":true}')
        db.add(key)
        db.commit()
        found = db.query(IdempotencyKey).filter(IdempotencyKey.key == "test-key").first()
        assert found is not None
        assert found.path == "/test"
    finally:
        db.close()
