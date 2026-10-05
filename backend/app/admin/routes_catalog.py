"""Catalog admin routes (SPEC-011 6.7, 6.8, 6.9): notification templates & campaigns,
habit catalog, challenges, promo codes."""
import hashlib
import re
from datetime import date, datetime
from typing import Optional
from uuid import UUID as PyUUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models.user import User

from . import auth, models
from .audit import write_admin_audit
from .common import err_response, ok, paginate_params, require_confirm, reject_unknown_query_params
from .masking import ip_hash
from .models_content import (
    TEMPLATE_VARIABLE_WHITELIST,
    CampaignStatus,
    Challenge,
    ChallengeVersion,
    ContentStatus,
    HabitCatalogStatus,
    HabitDefinition,
    NotificationCampaign,
    NotificationTemplate,
    PromoCode,
    PromoCodeStatus,
    PromoRedemption,
    TemplateStatus,
)
from .schemas import (
    CampaignConfirm,
    CampaignCreate,
    ChallengeCreate,
    ChallengeUpdate,
    HabitDefinitionCreate,
    HabitDefinitionUpdate,
    PromoCodeCreate,
    PromoCodeUpdate,
    RedeemRequest,
    StatusTransitionRequest,
    TemplateCreate,
    TemplateUpdate,
)

settings = get_settings()
router = APIRouter(prefix="/admin", tags=["admin-catalog"])

VAR_PATTERN = re.compile(r"\{[a-z_]+\}")


def _audit(db, request, actor, action, resource_type, resource_id=None, result=None, reason=None, before_summary=None, after_summary=None):
    write_admin_audit(
        db,
        actor=actor,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        result=result or models.AuditResult.SUCCESS,
        reason=reason,
        request_id=getattr(request.state, "request_id", "unknown"),
        ip_hash=ip_hash(request.client.host if request.client else None, settings.AUDIT_IP_SALT),
        before_summary=before_summary,
        after_summary=after_summary,
    )


def _validate_template_variables(templates: dict):
    errors = []
    for locale, text in (templates or {}).items():
        for var in VAR_PATTERN.findall(text or ""):
            if var not in TEMPLATE_VARIABLE_WHITELIST:
                errors.append(f"locale {locale}: variable {var} is not in the whitelist")
    return errors


# ============================= NOTIFICATION TEMPLATES =============================

def _template_dict(t: NotificationTemplate) -> dict:
    return {
        "id": str(t.id),
        "name": t.name,
        "event": t.event,
        "channels": t.channels,
        "templates": t.templates,
        "timezone_policy": t.timezone_policy,
        "timezone_fixed": t.timezone_fixed,
        "quiet_hours_start": t.quiet_hours_start,
        "quiet_hours_end": t.quiet_hours_end,
        "rate_limit_per_day": t.rate_limit_per_day,
        "status": t.status.value if hasattr(t.status, "value") else str(t.status),
        "version": t.version,
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }


