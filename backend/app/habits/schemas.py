"""
Habit schemas
"""
import enum
from pydantic import EmailStr, Field, validator
from uuid import UUID
from datetime import datetime, time, date
from typing import List, Optional

from ..schemas.base import BaseSchema, TimestampedSchema


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


# We'll define the MessageTemplate enum later if needed, but for now we'll use a string and validate in the schema.


class HabitReminderBase(BaseSchema):
    time_local: str = Field(..., pattern=r"^([0-1][0-9]|2[0-3]):[0-5][0-9]$")
    weekdays: Optional[List[int]] = Field(None, min_items=1, max_items=7)
    timezone: str
    enabled: bool = True
    message_template: Optional[str] = None


class HabitReminderCreate(HabitReminderBase):
    pass


class HabitReminderUpdate(BaseSchema):
    time_local: Optional[str] = Field(None, pattern=r"^([0-1][0-9]|2[0-3]):[0-5][0-9]$")
    weekdays: Optional[List[int]] = Field(None, min_items=1, max_items=7)
    timezone: Optional[str] = None
    enabled: Optional[bool] = None
    message_template: Optional[str] = None


class HabitReminderResponse(TimestampedSchema):
    id: UUID
    habit_id: UUID
    time_local: str
    weekdays: Optional[List[int]]
    timezone: str
    enabled: bool
    message_template: Optional[str]


class HabitBase(BaseSchema):
    title: str = Field(..., min_length=1, max_length=100)
    type: HabitType
    goal_type: GoalType
    target_value: Optional[float] = Field(None, gt=0)  # nullable for BOOLEAN
    unit: Optional[str] = Field(None, max_length=50)  # nullable for BOOLEAN
    schedule_type: ScheduleType
    weekdays: Optional[List[int]] = Field(None, min_items=1, max_items=7)
    scheduled_local_date: Optional[date] = None
    timezone: str
    reminders: List[HabitReminderCreate] = Field(default_factory=list)


class HabitCreate(HabitBase):
    pass


class HabitUpdate(BaseSchema):
    title: Optional[str] = Field(None, min_length=1, max_length=100)
    target_value: Optional[float] = Field(None, gt=0)
    unit: Optional[str] = Field(None, max_length=50)
    schedule_type: Optional[ScheduleType] = None
    weekdays: Optional[List[int]] = Field(None, min_items=1, max_items=7)
    scheduled_local_date: Optional[date] = None
    timezone: Optional[str] = None
    reminders: Optional[List[HabitReminderUpdate]] = None
    # Note: we don't allow changing the type or goal_type after creation? The specification doesn't say.
    # We'll assume they are immutable for now.


class HabitResponse(TimestampedSchema):
    id: UUID
    user_id: UUID
    title: str
    type: HabitType
    goal_type: GoalType
    target_value: Optional[float]
    unit: Optional[str]
    schedule_type: ScheduleType
    weekdays: Optional[List[int]]
    scheduled_local_date: Optional[date]
    timezone: str
    status: HabitStatus
    current_streak: int
    best_streak: int
    last_completed_local_date: Optional[date]
    version: int
    # We'll add reminders to the response if needed
    # reminders: List[HabitReminderResponse] = []


class HabitTaskResponse(TimestampedSchema):
    id: UUID
    habit_id: UUID
    user_id: UUID
    local_date: date
    target_value: Optional[float]
    current_value: Optional[float]
    unit: Optional[str]
    status: TaskStatus
    completed_at: Optional[datetime]
    skipped_at: Optional[datetime]
    expired_at: Optional[datetime]
    skip_reason: Optional[SkipReason]
    version: int
    # Computed fields
    progress_percent: Optional[int] = None
    current_streak: int = 0  # from the habit
    # We'll add reminder info if needed


# Schemas for task updates
class TaskProgressUpdate(BaseSchema):
    version: int
    action: str = Field(..., pattern=r"^(ADD|SET)$")
    value: Optional[float] = Field(None, gt=0)  # For ADD and SET, value must be positive

    @validator('action')
    def action_must_be_add_or_set(cls, v):
        if v not in ['ADD', 'SET']:
            raise ValueError("action must be either 'ADD' or 'SET'")
        return v

    @validator('value')
    def value_required_for_add_and_set(cls, v, values):
        if 'action' in values and values['action'] in ['ADD', 'SET'] and v is None:
            raise ValueError("value is required for ADD and SET actions")
        return v


class TaskCompleteUpdate(BaseSchema):
    version: int
    status: TaskStatus = Field(TaskStatus.COMPLETED)


class TaskSkipUpdate(BaseSchema):
    version: int
    reason: SkipReason = Field(SkipReason.USER_DECISION)


# Schemas for the today endpoint
class HabitTodayResponse(BaseSchema):
    local_date: date
    timezone: str
    summary: dict
    items: List[HabitTaskResponse]


# We'll add more schemas as needed