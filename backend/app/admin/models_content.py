"""Content domain models (SPEC-011): exercises, alternatives, media, programs with
versions, notification templates/campaigns, habit catalog, challenges, promo codes."""
import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Column, Date, DateTime, Enum, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as UUID_PG

from ..models.base import Base, BaseModel
from .models_core import JsonB


class ContentStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    IN_REVIEW = "IN_REVIEW"
    APPROVED = "APPROVED"
    PUBLISHED = "PUBLISHED"
    ARCHIVED = "ARCHIVED"
    REJECTED = "REJECTED"


# Workflow transitions allowed by SPEC-011 6.6
CONTENT_TRANSITIONS = {
    ContentStatus.DRAFT: {ContentStatus.IN_REVIEW, ContentStatus.DRAFT},
    ContentStatus.IN_REVIEW: {ContentStatus.APPROVED, ContentStatus.REJECTED, ContentStatus.DRAFT},
    ContentStatus.APPROVED: {ContentStatus.PUBLISHED, ContentStatus.DRAFT, ContentStatus.IN_REVIEW},
    ContentStatus.PUBLISHED: {ContentStatus.ARCHIVED, ContentStatus.DRAFT},  # unpublish -> archive; edit -> new draft version
    ContentStatus.ARCHIVED: set(),
    ContentStatus.REJECTED: {ContentStatus.DRAFT},
}


class ExerciseType(str, enum.Enum):
    STRENGTH = "STRENGTH"
    CARDIO = "CARDIO"
    MOBILITY = "MOBILITY"
    RECOVERY = "RECOVERY"


class MediaKind(str, enum.Enum):
    IMAGE = "IMAGE"
    VIDEO = "VIDEO"


class MediaStatus(str, enum.Enum):
    VALIDATED = "VALIDATED"
    REJECTED = "REJECTED"