@router.get("/notifications")
def list_templates(
    request: Request,
    status_filter: Optional[str] = None,
    page: int = 1,
    pageSize: int = 20,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("notifications:manage")),
):
    reject_unknown_query_params(request)
    page, page_size, _ = paginate_params(page, pageSize, None)
    q = db.query(NotificationTemplate).filter(NotificationTemplate.deleted_at.is_(None))
    if status_filter:
        q = q.filter(NotificationTemplate.status == status_filter)
    total = q.count()
    items = q.order_by(NotificationTemplate.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return ok({"items": [_template_dict(t) for t in items], "page": page, "pageSize": page_size, "total": total})


@router.post("/notifications", status_code=201)
def create_template(
    payload: TemplateCreate,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("notifications:manage")),
):
    errors = _validate_template_variables(payload.templates)
    if payload.quiet_hours_start and payload.quiet_hours_end and payload.quiet_hours_start == payload.quiet_hours_end:
        errors.append("quiet_hours_start must differ from quiet_hours_end")
    if errors:
        raise err_response("VALIDATION_ERROR", "Template validation failed", 400, errors)
    t = NotificationTemplate(
        name=payload.name,
        event=payload.event,
        channels=payload.channels,
        templates=payload.templates,
        timezone_policy=payload.timezone_policy,
        timezone_fixed=payload.timezone_fixed,
        quiet_hours_start=payload.quiet_hours_start,
        quiet_hours_end=payload.quiet_hours_end,
        rate_limit_per_day=payload.rate_limit_per_day,
        status=TemplateStatus.DRAFT,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    _audit(db, request, actor, "admin.content.created", "notification_template", t.id, after_summary={"name": t.name})
    return ok(_template_dict(t))


@router.patch("/notifications/{template_id}")
def update_template(
    template_id: PyUUID,
    payload: TemplateUpdate,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("notifications:manage")),
):
    t = db.query(NotificationTemplate).filter(NotificationTemplate.id == template_id, NotificationTemplate.deleted_at.is_(None)).first()
    if not t:
        raise err_response("NOT_FOUND", "Template not found", 404)
    before = _template_dict(t)
    data = payload.model_dump(exclude_unset=True)
    status = data.pop("status", None)
    # validate new variables when templates change
    if "templates" in data:
        merged = dict(t.templates or {})
        merged.update(payload.templates or {})
        errors = _validate_template_variables(merged)
        if errors:
            raise err_response("VALIDATION_ERROR", "Template validation failed", 400, errors)
    for field, value in data.items():
        setattr(t, field, value)
    if status:
        if status not in [s.value for s in TemplateStatus]:
            raise err_response("VALIDATION_ERROR", f"unknown status: {status}", 400)
        if t.status == TemplateStatus.ARCHIVED and status == TemplateStatus.ACTIVE.value:
            raise err_response("ARCHIVED", "Archived template cannot be activated", 409)
        t.status = status
    t.version = (t.version or 1) + 1
    db.commit()
    db.refresh(t)
    _audit(db, request, actor, "admin.content.updated", "notification_template", t.id, before_summary=before, after_summary=_template_dict(t))
    return ok(_template_dict(t))


# ============================= CAMPAIGNS =============================

def _estimate_audience(db, segment: Optional[dict]) -> int:
    """MVP audience estimation: active regular users; segment filters applied on role/plan when given."""
    q = db.query(User).filter(User.is_active.is_(True), User.deleted_at.is_(None), User.role == "user")
    if segment:
        if "role" in segment:
            q = q.filter(User.role == segment["role"])
    return q.count()


def _campaign_dict(c: NotificationCampaign, template: Optional[NotificationTemplate] = None) -> dict:
    return {
        "id": str(c.id),
        "template_id": str(c.template_id),
        "template_name": template.name if template else None,
        "name": c.name,
        "audience_segment": c.audience_segment,
        "status": c.status.value if hasattr(c.status, "value") else str(c.status),
        "expected_recipients": c.expected_recipients,
        "sent_count": c.sent_count,
        "confirmed_at": c.confirmed_at.isoformat() if c.confirmed_at else None,
        "sent_at": c.sent_at.isoformat() if c.sent_at else None,
        "reason": c.reason,
    }


