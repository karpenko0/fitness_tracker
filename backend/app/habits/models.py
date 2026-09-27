"""
Habit models
"""
from sqlalchemy import Column, String, Boolean, UUID, Enum, DateTime, Numeric, ForeignKey, Index, UniqueConstraint, Integer, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import UUID as UUID_PG
import uuid
import enum

from ..models.base import Base, BaseModel


class HabitType(str, enum.Enum):
    WATER = "WATER"
    STEPS = "STEPS"
    SLEEP = "SLEEP"
    PROTEIN = "PROTEIN"
    MEDICATION = "MEDICATION"
    STRETCHING = "STRETCHING"
    CUSTOM = "CUSTOM"


class GoalType(str, enum.Enum):
    BOOLEAN = "BOOLEAN"
    COUNT = "COUNT"
    DURATION_MINUTES = "DURATION_MINUTES"
    QUANTITY = "QUANTITY"


class ScheduleType(str, enum.Enum):
    DAILY = "DAILY"
    WEEKDAYS = "WEEKDAYS"
    ONE_TIME = "ONE_TIME"


class HabitStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    PAUSED = "PAUSED"
    ARCHIVED = "ARCHIVED"
    DELETED = "DELETED"


class TaskStatus(str, enum.Enum):
    PENDING = "PENDING"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    SKIPPED = "SKIPPED"
    EXPIRED = "EXPIRED"
    CANCELLED = "CANCELLED"


class SkipReason(str, enum.Enum):
    USER_DECISION = "USER_DECISION"


class NotificationChannel(str, enum.Enum):
    TELEGRAM = "TELEGRAM"


class NotificationStatus(str, enum.Enum):
    PENDING = "PENDING"
    SENT = "SENT"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class MessageTemplate(str, enum.Enum):
    # We'll define the templates as per the specification examples
    # But note: the specification says it's an enum, but we don't have the exact list.
    # We'll leave it as a string for now and later define the enum if needed.
    # For now, we'll use a string and validate in the schema.
    pass


# We'll define the MessageTemplate enum later if needed, but for now we'll use a string column and validate in the schema.


class Habit(Base, BaseModel):
    """Habit model"""
    __tablename__ = "habits"

    id = Column(UUID_PG(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID_PG(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String(100), nullable=False)
    type = Column(Enum(HabitType), nullable=False)
    goal_type = Column(Enum(GoalType), nullable=False)
    target_value = Column(Numeric(precision=10, scale=2), nullable=True)  # nullable for BOOLEAN
    unit = Column(String(50), nullable=True)  # nullable for BOOLEAN
    schedule_type = Column(Enum(ScheduleType), nullable=False)
    weekdays = Column(JSON, nullable=True)  # list of integers [1,7]
    scheduled_local_date = Column(DateTime(timezone=False), nullable=True)  # DATE for ONE_TIME
    timezone = Column(String(64), nullable=False)  # IANA timezone
    status = Column(Enum(HabitStatus), default=HabitStatus.ACTIVE, nullable=False)
    current_streak = Column(Integer, default=0, nullable=False)
    best_streak = Column(Integer, default=0, nullable=False)
    last_completed_local_date = Column(DateTime(timezone=False), nullable=True)  # DATE
    version = Column(Integer, default=1, nullable=False)

    # Relationships
    tasks = relationship("HabitTask", back_populates="habit", cascade="all, delete-orphan")
    reminders = relationship("HabitReminder", back_populates="habit", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_habits_user_id_status", "user_id", "status"),
        Index("ix_habits_user_id_type", "user_id", "type"),
        # UniqueConstraint("user_id", "title", name="uq_user_id_title", postgresql_where=status == HabitStatus.ACTIVE),
        Index("ix_habits_status_updated_at", "status", "updated_at"),
    )


class HabitTask(Base, BaseModel):
    """Habit task model"""
    __tablename__ = "habit_tasks"

    id = Column(UUID_PG(as_uuid=True), primary_key=True, default=uuid.uuid4)
    habit_id = Column(UUID_PG(as_uuid=True), ForeignKey("habits.id"), nullable=False, index=True)
    user_id = Column(UUID_PG(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    local_date = Column(DateTime(timezone=False), nullable=False)  # DATE
    timezone = Column(String(64), nullable=False)  # IANA timezone at the time of creation
    target_value = Column(Numeric(precision=10, scale=2), nullable=True)  # snapshot of goal
    current_value = Column(Numeric(precision=10, scale=2), nullable=True)
    unit = Column(String(50), nullable=True)
    status = Column(Enum(TaskStatus), default=TaskStatus.PENDING, nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    skipped_at = Column(DateTime(timezone=True), nullable=True)
    expired_at = Column(DateTime(timezone=True), nullable=True)
    skip_reason = Column(Enum(SkipReason), nullable=True)
    version = Column(Integer, default=1, nullable=False)

# Relationships
    habit = relationship("Habit", back_populates="tasks")
    # notification_deliveries = relationship("HabitTask", back_populates="notification_deliveries")

    __table_args__ = (
        # UniqueConstraint("habit_id", "local_date", name="uq_habit_id_local_date"),
        # Index("ix_habit_tasks_user_id", "user_id"),
        # Index("ix_habit_tasks_local_date", "local_date"),
    )


class HabitReminder(Base, BaseModel):
    """Habit reminder model"""
    __tablename__ = "habit_reminders"

    id = Column(UUID_PG(as_uuid=True), primary_key=True, default=uuid.uuid4)
    habit_id = Column(UUID_PG(as_uuid=True), ForeignKey("habits.id"), nullable=False, index=True)
    time_local = Column(String(5), nullable=False)  # HH:mm
    weekdays = Column(JSON, nullable=True)  # list of integers [1,7] or null for DAILY
    timezone = Column(String(64), nullable=False)  # IANA timezone
    enabled = Column(Boolean, default=True, nullable=False)
    message_template = Column(String(50), nullable=True)  # We'll use string for now, can be enum later

    # Relationships
    habit = relationship("Habit", back_populates="reminders")

    __table_args__ = (
        # Index("ix_habit_reminders_habit_id", "habit_id"),
    )


class NotificationDelivery(Base, BaseModel):
    """Notification delivery model"""
    __tablename__ = "notification_deliveries"

    id = Column(UUID_PG(as_uuid=True), primary_key=True, default=uuid.uuid4)
    habit_task_id = Column(UUID_PG(as_uuid=True), ForeignKey("habit_tasks.id"), nullable=False, index=True)
    reminder_id = Column(UUID_PG(as_uuid=True), ForeignKey("habit_reminders.id"), nullable=False, index=True)
    user_id = Column(UUID_PG(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    channel = Column(Enum(NotificationChannel), nullable=False)  # TELEGRAM
    scheduled_at = Column(DateTime(timezone=True), nullable=False)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(Enum(NotificationStatus), nullable=False)
    attempt_count = Column(Integer, default=0, nullable=False)
    last_error_code = Column(String(50), nullable=True)

    # Relationships
    # habit_task = relationship("HabitTask", back_populates="notification_deliveries")
    # reminder = relationship("HabitReminder", back_populates="notification_deliveries")

    __table_args__ = (
        # UniqueConstraint("habit_task_id", "reminder_id", "scheduled_at", name="uq_habit_task_reminder_scheduled_at"),
        # Index("ix_notification_deliveries_user_id", "user_id"),
        # Index("ix_notification_deliveries_scheduled_at", "scheduled_at"),
        # Index("ix_notification_deliveries_status", "status"),
    )