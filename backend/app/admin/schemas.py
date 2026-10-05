"""Admin panel DTOs (SPEC-011 7). All request models are strict: unknown fields -> 422/400."""
from datetime import date, datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .common import ConfirmMixin, StrictModel
from .models_content import TEMPLATE_VARIABLE_WHITELIST


# ---------- auth ----------
class LoginRequest(StrictModel):
    email: str
    password: str


class MfaVerifyRequest(StrictModel):
    email: str
    password: str
    challenge_id: UUID
    code: str = Field(min_length=4, max_length=32)


class RevokeSessionRequest(ConfirmMixin):
    pass


# ---------- users ----------
class BlockRequest(ConfirmMixin):
    reason: str = Field(min_length=10, max_length=1000)


class UnblockRequest(ConfirmMixin):
    reason: Optional[str] = None


class RoleAssignRequest(ConfirmMixin):
    role: str


class BulkBlockRequest(ConfirmMixin):
    user_ids: List[UUID] = Field(min_length=1, max_length=500)
    # reason is only required for execution; preview needs no reason (SPEC-011 6.3)
    reason: Optional[str] = Field(default=None, min_length=10, max_length=1000)
    preview: bool = False  # True -> only the preview count is returned


class SoftDeleteUserRequest(ConfirmMixin):
    reason: str = Field(min_length=10, max_length=1000)
    anonymize: bool = True


# ---------- billing ----------
class WebhookReplayRequest(ConfirmMixin):
    pass


# ---------- exercises ----------
class ExerciseCreate(StrictModel):
    title: str = Field(min_length=1, max_length=255)
    slug: str = Field(min_length=2, max_length=255)
    description: Optional[str] = None
    type: str = Field(pattern="^(STRENGTH|CARDIO|MOBILITY|RECOVERY)$")
    difficulty: int = Field(default=1, ge=1, le=5)
    muscle_groups: Optional[List[str]] = None
    equipment: Optional[List[str]] = None
    instructions: Optional[Dict[str, List[str]]] = None
    contraindications: Optional[str] = None
    unit: Optional[str] = None
    localizations: Optional[Dict[str, Dict[str, Any]]] = None
    media_ids: Optional[List[UUID]] = None

    @field_validator("slug")
    @classmethod
    def slug_format(cls, v: str) -> str:
        import re

        v = v.strip().lower()
        if not re.match(r"^[a-z0-9]+(-[a-z0-9]+)*$", v):
            raise ValueError("slug must be kebab-case")
        return v