@router.get("/notifications/campaigns")
def list_campaigns(
    request: Request,
    status_filter: Optional[str] = None,
    page: int = 1,
    pageSize: int = 20,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("notifications:manage")),
):
    reject_unknown_query_params(request)
    page, page_size, _ = paginate_params(page, pageSize, None)
    q = db.query(NotificationCampaign)
    if status_filter:
        q = q.filter(NotificationCampaign.status == status_filter)
    total = q.count()
    items = q.order_by(NotificationCampaign.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return ok({"items": [_campaign_dict(c) for c in items], "page": page, "pageSize": page_size, "total": total})


@router.post("/notifications/campaigns", status_code=201)
def create_campaign(
    payload: CampaignCreate,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("notifications:manage")),
):
    template = db.query(NotificationTemplate).filter(NotificationTemplate.id == payload.template_id).first()
    if not template or template.deleted_at is not None:
        raise err_response("NOT_FOUND", "Template not found", 404)
    if template.status != TemplateStatus.ACTIVE:
        raise err_response("TEMPLATE_NOT_ACTIVE", "Only ACTIVE templates can be used for campaigns", 409)
    c = NotificationCampaign(
        template_id=template.id,
        name=payload.name,
        audience_segment=payload.audience_segment,
        reason=payload.reason,
        status=CampaignStatus.DRAFT,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    _audit(db, request, actor, "admin.content.created", "notification_campaign", c.id, after_summary={"name": c.name})
    return ok(_campaign_dict(c, template))


@router.post("/notifications/campaigns/{campaign_id}/preview")
def preview_campaign(
    campaign_id: PyUUID,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("notifications:manage")),
):
    """Mass send requires audience preview and recipient count (SPEC-011 6.7)."""
    c = db.query(NotificationCampaign).filter(NotificationCampaign.id == campaign_id).first()
    if not c:
        raise err_response("NOT_FOUND", "Campaign not found", 404)
    if c.status not in (CampaignStatus.DRAFT, CampaignStatus.PREVIEWED):
        raise err_response("INVALID_TRANSITION", f"Cannot preview campaign in status {c.status.value}", 409)
    template = db.query(NotificationTemplate).filter(NotificationTemplate.id == c.template_id).first()
    c.expected_recipients = _estimate_audience(db, c.audience_segment)
    c.status = CampaignStatus.PREVIEWED
    db.commit()
    sample = None
    if template and template.templates:
        sample_locale, sample_text = next(iter(template.templates.items()))
        sample = {
            locale: re.sub(r"\{[a-z_]+\}", "ПРИМЕР", text) for locale, text in template.templates.items()
        }
    return ok(
        {
            **_campaign_dict(c, template),
            "preview": {"recipients": c.expected_recipients, "sample": sample},
        }
    )


@router.post("/notifications/campaigns/{campaign_id}/confirm")
def confirm_campaign(
    campaign_id: PyUUID,
    payload: CampaignConfirm,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("notifications:send", critical=True)),
):
    """confirm -> sent. Resending an already-sent campaign is impossible (idempotent, no duplicates)."""
    c = db.query(NotificationCampaign).filter(NotificationCampaign.id == campaign_id).first()
    if not c:
        raise err_response("NOT_FOUND", "Campaign not found", 404)
    if c.status == CampaignStatus.SENT:
        raise err_response("ALREADY_SENT", "Campaign was already sent; duplicate sends are not possible", 409)
    if c.status not in (CampaignStatus.PREVIEWED, CampaignStatus.SCHEDULED):
        raise err_response("INVALID_TRANSITION", "Campaign must be previewed before sending", 409)
    require_confirm(payload, settings)
    c.status = CampaignStatus.SENT
    c.confirmed_by = actor.id
    c.confirmed_at = datetime.utcnow()
    c.sent_at = datetime.utcnow()
    c.sent_count = c.expected_recipients or 0
    db.commit()
    _audit(
        db,
        request,
        actor,
        "admin.notification.sent",
        "notification_campaign",
        c.id,
        reason=f"sent to {c.sent_count} recipients",
        after_summary={"sent_count": c.sent_count},
    )
    return ok(_campaign_dict(c))


@router.post("/notifications/campaigns/{campaign_id}/cancel")
def cancel_campaign(
    campaign_id: PyUUID,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("notifications:manage")),
):
    c = db.query(NotificationCampaign).filter(NotificationCampaign.id == campaign_id).first()
    if not c:
        raise err_response("NOT_FOUND", "Campaign not found", 404)
    if c.status not in (CampaignStatus.DRAFT, CampaignStatus.PREVIEWED, CampaignStatus.SCHEDULED):
        raise err_response("INVALID_TRANSITION", f"Cannot cancel campaign in status {c.status.value}", 409)
    c.status = CampaignStatus.CANCELLED
    db.commit()
    _audit(db, request, actor, "admin.notification.cancelled", "notification_campaign", c.id)
    return ok(_campaign_dict(c))


