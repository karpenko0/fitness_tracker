"""Admin audit journal writer (SPEC-011 6.12, 8.2, 9.11).

- Atomic with the business transaction: the caller passes its own DB session and the
  audit row is committed together with the change (or a FAILED row is recorded).
- Append-only: no update/delete API exists for regular admins.
- before/after summaries are always redacted (no tokens, passwords, full card data).
"""
from typing import Any, Optional
from uuid import UUID as PyUUID

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.user import User

from . import models
from .masking import redact

settings = get_settings()


def write_admin_audit(
    db: Session,
    actor: User,
    action: str,
    resource_type: str,
    resource_id: Optional[Any] = None,
    result: models.AuditResult = models.AuditResult.SUCCESS,
    reason: Optional[str] = None,
    request_id: Optional[str] = None,
    ip_hash: Optional[str] = None,
    before_summary: Optional[dict] = None,
    after_summary: Optional[dict] = None,
    commit: bool = True,
) -> models.AdminAuditLog:
    rid: Optional[PyUUID] = None
    if resource_id is not None:
        if isinstance(resource_id, PyUUID):
            rid = resource_id
        else:
            try:
                rid = PyUUID(str(resource_id))
            except (ValueError, TypeError):
                rid = None

    entry = models.AdminAuditLog(
        actor_user_id=actor.id,
        actor_role=actor.role,
        action=action,
        resource_type=resource_type,
        resource_id=rid,
        result=result,
        reason=redact(reason) if isinstance(reason, dict) else reason,
        request_id=request_id or "unknown",
        ip_hash=ip_hash,
        before_summary=redact(before_summary) if before_summary is not None else None,
        after_summary=redact(after_summary) if after_summary is not None else None,
    )
    db.add(entry)
    if commit:
        db.commit()
        db.refresh(entry)
    return entry
