"""Audit log service to create audit records"""
from typing import Optional, Union
from uuid import UUID as PyUUID

from app.models import AuditLog
from app.database import SessionLocal


def _to_uuid(value: Optional[Union[str, PyUUID]]) -> Optional[PyUUID]:
    """Accept either a UUID or its string representation."""
    if value is None:
        return None
    if isinstance(value, PyUUID):
        return value
    try:
        return PyUUID(str(value))
    except (ValueError, TypeError):
        return None


def record_audit(action: str, user_id: Optional[Union[str, PyUUID]] = None, entity_type: Optional[str] = None, entity_id: Optional[Union[str, PyUUID]] = None, changes: Optional[dict] = None, status: Optional[str] = "success", trace_id: Optional[str] = None):
    db = SessionLocal()
    try:
        entry = AuditLog(
            user_id=_to_uuid(user_id),
            action=action,
            entity_type=entity_type,
            entity_id=_to_uuid(entity_id),
            changes=changes,
            status=status,
            trace_id=trace_id,
        )
        db.add(entry)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