# ============================= HABIT CATALOG =============================

def _habit_dict(h: HabitDefinition) -> dict:
    return {
        "id": str(h.id),
        "title": h.title,
        "description": h.description,
        "goal_type": h.goal_type.value if hasattr(h.goal_type, "value") else str(h.goal_type),
        "target_value": float(h.target_value) if h.target_value is not None else None,
        "unit": h.unit,
        "frequency": h.frequency.value if hasattr(h.frequency, "value") else str(h.frequency),
        "allowed_min": float(h.allowed_min) if h.allowed_min is not None else None,
        "allowed_max": float(h.allowed_max) if h.allowed_max is not None else None,
        "reminders": h.reminders,
        "streak_policy": h.streak_policy,
        "status": h.status.value if hasattr(h.status, "value") else str(h.status),
        "version": h.version,
    }


@router.get("/habits")
def list_habit_definitions(
    request: Request,
    status_filter: Optional[str] = None,
    page: int = 1,
    pageSize: int = 20,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("habits:manage")),
):
    reject_unknown_query_params(request)
    page, page_size, _ = paginate_params(page, pageSize, None)
    q = db.query(HabitDefinition).filter(HabitDefinition.deleted_at.is_(None))
    if status_filter:
        q = q.filter(HabitDefinition.status == status_filter)
    total = q.count()
    items = q.order_by(HabitDefinition.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return ok({"items": [_habit_dict(h) for h in items], "page": page, "pageSize": page_size, "total": total})


def _validate_habit(goal_type, target_value, allowed_min, allowed_max):
    errors = []
    if goal_type != "BOOLEAN" and target_value is None:
        errors.append("target_value is required for non-boolean habits")
    if allowed_min is not None and allowed_max is not None and allowed_min > allowed_max:
        errors.append("allowed_min must be <= allowed_max")
    if target_value is not None and allowed_min is not None and allowed_max is not None:
        if not (allowed_min <= target_value <= allowed_max):
            errors.append("target_value must be within [allowed_min, allowed_max]")
    return errors


@router.post("/habits", status_code=201)
def create_habit_definition(
    payload: HabitDefinitionCreate,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("habits:manage")),
):
    errors = _validate_habit(payload.goal_type, payload.target_value, payload.allowed_min, payload.allowed_max)
    if errors:
        raise err_response("VALIDATION_ERROR", "Habit definition validation failed", 400, errors)
    h = HabitDefinition(
        title=payload.title,
        description=payload.description,
        goal_type=payload.goal_type,
        target_value=payload.target_value,
        unit=payload.unit,
        frequency=payload.frequency,
        allowed_min=payload.allowed_min,
        allowed_max=payload.allowed_max,
        reminders=payload.reminders,
        streak_policy=payload.streak_policy,
        status=HabitCatalogStatus.DRAFT,
    )
    db.add(h)
    db.commit()
    db.refresh(h)
    _audit(db, request, actor, "admin.content.created", "habit_definition", h.id, after_summary={"title": h.title})
    return ok(_habit_dict(h))