class Exercise(Base, BaseModel):
    """Catalog exercise (SPEC-011 6.5)."""

    __tablename__ = "exercises"

    id = Column(UUID_PG(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title = Column(String(255), nullable=False)
    slug = Column(String(255), nullable=False, unique=True, index=True)
    description = Column(Text, nullable=True)
    type = Column(Enum(ExerciseType), nullable=False)
    difficulty = Column(Integer, default=1, nullable=False)  # 1..5
    muscle_groups = Column(JsonB, nullable=True)  # ["chest", "triceps", ...]
    equipment = Column(JsonB, nullable=True)  # ["dumbbell", "barbell", ...]
    instructions = Column(JsonB, nullable=True)  # {"ru": [...steps], "en": [...]}
    contraindications = Column(Text, nullable=True)
    unit = Column(String(50), nullable=True)  # reps | kg | minutes
    localizations = Column(JsonB, nullable=True)  # {"ru": {...}, "en": {...}}
    media_ids = Column(JsonB, nullable=True)  # [media_asset_id]
    status = Column(Enum(ContentStatus), default=ContentStatus.DRAFT, nullable=False, index=True)
    published_version = Column(Integer, default=0, nullable=False)
    version = Column(Integer, default=1, nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)  # soft delete

    __table_args__ = (
        Index("ix_exercises_status_type", "status", "type"),
    )


class ExerciseAlternative(Base, BaseModel):
    """Compatibility link between exercises. Cycles are rejected at save time."""

    __tablename__ = "exercise_alternatives"

    id = Column(UUID_PG(as_uuid=True), primary_key=True, default=uuid.uuid4)
    exercise_id = Column(UUID_PG(as_uuid=True), ForeignKey("exercises.id"), nullable=False, index=True)
    alternative_exercise_id = Column(UUID_PG(as_uuid=True), ForeignKey("exercises.id"), nullable=False, index=True)
    note = Column(String(512), nullable=True)
    version = Column(Integer, default=1, nullable=False)

    __table_args__ = (
        UniqueConstraint("exercise_id", "alternative_exercise_id", name="uq_exercise_alternative"),
    )


class MediaAsset(Base, BaseModel):
    """Media file metadata. Public URL is an opaque token, internal path never exposed."""

    __tablename__ = "media_assets"

    id = Column(UUID_PG(as_uuid=True), primary_key=True, default=uuid.uuid4)
    filename = Column(String(255), nullable=False)
    kind = Column(Enum(MediaKind), nullable=False)
    mime_type = Column(String(127), nullable=False)
    size_bytes = Column(Integer, nullable=False)
    checksum_sha256 = Column(String(64), nullable=False)
    status = Column(Enum(MediaStatus), default=MediaStatus.VALIDATED, nullable=False)
    rejection_reason = Column(String(255), nullable=True)
    storage_path = Column(String(512), nullable=True)  # internal only
    public_token = Column(String(64), nullable=False, unique=True, index=True)
    alt_text = Column(String(512), nullable=True)
    created_by = Column(UUID_PG(as_uuid=True), ForeignKey("users.id"), nullable=True)
    version = Column(Integer, default=1, nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)


class Program(Base, BaseModel):
    """Training program with publication workflow and versioning (SPEC-011 6.6)."""

    __tablename__ = "programs"

    id = Column(UUID_PG(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title = Column(String(255), nullable=False)
    slug = Column(String(255), nullable=False, unique=True, index=True)
    description = Column(Text, nullable=True)
    goal = Column(String(64), nullable=True)  # STRENGTH | WEIGHT_LOSS | ENDURANCE ...
    level = Column(String(32), nullable=True)  # BEGINNER | MIDDLE | ADVANCED
    equipment = Column(JsonB, nullable=True)  # program-level equipment set
    duration_minutes = Column(Integer, nullable=True)
    weeks = Column(JsonB, nullable=True)  # [[{workout}]] nested structure
    progression_rules = Column(JsonB, nullable=True)
    localizations = Column(JsonB, nullable=True)
    media_ids = Column(JsonB, nullable=True)
    status = Column(Enum(ContentStatus), default=ContentStatus.DRAFT, nullable=False, index=True)
    published_version = Column(Integer, default=0, nullable=False)
    version = Column(Integer, default=1, nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)


class ProgramVersion(Base, BaseModel):
    """Immutable snapshot of a published program version; kept for history and rollback."""

    __tablename__ = "program_versions"

    id = Column(UUID_PG(as_uuid=True), primary_key=True, default=uuid.uuid4)
    program_id = Column(UUID_PG(as_uuid=True), ForeignKey("programs.id"), nullable=False, index=True)
    version = Column(Integer, nullable=False)
    snapshot = Column(JsonB, nullable=False)  # full program state at publication
    changelog = Column(Text, nullable=True)
    published_by = Column(UUID_PG(as_uuid=True), ForeignKey("users.id"), nullable=True)
    published_at = Column(DateTime(timezone=True), nullable=True)
    reverted = Column(Boolean, default=False, nullable=False)

    __table_args__ = (
        UniqueConstraint("program_id", "version", name="uq_program_versions_program_version"),
    )


class NotificationChannel(str, enum.Enum):
    TELEGRAM = "TELEGRAM"
    IN_APP = "IN_APP"
    EMAIL = "EMAIL"


class TemplateStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    ACTIVE = "ACTIVE"
    ARCHIVED = "ARCHIVED"


# Whitelist of variables allowed inside templates (SPEC-011 6.7)
TEMPLATE_VARIABLE_WHITELIST = ("{user_name}", "{app_name}", "{date}", "{workout_name}", "{streak_days}")


class NotificationTemplate(Base, BaseModel):
    __tablename__ = "notification_templates"

    id = Column(UUID_PG(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    event = Column(String(128), nullable=False)  # trigger event
    channels = Column(JsonB, nullable=False)  # ["TELEGRAM", "IN_APP"]
    templates = Column(JsonB, nullable=False)  # {"ru": "text with {user_name}", "en": "..."}
    timezone_policy = Column(String(32), default="user", nullable=False)  # user | fixed | none
    timezone_fixed = Column(String(64), nullable=True)
    quiet_hours_start = Column(String(5), nullable=True)  # "22:00"
    quiet_hours_end = Column(String(5), nullable=True)  # "08:00"
    rate_limit_per_day = Column(Integer, default=1, nullable=False)
    status = Column(Enum(TemplateStatus), default=TemplateStatus.DRAFT, nullable=False, index=True)
    version = Column(Integer, default=1, nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)


class CampaignStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    PREVIEWED = "PREVIEWED"
    SCHEDULED = "SCHEDULED"
    SENT = "SENT"
    CANCELLED = "CANCELLED"


class NotificationCampaign(Base, BaseModel):
    """Mass notification: preview -> count -> confirm -> sent. Resending is impossible (idempotent)."""

    __tablename__ = "notification_campaigns"

    id = Column(UUID_PG(as_uuid=True), primary_key=True, default=uuid.uuid4)
    template_id = Column(UUID_PG(as_uuid=True), ForeignKey("notification_templates.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    audience_segment = Column(JsonB, nullable=True)  # e.g. {"role": "user", "plan": "pro"}
    status = Column(Enum(CampaignStatus), default=CampaignStatus.DRAFT, nullable=False, index=True)
    expected_recipients = Column(Integer, nullable=True)
    sent_count = Column(Integer, default=0, nullable=False)
    confirmed_by = Column(UUID_PG(as_uuid=True), ForeignKey("users.id"), nullable=True)
    confirmed_at = Column(DateTime(timezone=True), nullable=True)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    reason = Column(Text, nullable=True)
    version = Column(Integer, default=1, nullable=False)


class HabitFrequency(str, enum.Enum):
    DAILY = "DAILY"
    WEEKDAYS = "WEEKDAYS"
    WEEKLY = "WEEKLY"


class HabitGoalType(str, enum.Enum):
    BOOLEAN = "BOOLEAN"
    COUNT = "COUNT"
    DURATION_MINUTES = "DURATION_MINUTES"
    QUANTITY = "QUANTITY"


class HabitCatalogStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    PUBLISHED = "PUBLISHED"
    ARCHIVED = "ARCHIVED"


class HabitDefinition(Base, BaseModel):
    """Published habit catalog (definitions users can subscribe to).
    Changing a definition never rewrites users' historical completions (separate tables)."""

    __tablename__ = "habit_definitions"

    id = Column(UUID_PG(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    goal_type = Column(Enum(HabitGoalType), nullable=False)
    target_value = Column(Numeric(10, 2), nullable=True)
    unit = Column(String(50), nullable=True)
    frequency = Column(Enum(HabitFrequency), default=HabitFrequency.DAILY, nullable=False)
    allowed_min = Column(Numeric(10, 2), nullable=True)
    allowed_max = Column(Numeric(10, 2), nullable=True)
    reminders = Column(JsonB, nullable=True)  # [{"time": "09:00", "weekdays": [1,3,5]}]
    streak_policy = Column(JsonB, nullable=True)  # {"gap_tolerance_days": 1}
    status = Column(Enum(HabitCatalogStatus), default=HabitCatalogStatus.DRAFT, nullable=False, index=True)
    version = Column(Integer, default=1, nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)


class ChallengeType(str, enum.Enum):
    WORKOUT_COUNT = "WORKOUT_COUNT"
    STREAK = "STREAK"
    VOLUME = "VOLUME"
    HABIT_COMPLETION = "HABIT_COMPLETION"


class ChallengeVisibility(str, enum.Enum):
    PUBLIC = "PUBLIC"
    PLAN_PRO = "PLAN_PRO"
    INTERNAL = "INTERNAL"


class Challenge(Base, BaseModel):
    __tablename__ = "challenge_definitions"

    id = Column(UUID_PG(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    type = Column(Enum(ChallengeType), nullable=False)
    starts_at = Column(Date, nullable=False)
    ends_at = Column(Date, nullable=False)
    rules = Column(JsonB, nullable=False)  # type-specific rules
    target_value = Column(Numeric(10, 2), nullable=True)
    eligibility = Column(JsonB, nullable=True)  # participation conditions
    repeat_allowed = Column(Boolean, default=False, nullable=False)
    visibility = Column(Enum(ChallengeVisibility), default=ChallengeVisibility.PUBLIC, nullable=False)
    status = Column(Enum(ContentStatus), default=ContentStatus.DRAFT, nullable=False, index=True)
    published_version = Column(Integer, default=0, nullable=False)
    version = Column(Integer, default=1, nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)


class ChallengeVersion(Base, BaseModel):
    """Immutable snapshot; a published challenge may only change rules via a new version."""

    __tablename__ = "challenge_versions"

    id = Column(UUID_PG(as_uuid=True), primary_key=True, default=uuid.uuid4)
    challenge_id = Column(UUID_PG(as_uuid=True), ForeignKey("challenge_definitions.id"), nullable=False, index=True)
    version = Column(Integer, nullable=False)
    snapshot = Column(JsonB, nullable=False)
    changelog = Column(Text, nullable=True)
    created_by = Column(UUID_PG(as_uuid=True), ForeignKey("users.id"), nullable=True)

    __table_args__ = (
        UniqueConstraint("challenge_id", "version", name="uq_challenge_versions_challenge_version"),
    )


class DiscountType(str, enum.Enum):
    PERCENT = "PERCENT"
    FIXED = "FIXED"


class PromoCodeStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    ACTIVE = "ACTIVE"
    ARCHIVED = "ARCHIVED"
    EXPIRED = "EXPIRED"


class PromoCode(Base, BaseModel):
    """Promo code. The code is stored normalized + hashed; UI only gets the allowed view."""

    __tablename__ = "promo_codes"

    id = Column(UUID_PG(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code_normalized = Column(String(128), nullable=False, index=True)  # upper-case, trimmed
    code_hash = Column(String(64), nullable=False, unique=True, index=True)
    discount_type = Column(Enum(DiscountType), nullable=False)
    discount_value = Column(Numeric(10, 2), nullable=False)  # 0..100 for PERCENT, amount for FIXED
    currency = Column(String(3), default="USD", nullable=False)
    starts_at = Column(Date, nullable=False)
    ends_at = Column(Date, nullable=False)
    max_uses = Column(Integer, default=0, nullable=False)  # 0 = unlimited
    used_count = Column(Integer, default=0, nullable=False)
    plan_codes = Column(JsonB, nullable=True)  # applicable plans, null = all
    segment = Column(JsonB, nullable=True)
    reason = Column(Text, nullable=True)
    status = Column(Enum(PromoCodeStatus), default=PromoCodeStatus.DRAFT, nullable=False, index=True)
    version = Column(Integer, default=1, nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)


class PromoRedemption(Base, BaseModel):
    """One redemption per (code, user); unique constraint enforces idempotency under concurrency."""

    __tablename__ = "promo_redemptions"

    id = Column(UUID_PG(as_uuid=True), primary_key=True, default=uuid.uuid4)
    promo_code_id = Column(UUID_PG(as_uuid=True), ForeignKey("promo_codes.id"), nullable=False, index=True)
    user_id = Column(UUID_PG(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    discount_applied = Column(Numeric(12, 2), nullable=True)
    currency = Column(String(3), nullable=True)
    idempotency_key = Column(String(255), unique=True, nullable=True)

    __table_args__ = (
        UniqueConstraint("promo_code_id", "user_id", name="uq_promo_redemptions_code_user"),
    )