class ExerciseUpdate(StrictModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = None
    difficulty: Optional[int] = Field(default=None, ge=1, le=5)
    muscle_groups: Optional[List[str]] = None
    equipment: Optional[List[str]] = None
    instructions: Optional[Dict[str, List[str]]] = None
    contraindications: Optional[str] = None
    unit: Optional[str] = None
    localizations: Optional[Dict[str, Dict[str, Any]]] = None
    media_ids: Optional[List[UUID]] = None
    status: Optional[str] = None


class AlternativeCreate(StrictModel):
    alternative_exercise_id: UUID
    note: Optional[str] = Field(default=None, max_length=512)


class StatusTransitionRequest(ConfirmMixin):
    pass


# ---------- media ----------
class MediaCreate(StrictModel):
    filename: str = Field(min_length=1, max_length=255)
    kind: str = Field(pattern="^(IMAGE|VIDEO)$")
    mime_type: str = Field(min_length=3, max_length=127)
    content_base64: str  # MVP: direct upload; production uses pre-signed URL + backend confirm
    alt_text: Optional[str] = Field(default=None, max_length=512)


# ---------- programs ----------
class ProgramCreate(StrictModel):
    title: str = Field(min_length=1, max_length=255)
    slug: str = Field(min_length=2, max_length=255)
    description: Optional[str] = None
    goal: Optional[str] = None
    level: Optional[str] = None
    equipment: Optional[List[str]] = None
    duration_minutes: Optional[int] = Field(default=None, ge=1, le=10000)
    weeks: Optional[List[Dict[str, Any]]] = None
    progression_rules: Optional[Dict[str, Any]] = None
    localizations: Optional[Dict[str, Dict[str, Any]]] = None
    media_ids: Optional[List[UUID]] = None

    @field_validator("slug")
    @classmethod
    def slug_format(cls, v: str) -> str:
        import re

        v = v.strip().lower()
        if not re.match(r"^[a-z0-9]+(-[a-z0-9]+)*$", v):
            raise ValueError("slug must be kebab-case")
        return v


class ProgramUpdate(StrictModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = None
    goal: Optional[str] = None
    level: Optional[str] = None
    equipment: Optional[List[str]] = None
    duration_minutes: Optional[int] = Field(default=None, ge=1, le=10000)
    weeks: Optional[List[Dict[str, Any]]] = None
    progression_rules: Optional[Dict[str, Any]] = None
    localizations: Optional[Dict[str, Dict[str, Any]]] = None
    media_ids: Optional[List[UUID]] = None


class PublishRequest(ConfirmMixin):
    version: int = Field(ge=1)
    reason: Optional[str] = Field(default=None, max_length=1000)


class UnpublishRequest(ConfirmMixin):
    reason: Optional[str] = Field(default=None, max_length=1000)


class RollbackRequest(ConfirmMixin):
    version: int = Field(ge=1)


# ---------- notifications ----------
class TemplateCreate(StrictModel):
    name: str = Field(min_length=1, max_length=255)
    event: str = Field(min_length=1, max_length=128)
    channels: List[str] = Field(min_length=1)
    templates: Dict[str, str] = Field(min_length=1)
    timezone_policy: str = Field(default="user", pattern="^(user|fixed|none)$")
    timezone_fixed: Optional[str] = None
    quiet_hours_start: Optional[str] = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    quiet_hours_end: Optional[str] = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    rate_limit_per_day: int = Field(default=1, ge=1, le=100)

    @field_validator("channels")
    @classmethod
    def channels_valid(cls, v: List[str]) -> List[str]:
        allowed = {"TELEGRAM", "IN_APP", "EMAIL"}
        for c in v:
            if c not in allowed:
                raise ValueError(f"invalid channel: {c}")
        return v


class TemplateUpdate(StrictModel):
    name: Optional[str] = None
    channels: Optional[List[str]] = None
    templates: Optional[Dict[str, str]] = None
    timezone_policy: Optional[str] = None
    timezone_fixed: Optional[str] = None
    quiet_hours_start: Optional[str] = None
    quiet_hours_end: Optional[str] = None
    rate_limit_per_day: Optional[int] = Field(default=None, ge=1, le=100)
    status: Optional[str] = None


class CampaignCreate(StrictModel):
    template_id: UUID
    name: str = Field(min_length=1, max_length=255)
    audience_segment: Optional[Dict[str, Any]] = None
    reason: Optional[str] = Field(default=None, max_length=1000)


class CampaignConfirm(ConfirmMixin):
    pass


# ---------- habits catalog ----------
class HabitDefinitionCreate(StrictModel):
    title: str = Field(min_length=1, max_length=255)
    description: Optional[str] = None
    goal_type: str = Field(pattern="^(BOOLEAN|COUNT|DURATION_MINUTES|QUANTITY)$")
    target_value: Optional[float] = None
    unit: Optional[str] = None
    frequency: str = Field(default="DAILY", pattern="^(DAILY|WEEKDAYS|WEEKLY)$")
    allowed_min: Optional[float] = None
    allowed_max: Optional[float] = None
    reminders: Optional[List[Dict[str, Any]]] = None
    streak_policy: Optional[Dict[str, Any]] = None


class HabitDefinitionUpdate(StrictModel):
    title: Optional[str] = None
    description: Optional[str] = None
    target_value: Optional[float] = None
    unit: Optional[str] = None
    frequency: Optional[str] = None
    allowed_min: Optional[float] = None
    allowed_max: Optional[float] = None
    reminders: Optional[List[Dict[str, Any]]] = None
    streak_policy: Optional[Dict[str, Any]] = None
    status: Optional[str] = None


# ---------- challenges ----------
class ChallengeCreate(StrictModel):
    title: str = Field(min_length=1, max_length=255)
    description: Optional[str] = None
    type: str = Field(pattern="^(WORKOUT_COUNT|STREAK|VOLUME|HABIT_COMPLETION)$")
    starts_at: date
    ends_at: date
    rules: Dict[str, Any]
    target_value: Optional[float] = None
    eligibility: Optional[Dict[str, Any]] = None
    repeat_allowed: bool = False
    visibility: str = Field(default="PUBLIC", pattern="^(PUBLIC|PLAN_PRO|INTERNAL)$")

    @field_validator("ends_at")
    @classmethod
    def ends_after_start(cls, v: date, info) -> date:
        starts = info.data.get("starts_at")
        if starts and v < starts:
            raise ValueError("ends_at must be after starts_at")
        return v


class ChallengeUpdate(StrictModel):
    title: Optional[str] = None
    description: Optional[str] = None
    rules: Optional[Dict[str, Any]] = None
    target_value: Optional[float] = None
    eligibility: Optional[Dict[str, Any]] = None
    repeat_allowed: Optional[bool] = None
    visibility: Optional[str] = None
    status: Optional[str] = None
    create_new_version: bool = False


# ---------- promo codes ----------
class PromoCodeCreate(StrictModel):
    code: str = Field(min_length=3, max_length=64)
    discount_type: str = Field(pattern="^(PERCENT|FIXED)$")
    discount_value: float = Field(ge=0)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    starts_at: date
    ends_at: date
    max_uses: int = Field(default=0, ge=0)
    plan_codes: Optional[List[str]] = None
    segment: Optional[Dict[str, Any]] = None
    reason: str = Field(min_length=5, max_length=1000)

    @field_validator("discount_value")
    @classmethod
    def value_bounds(cls, v: float, info) -> float:
        dt = info.data.get("discount_type")
        if dt == "PERCENT" and (v < 0 or v > 100):
            raise ValueError("percent discount must be between 0 and 100")
        if dt == "FIXED" and v < 0:
            raise ValueError("fixed discount must not be negative")
        return v

    @field_validator("ends_at")
    @classmethod
    def ends_after_start(cls, v: date, info) -> date:
        starts = info.data.get("starts_at")
        if starts and v < starts:
            raise ValueError("ends_at must not be before starts_at")
        return v

    @field_validator("code")
    @classmethod
    def code_shape(cls, v: str) -> str:
        import re

        if not re.match(r"^[A-Za-z0-9_-]+$", v):
            raise ValueError("code must contain only letters, digits, '-' or '_'")
        return v.strip().upper()


class PromoCodeUpdate(StrictModel):
    status: Optional[str] = None
    max_uses: Optional[int] = Field(default=None, ge=0)
    ends_at: Optional[date] = None
    plan_codes: Optional[List[str]] = None
    segment: Optional[Dict[str, Any]] = None


class RedeemRequest(StrictModel):
    user_id: UUID
    idempotency_key: Optional[str] = Field(default=None, max_length=255)


# ---------- exports ----------
class ExportRequest(ConfirmMixin):
    entity_type: str = Field(pattern="^(users|payments|subscriptions|exercises|programs|promo_codes|audit_logs|notifications|challenges|habits)$")
    filters: Optional[Dict[str, Any]] = None


class AnalyticsFilters(StrictModel):
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    period_days: Optional[int] = Field(default=30, ge=1, le=365)
    timezone: Optional[str] = Field(default="UTC", max_length=64)
    plan: Optional[str] = None
    locale: Optional[str] = None
    platform: Optional[str] = None


class MfaChallengeResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