@router.patch("/habits/{habit_id}")
def update_habit_definition(
    habit_id: PyUUID,
    payload: HabitDefinitionUpdate,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("habits:manage")),
):
    """Catalog changes never rewrite users' historical completions (SPEC-011 6.7):
    user habits/tasks live in separate tables and are untouched here."""
    h = db.query(HabitDefinition).filter(HabitDefinition.id == habit_id, HabitDefinition.deleted_at.is_(None)).first()
    if not h:
        raise err_response("NOT_FOUND", "Habit definition not found", 404)
    before = _habit_dict(h)
    data = payload.model_dump(exclude_unset=True)
    status = data.pop("status", None)
    for field, value in data.items():
        setattr(h, field, value)
    if status:
        if status not in [s.value for s in HabitCatalogStatus]:
            raise err_response("VALIDATION_ERROR", f"unknown status: {status}", 400)
        if h.status == HabitCatalogStatus.ARCHIVED and status == HabitCatalogStatus.PUBLISHED.value:
            raise err_response("ARCHIVED", "Archived habit cannot be republished", 409)
        h.status = status
    # re-validate numeric constraints
    errors = _validate_habit(
        h.goal_type.value if hasattr(h.goal_type, "value") else str(h.goal_type),
        float(h.target_value) if h.target_value is not None else None,
        float(h.allowed_min) if h.allowed_min is not None else None,
        float(h.allowed_max) if h.allowed_max is not None else None,
    )
    if errors:
        db.rollback()
        raise err_response("VALIDATION_ERROR", "Habit definition validation failed", 400, errors)
    h.version = (h.version or 1) + 1
    db.commit()
    db.refresh(h)
    _audit(db, request, actor, "admin.content.updated", "habit_definition", h.id, before_summary=before, after_summary=_habit_dict(h))
    return ok(_habit_dict(h))


# ============================= CHALLENGES =============================

def _challenge_dict(c: Challenge) -> dict:
    return {
        "id": str(c.id),
        "title": c.title,
        "description": c.description,
        "type": c.type.value if hasattr(c.type, "value") else str(c.type),
        "starts_at": c.starts_at.isoformat() if c.starts_at else None,
        "ends_at": c.ends_at.isoformat() if c.ends_at else None,
        "rules": c.rules,
        "target_value": float(c.target_value) if c.target_value is not None else None,
        "eligibility": c.eligibility,
        "repeat_allowed": c.repeat_allowed,
        "visibility": c.visibility.value if hasattr(c.visibility, "value") else str(c.visibility),
        "status": c.status.value if hasattr(c.status, "value") else str(c.status),
        "published_version": c.published_version,
        "version": c.version,
    }


