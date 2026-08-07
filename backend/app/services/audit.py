"""Audit log service to create audit records"""
from typing import Optional
from app.models import AuditLog
from app.database import SessionLocal


def record_audit(action: str, user_id: Optional[str] = None, entity_type: Optional[str] = None, entity_id: Optional[str] = None, changes: Optional[dict] = None, status: Optional[str] = "success", trace_id: Optional[str] = None):
    db = SessionLocal()
    try:
        entry = AuditLog(
            user_id=user_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            changes=changes,
            status=status,
            trace_id=trace_id,
        )
        db.add(entry)
        db.commit()
    finally:
        db.close()