@router.get("/challenges")
def list_challenges(
    request: Request,
    status_filter: Optional[str] = None,
    page: int = 1,
    pageSize: int = 20,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("challenges:manage")),
):
    reject_unknown_query_params(request)
    page, page_size, _ = paginate_params(page, pageSize, None)
    q = db.query(Challenge).filter(Challenge.deleted_at.is_(None))
    if status_filter:
        q = q.filter(Challenge.status == status_filter)
    total = q.count()
    items = q.order_by(Challenge.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return ok({"items": [_challenge_dict(c) for c in items], "page": page, "pageSize": page_size, "total": total})


@router.post("/challenges", status_code=201)
def create_challenge(
    payload: ChallengeCreate,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("challenges:manage")),
):
    c = Challenge(
        title=payload.title,
        description=payload.description,
        type=payload.type,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        rules=payload.rules,
        target_value=payload.target_value,
        eligibility=payload.eligibility,
        repeat_allowed=payload.repeat_allowed,
        visibility=payload.visibility,
        status=ContentStatus.DRAFT,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    _audit(db, request, actor, "admin.content.created", "challenge", c.id, after_summary={"title": c.title})
    return ok(_challenge_dict(c))


RULE_AFFECTING_FIELDS = ("rules", "target_value", "starts_at", "ends_at")


@router.patch("/challenges/{challenge_id}")
def update_challenge(
    challenge_id: PyUUID,
    payload: ChallengeUpdate,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("challenges:manage")),
):
    """A published challenge changes results-affecting rules ONLY via a new version (SPEC-011 6.8)."""
    c = db.query(Challenge).filter(Challenge.id == challenge_id, Challenge.deleted_at.is_(None)).first()
    if not c:
        raise err_response("NOT_FOUND", "Challenge not found", 404)
    before = _challenge_dict(c)
    data = payload.model_dump(exclude_unset=True)
    data.pop("create_new_version", None)
    status = data.pop("status", None)

    rule_changes = [f for f in RULE_AFFECTING_FIELDS if f in data and data[f] is not None and data[f] != getattr(c, f, None)]
    if c.status == ContentStatus.PUBLISHED and rule_changes and not payload.create_new_version:
        _audit(db, request, actor, "admin.content.updated", "challenge", c.id, result=models.AuditResult.DENIED, reason="rule change on published challenge requires create_new_version")
        raise err_response(
            "MUST_CREATE_NEW_VERSION",
            f"Fields {rule_changes} affect already-awarded results; set create_new_version=true",
            409,
        )

    for field, value in data.items():
        setattr(c, field, value)
    if status:
        if status not in [s.value for s in ContentStatus]:
            raise err_response("VALIDATION_ERROR", f"unknown status: {status}", 400)
        c.status = status

    if c.status == ContentStatus.PUBLISHED and rule_changes:
        snapshot = {
            "title": c.title,
            "rules": c.rules,
            "target_value": float(c.target_value) if c.target_value is not None else None,
            "starts_at": c.starts_at.isoformat() if c.starts_at else None,
            "ends_at": c.ends_at.isoformat() if c.ends_at else None,
            "eligibility": c.eligibility,
            "repeat_allowed": c.repeat_allowed,
        }
        version_row = ChallengeVersion(
            challenge_id=c.id,
            version=c.published_version + 1,
            snapshot=snapshot,
            changelog="; ".join(rule_changes),
            created_by=actor.id,
        )
        c.published_version += 1
        db.add(version_row)

    c.version = (c.version or 1) + 1
    db.commit()
    db.refresh(c)
    _audit(db, request, actor, "admin.content.updated", "challenge", c.id, before_summary=before, after_summary=_challenge_dict(c))
    return ok(_challenge_dict(c))


@router.post("/challenges/{challenge_id}/publish")
def publish_challenge(
    challenge_id: PyUUID,
    payload: StatusTransitionRequest,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("challenges:manage", critical=True)),
):
    require_confirm(payload, settings)
    c = db.query(Challenge).filter(Challenge.id == challenge_id, Challenge.deleted_at.is_(None)).first()
    if not c:
        raise err_response("NOT_FOUND", "Challenge not found", 404)
    if c.status != ContentStatus.DRAFT:
        raise err_response("INVALID_TRANSITION", f"Cannot publish from {c.status.value}", 409)
    if c.ends_at < date.today():
        raise err_response("VALIDATION_ERROR", "Challenge has already ended", 400)
    snapshot = {
        "title": c.title,
        "rules": c.rules,
        "target_value": float(c.target_value) if c.target_value is not None else None,
        "starts_at": c.starts_at.isoformat(),
        "ends_at": c.ends_at.isoformat(),
        "eligibility": c.eligibility,
        "repeat_allowed": c.repeat_allowed,
        "visibility": c.visibility.value if hasattr(c.visibility, "value") else str(c.visibility),
    }
    c.status = ContentStatus.PUBLISHED
    c.published_version = (c.published_version or 0) + 1
    c.version = (c.version or 1) + 1
    version_row = ChallengeVersion(challenge_id=c.id, version=c.published_version, snapshot=snapshot, created_by=actor.id)
    db.add(version_row)
    db.commit()
    _audit(db, request, actor, "admin.content.published", "challenge", c.id, after_summary={"version": c.published_version})
    return ok(_challenge_dict(c))


# ============================= PROMO CODES =============================

def _promo_dict(p: PromoCode) -> dict:
    return {
        "id": str(p.id),
        "code": p.code_normalized,  # allowed representation; the hash itself is never exposed
        "discount_type": p.discount_type.value if hasattr(p.discount_type, "value") else str(p.discount_type),
        "discount_value": float(p.discount_value),
        "currency": p.currency,
        "starts_at": p.starts_at.isoformat(),
        "ends_at": p.ends_at.isoformat(),
        "max_uses": p.max_uses,
        "used_count": p.used_count,
        "plan_codes": p.plan_codes,
        "segment": p.segment,
        "reason": p.reason,
        "status": p.status.value if hasattr(p.status, "value") else str(p.status),
        "version": p.version,
    }


def _promo_active_check(p: PromoCode, today: date):
    if p.status != PromoCodeStatus.ACTIVE:
        return f"promo code is {p.status.value}, not ACTIVE"
    if today < p.starts_at:
        return "promo code has not started"
    if today > p.ends_at:
        return "promo code has expired"
    return None


@router.get("/promo-codes")
def list_promo_codes(
    request: Request,
    q: Optional[str] = None,
    status_filter: Optional[str] = None,
    page: int = 1,
    pageSize: int = 20,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("promo:manage")),
):
    reject_unknown_query_params(request)
    page, page_size, _ = paginate_params(page, pageSize, None)
    qy = db.query(PromoCode).filter(PromoCode.deleted_at.is_(None))
    if q:
        qy = qy.filter(PromoCode.code_normalized.ilike(f"%{q.strip().upper()}%"))
    if status_filter:
        if status_filter not in [s.value for s in PromoCodeStatus]:
            raise err_response("VALIDATION_ERROR", f"unknown status: {status_filter}", 400)
        qy = qy.filter(PromoCode.status == status_filter)
    total = qy.count()
    items = qy.order_by(PromoCode.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return ok({"items": [_promo_dict(p) for p in items], "page": page, "pageSize": page_size, "total": total})


@router.post("/promo-codes", status_code=201)
def create_promo_code(
    payload: PromoCodeCreate,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("promo:manage", critical=True)),
):
    normalized = payload.code.strip().upper()
    code_hash = hashlib.sha256(f"promo:{normalized}".encode()).hexdigest()
    exists = db.query(PromoCode).filter(
        or_(PromoCode.code_normalized == normalized, PromoCode.code_hash == code_hash),
        PromoCode.deleted_at.is_(None),
    ).first()
    if exists:
        raise err_response("ALREADY_EXISTS", "Promo code already exists", 409)
    p = PromoCode(
        code_normalized=normalized,
        code_hash=code_hash,
        discount_type=payload.discount_type,
        discount_value=payload.discount_value,
        currency=payload.currency.upper(),
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        max_uses=payload.max_uses,
        plan_codes=payload.plan_codes,
        segment=payload.segment,
        reason=payload.reason,
        status=PromoCodeStatus.DRAFT,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    _audit(db, request, actor, "admin.promo.created", "promo_code", p.id, after_summary={"code": p.code_normalized, "status": "DRAFT"})
    return ok(_promo_dict(p))


@router.patch("/promo-codes/{promo_id}")
def update_promo_code(
    promo_id: PyUUID,
    payload: PromoCodeUpdate,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("promo:manage", critical=True)),
):
    p = db.query(PromoCode).filter(PromoCode.id == promo_id, PromoCode.deleted_at.is_(None)).first()
    if not p:
        raise err_response("NOT_FOUND", "Promo code not found", 404)
    before = _promo_dict(p)
    data = payload.model_dump(exclude_unset=True)
    status = data.pop("status", None)

    if status:
        if status not in [s.value for s in PromoCodeStatus]:
            raise err_response("VALIDATION_ERROR", f"unknown status: {status}", 400)
        # «нельзя активировать архивированный код» (SPEC-011 6.9)
        if p.status == PromoCodeStatus.ARCHIVED and status == PromoCodeStatus.ACTIVE.value:
            _audit(db, request, actor, "admin.promo.disabled", "promo_code", p.id, result=models.AuditResult.DENIED, reason="archived code cannot be activated")
            raise err_response("ARCHIVED", "Archived promo code cannot be activated", 409)
        if p.status == PromoCodeStatus.ACTIVE and status == PromoCodeStatus.ARCHIVED.value:
            action = "admin.promo.disabled"
        elif p.status == PromoCodeStatus.DRAFT and status == PromoCodeStatus.ACTIVE.value:
            action = "admin.promo.activated"
        else:
            action = "admin.promo.updated"
        p.status = status

    # Limit/terms changes must be audited with before/after (SPEC-011 6.9)
    limit_changed = ("max_uses" in data and data["max_uses"] != p.max_uses) or (
        "ends_at" in data and data["ends_at"] is not None and data["ends_at"] != p.ends_at
    )
    for field, value in data.items():
        setattr(p, field, value)
    p.version = (p.version or 1) + 1
    db.commit()
    db.refresh(p)
    action = "admin.promo.updated"
    if limit_changed:
        action = "admin.promo.terms_changed"
    _audit(db, request, actor, action, "promo_code", p.id, before_summary=before, after_summary=_promo_dict(p))
    return ok(_promo_dict(p))


@router.post("/promo-codes/{promo_id}/redeem")
def redeem_promo_code(
    promo_id: PyUUID,
    payload: RedeemRequest,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("promo:manage")),
):
    """Transactional, idempotent application (SPEC-011 6.9, 11.5):
    - same idempotency key -> the original result;
    - concurrent redemptions never exceed max_uses (atomic counter + unique constraint)."""
    from sqlalchemy import update as sa_update

    p = db.query(PromoCode).filter(PromoCode.id == promo_id, PromoCode.deleted_at.is_(None)).first()
    if not p:
        raise err_response("NOT_FOUND", "Promo code not found", 404)

    problem = _promo_active_check(p, date.today())
    if problem:
        raise err_response("PROMO_NOT_REDEEMABLE", problem, 400)

    # 1) Idempotency: the same key returns the original redemption
    if payload.idempotency_key:
        existing = db.query(PromoRedemption).filter(PromoRedemption.idempotency_key == payload.idempotency_key).first()
        if existing:
            return ok(
                {
                    "redemption_id": str(existing.id),
                    "promo_code_id": str(existing.promo_code_id),
                    "discount_applied": str(existing.discount_applied) if existing.discount_applied is not None else None,
                    "currency": existing.currency,
                    "already_applied": True,
                }
            )

    # 2) Atomic counter increment; 0 rows affected -> limit reached
    counter = (
        db.execute(
            sa_update(PromoCode)
            .where(PromoCode.id == p.id, (PromoCode.max_uses == 0) | (PromoCode.used_count < PromoCode.max_uses))
            .values(used_count=PromoCode.used_count + 1, version=PromoCode.version + 1)
        )
        .rowcount
    )
    if counter == 0:
        _audit(db, request, actor, "admin.promo.redeemed", "promo_code", p.id, result=models.AuditResult.FAILED, reason="limit reached")
        db.commit()
        raise err_response("LIMIT_REACHED", "Promo code usage limit reached", 409)

    # 3) Unique (code, user) double-guard against concurrent double redemption
    redemption = PromoRedemption(
        promo_code_id=p.id,
        user_id=payload.user_id,
        discount_applied=p.discount_value,
        currency=p.currency,
        idempotency_key=payload.idempotency_key,
    )
    db.add(redemption)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise err_response("ALREADY_REDEEMED", "This user already redeemed this promo code", 409)
    db.refresh(redemption)

    _audit(
        db,
        request,
        actor,
        "admin.promo.redeemed",
        "promo_code",
        p.id,
        reason=f"user {str(payload.user_id)[:8]}... used {p.code_normalized}",
        after_summary={"used_count": p.used_count, "discount_applied": str(redemption.discount_applied)},
    )
    return ok(
        {
            "redemption_id": str(redemption.id),
            "promo_code_id": str(p.id),
            "discount_applied": str(redemption.discount_applied),
            "currency": redemption.currency,
            "already_applied": False,
        }
    )
