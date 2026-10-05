"""
Habit services
"""
import logging
from datetime import datetime, date, time, timedelta
from typing import List, Optional, Tuple
import pytz
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, func, extract
from uuid import UUID

from ..models import User
from . import models, schemas

logger = logging.getLogger(__name__)


def get_user_timezone(user: User) -> pytz.timezone:
    """Get pytz timezone object for user"""
    try:
        return pytz.timezone(user.timezone)
    except pytz.exceptions.UnknownTimeZoneError:
        logger.warning(f"Unknown timezone {user.timezone} for user {user.id}, using UTC")
        return pytz.UTC


def local_date_to_utc(dt: date, tz: pytz.timezone) -> datetime:
    """Convert local date to UTC datetime at start of day"""
    local_dt = tz.localize(datetime.combine(dt, time.min))
    return local_dt.astimezone(pytz.UTC)


def utc_to_local_date(utc_dt: datetime, tz: pytz.timezone) -> date:
    """Convert UTC datetime to local date"""
    local_dt = utc_dt.astimezone(tz)
    return local_dt.date()


def get_or_create_today_task(db: Session, user: User, habit: models.Habit) -> models.HabitTask:
    """Get or create today's task for a habit"""
    user_tz = get_user_timezone(user)
    today_local = utc_to_local_date(datetime.now(pytz.UTC), user_tz)
    
    # Check if a task already exists for today
    task = db.query(models.HabitTask).filter(
        models.HabitTask.habit_id == habit.id,
        models.HabitTask.local_date == today_local
    ).first()
    
    if task:
        return task
    
    # Create a new task for today
    task = models.HabitTask(
        habit_id=habit.id,
        user_id=user.id,
        local_date=today_local,
        timezone=habit.timezone,  # Use the habit's timezone (should be same as user's)
        target_value=habit.target_value,
        current_value=None,
        unit=habit.unit,
        status=models.TaskStatus.PENDING,
        version=1
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def update_task_progress(db: Session, user: User, task_id: UUID, payload: schemas.TaskProgressUpdate) -> models.HabitTask:
    """Update task progress with ADD or SET"""
    task = db.query(models.HabitTask).filter(
        models.HabitTask.id == task_id,
        models.HabitTask.user_id == user.id
    ).first()
    
    if not task:
        raise ValueError("Task not found")
    
    if task.status != models.TaskStatus.PENDING and task.status != models.TaskStatus.IN_PROGRESS:
        raise ValueError("Task cannot be updated")
    
    # Check if the task is for today (local date)
    user_tz = get_user_timezone(user)
    today_local = utc_to_local_date(datetime.now(pytz.UTC), user_tz)
    if task.local_date != today_local:
        raise ValueError("Can only update tasks for today")
    
    # Check version for optimistic locking
    if task.version != payload.version:
        raise ValueError("Task version mismatch")
    
    # Update the task (convert to Decimal to match the Numeric column)
    from decimal import Decimal
    value = Decimal(str(payload.value))
    if payload.action == "ADD":
        if task.current_value is None:
            task.current_value = value
        else:
            task.current_value += value
    elif payload.action == "SET":
        task.current_value = value
    
    # Check if the goal is reached
    if task.current_value is not None and task.target_value is not None:
        if task.current_value >= task.target_value:
            task.status = models.TaskStatus.COMPLETED
            task.completed_at = datetime.now(pytz.UTC)
    
    task.version += 1
    task.updated_at = datetime.now(pytz.UTC)
    
    db.commit()
    db.refresh(task)
    
    # Update the habit's streak if the task is completed
    if task.status == models.TaskStatus.COMPLETED:
        habit = db.query(models.Habit).filter(models.Habit.id == task.habit_id).first()
        if habit:
            update_streak(db, habit)
    
    return task


def complete_task(db: Session, user: User, task_id: UUID, payload: schemas.TaskCompleteUpdate) -> models.HabitTask:
    """Mark a task as completed"""
    task = db.query(models.HabitTask).filter(
        models.HabitTask.id == task_id,
        models.HabitTask.user_id == user.id
    ).first()
    
    if not task:
        raise ValueError("Task not found")
    
    if task.status != models.TaskStatus.PENDING and task.status != models.TaskStatus.IN_PROGRESS:
        raise ValueError("Task cannot be completed")
    
    # Check if the task is for today (local date)
    user_tz = get_user_timezone(user)
    today_local = utc_to_local_date(datetime.now(pytz.UTC), user_tz)
    if task.local_date != today_local:
        raise ValueError("Can only complete tasks for today")
    
    # Check version for optimistic locking
    if task.version != payload.version:
        raise ValueError("Task version mismatch")
    
    # Mark as completed
    task.status = models.TaskStatus.COMPLETED
    task.completed_at = datetime.now(pytz.UTC)
    task.version += 1
    task.updated_at = datetime.now(pytz.UTC)
    
    db.commit()
    db.refresh(task)
    
    # Update the habit's streak
    update_streak(db, task.habit)
    
    return task


def skip_task(db: Session, user: User, task_id: UUID, payload: schemas.TaskSkipUpdate) -> models.HabitTask:
    """Mark a task as skipped"""
    task = db.query(models.HabitTask).filter(
        models.HabitTask.id == task_id,
        models.HabitTask.user_id == user.id
    ).first()
    
    if not task:
        raise ValueError("Task not found")
    
    if task.status != models.TaskStatus.PENDING and task.status != models.TaskStatus.IN_PROGRESS:
        raise ValueError("Task cannot be skipped")
    
    # Check if the task is for today (local date)
    user_tz = get_user_timezone(user)
    today_local = utc_to_local_date(datetime.now(pytz.UTC), user_tz)
    if task.local_date != today_local:
        raise ValueError("Can only skip tasks for today")
    
    # Check version for optimistic locking
    if task.version != payload.version:
        raise ValueError("Task version mismatch")
    
    # Mark as skipped
    task.status = models.TaskStatus.SKIPPED
    task.skipped_at = datetime.now(pytz.UTC)
    task.skip_reason = payload.reason
    task.version += 1
    task.updated_at = datetime.now(pytz.UTC)
    
    db.commit()
    db.refresh(task)
    
    # Update the habit's streak (skipping breaks the streak)
    update_streak(db, task.habit)
    
    return task


def update_streak(db: Session, habit: models.Habit):
    """Update the streak for a habit based on completed tasks"""
    # Get the user to determine today's local date
    user = db.query(User).filter(User.id == habit.user_id).first()
    if not user:
        logger.warning(f"User not found for habit {habit.id}")
        return
    
    user_tz = get_user_timezone(user)
    today_local = utc_to_local_date(datetime.now(pytz.UTC), user_tz)
    
    # Get all tasks for the habit, ordered by local_date ascending
    tasks = db.query(models.HabitTask).filter(
        models.HabitTask.habit_id == habit.id
    ).order_by(models.HabitTask.local_date.asc()).all()
    
    current_streak = 0
    best_streak = 0
    last_completed_local_date = None
    
    for task in tasks:
        # Stop if we are beyond today (future tasks)
        if task.local_date > today_local:
            break
        
        if task.status == models.TaskStatus.COMPLETED:
            current_streak += 1
            if current_streak > best_streak:
                best_streak = current_streak
            last_completed_local_date = task.local_date
        elif task.status in (models.TaskStatus.SKIPPED, models.TaskStatus.EXPIRED):
            current_streak = 0
        # For PENDING, IN_PROGRESS, CANCELLED: do not break streak, but do not increment
        # Also, if the task is for today and is not completed, we do not break the streak (as per spec)
        # So we just continue without changing current_streak
    
    # Update the habit
    habit.current_streak = current_streak
    habit.best_streak = best_streak
    habit.last_completed_local_date = last_completed_local_date
    habit.version += 1
    habit.updated_at = datetime.now(pytz.UTC)
    
    db.add(habit)
    db.commit()
    db.refresh(habit)


def create_habit(db: Session, user: User, habit_in: schemas.HabitCreate) -> models.Habit:
    """Create a new habit for the user"""
    # Check if user already has an active habit with the same title (case-insensitive)
    existing = db.query(models.Habit).filter(
        models.Habit.user_id == user.id,
        models.Habit.status == models.HabitStatus.ACTIVE,
        func.lower(models.Habit.title) == habit_in.title.lower()
    ).first()
    if existing:
        raise ValueError("Habit with this title already exists")

    # Check active habits limit (max 20 per user)
    active_habits_count = db.query(models.Habit).filter(
        models.Habit.user_id == user.id,
        models.Habit.status == models.HabitStatus.ACTIVE
    ).count()
    if active_habits_count >= 20:
        raise ValueError("Cannot have more than 20 active habits")

    # Validate goal type and target_value/unit based on habit type
    if habit_in.type == models.HabitType.MEDICATION:
        if habit_in.goal_type != models.GoalType.BOOLEAN:
            raise ValueError("MEDICATION habit must have BOOLEAN goal type")
        if habit_in.target_value is not None:
            raise ValueError("MEDICATION habit must have target_value as null")
        if habit_in.unit is not None:
            raise ValueError("MEDICATION habit must have unit as null")
    elif habit_in.type == models.HabitType.STEPS:
        if habit_in.goal_type != models.GoalType.COUNT:
            raise ValueError("STEPS habit must have COUNT goal type")
        if habit_in.unit != "STEPS":
            raise ValueError("STEPS habit must have unit STEPS")
    elif habit_in.type == models.HabitType.WATER:
        if habit_in.goal_type != models.GoalType.QUANTITY:
            raise ValueError("WATER habit must have QUANTITY goal type")
        if habit_in.unit != "ML":
            raise ValueError("WATER habit must have unit ML")
    elif habit_in.type in (models.HabitType.SLEEP, models.HabitType.STRETCHING):
        if habit_in.goal_type != models.GoalType.DURATION_MINUTES:
            raise ValueError(f"{habit_in.type.value} habit must have DURATION_MINUTES goal type")
    elif habit_in.type == models.HabitType.PROTEIN:
        if habit_in.goal_type != models.GoalType.QUANTITY:
            raise ValueError("PROTEIN habit must have QUANTITY goal type")
        if habit_in.unit != "GRAMS":
            raise ValueError("PROTEIN habit must have unit GRAMS")
    else:
        # For CUSTOM habit, validate general constraints
        if habit_in.goal_type == models.GoalType.BOOLEAN:
            if habit_in.target_value is not None or habit_in.unit is not None:
                raise ValueError("BOOLEAN goal type must have target_value and unit as null")
        else:
            if habit_in.target_value is None:
                raise ValueError("target_value is required for non-BOOLEAN goal types")
            if habit_in.unit is None:
                raise ValueError("unit is required for non-BOOLEAN goal types")

    # Validate schedule type
    if habit_in.schedule_type == models.ScheduleType.DAILY:
        if habit_in.weekdays is not None:
            raise ValueError("weekdays must be null for DAILY schedule")
    elif habit_in.schedule_type == models.ScheduleType.WEEKDAYS:
        if habit_in.weekdays is None or len(habit_in.weekdays) == 0:
            raise ValueError("weekdays must be provided for WEEKDAYS schedule")
        if len(habit_in.weekdays) > 7:
            raise ValueError("weekdays must have at most 7 values")
        if len(set(habit_in.weekdays)) != len(habit_in.weekdays):
            raise ValueError("weekdays must contain unique values")
        for day in habit_in.weekdays:
            if day < 1 or day > 7:
                raise ValueError("weekdays must be between 1 and 7")
    elif habit_in.schedule_type == models.ScheduleType.ONE_TIME:
        if habit_in.scheduled_local_date is None:
            raise ValueError("scheduled_local_date is required for ONE_TIME schedule")
        if habit_in.weekdays is not None:
            raise ValueError("weekdays must be null for ONE_TIME schedule")

    # Validate reminders count per habit (max 3)
    if len(habit_in.reminders) > 3:
        raise ValueError("Cannot have more than 3 reminders per habit")

    # Validate active reminders per user (max 30)
    # Count current active reminders for the user (enabled reminders where habit is active)
    current_active_reminders = db.query(models.HabitReminder).join(models.Habit).filter(
        models.Habit.user_id == user.id,
        models.Habit.status == models.HabitStatus.ACTIVE,
        models.HabitReminder.enabled == True
    ).count()
    # Count new reminders that are enabled
    new_enabled_reminders = sum(1 for r in habit_in.reminders if r.enabled)
    if current_active_reminders + new_enabled_reminders > 30:
        raise ValueError("Cannot have more than 30 active reminders per user")

    # Create habit
    habit = models.Habit(
        user_id=user.id,
        title=habit_in.title,
        type=habit_in.type,
        goal_type=habit_in.goal_type,
        target_value=habit_in.target_value,
        unit=habit_in.unit,
        schedule_type=habit_in.schedule_type,
        weekdays=habit_in.weekdays,
        scheduled_local_date=habit_in.scheduled_local_date,
        timezone=habit_in.timezone,
        status=models.HabitStatus.ACTIVE,
        current_streak=0,
        best_streak=0,
        last_completed_local_date=None,
        version=1
    )
    db.add(habit)
    db.flush()  # Flush to get the habit.id before creating reminders

    # Create reminders if provided
    for reminder_in in habit_in.reminders:
        reminder = models.HabitReminder(
            habit_id=habit.id,
            time_local=reminder_in.time_local,
            weekdays=reminder_in.weekdays,
            timezone=reminder_in.timezone,
            enabled=reminder_in.enabled,
            message_template=reminder_in.message_template
        )
        db.add(reminder)

    db.commit()
    db.refresh(habit)
    return habit


def get_habits(db: Session, user: User, status: Optional[schemas.HabitStatus] = None,
               habit_type: Optional[schemas.HabitType] = None, include_today: bool = False) -> List[models.Habit]:
    """Get habits for the user with optional filters"""
    query = db.query(models.Habit).filter(models.Habit.user_id == user.id)
    if status:
        query = query.filter(models.Habit.status == status)
    if habit_type:
        query = query.filter(models.Habit.type == habit_type)
    habits = query.all()
    if include_today:
        # We'll add today's task info to each habit? Or we can return the habits and let the caller add task info.
        # For now, we'll just return the habits.
        pass
    return habits


def get_habit(db: Session, user: User, habit_id: UUID) -> Optional[models.Habit]:
    """Get a habit by id for the user"""
    return db.query(models.Habit).filter(
        models.Habit.id == habit_id,
        models.Habit.user_id == user.id
    ).first()


def update_habit(db: Session, user: User, habit_id: UUID, habit_in: schemas.HabitUpdate) -> models.Habit:
    """Update a habit"""
    habit = get_habit(db, user, habit_id)
    if not habit:
        raise ValueError("Habit not found")

    # Check for title uniqueness if title is being updated
    if isinstance(habit_in, dict):
        title_to_check = habit_in.get('title')
        if title_to_check is not None and title_to_check != habit.title:
            existing = db.query(models.Habit).filter(
                models.Habit.user_id == user.id,
                models.Habit.status == models.HabitStatus.ACTIVE,
                func.lower(models.Habit.title) == title_to_check.lower(),
                models.Habit.id != habit_id
            ).first()
            if existing:
                raise ValueError("Habit with this title already exists")
    else:
        if habit_in.title is not None and habit_in.title != habit.title:
            existing = db.query(models.Habit).filter(
                models.Habit.user_id == user.id,
                models.Habit.status == models.HabitStatus.ACTIVE,
                func.lower(models.Habit.title) == habit_in.title.lower(),
                models.Habit.id != habit_id
            ).first()
            if existing:
                raise ValueError("Habit with this title already exists")

    # Update fields
    update_data = habit_in.dict(exclude_unset=True) if not isinstance(habit_in, dict) else habit_in
    # Handle reminders separately
    reminders_data = update_data.pop('reminders', None) if not isinstance(habit_in, dict) else update_data.get('reminders')
    
    for field, value in update_data.items():
        setattr(habit, field, value)

    # Validate the updated habit (similar to creation but note that some fields might not be present)
    # We'll do basic validation; for simplicity, we skip full validation here but could add if needed.
    # For now, we assume the update data is valid.

    # Validate reminders count if provided
    if reminders_data is not None:
        if len(reminders_data) > 3:
            raise ValueError("Cannot have more than 3 reminders per habit")
        # Validate active reminders per user (max 30)
        # Compute current active reminders for the user, excluding the habit's current reminders
        current_active_reminders = db.query(models.HabitReminder).join(models.Habit).filter(
            models.Habit.user_id == user.id,
            models.Habit.status == models.HabitStatus.ACTIVE,
            models.HabitReminder.enabled == True,
            models.HabitReminder.habit_id != habit_id  # exclude current habit's reminders
        ).count()
        # Count new enabled reminders from the update
        new_enabled_reminders = sum(1 for r in reminders_data if r.enabled)
        if current_active_reminders + new_enabled_reminders > 30:
            raise ValueError("Cannot have more than 30 active reminders per user")
        # Remove existing reminders
        db.query(models.HabitReminder).filter(models.HabitReminder.habit_id == habit.id).delete()
        # Create new reminders
        for reminder_in in reminders_data:
            reminder = models.HabitReminder(
                habit_id=habit.id,
                time_local=reminder_in.time_local,
                weekdays=reminder_in.weekdays,
                timezone=reminder_in.timezone,
                enabled=reminder_in.enabled,
                message_template=reminder_in.message_template
            )
            db.add(reminder)

    # Increment version
    habit.version += 1
    db.commit()
    db.refresh(habit)
    return habit


def pause_habit(db: Session, user: User, habit_id: UUID) -> models.Habit:
    """Pause a habit"""
    habit = get_habit(db, user, habit_id)
    if not habit:
        raise ValueError("Habit not found")
    if habit.status != models.HabitStatus.ACTIVE:
        raise ValueError("Only active habits can be paused")
    habit.status = models.HabitStatus.PAUSED
    habit.version += 1
    db.commit()
    db.refresh(habit)
    return habit


def resume_habit(db: Session, user: User, habit_id: UUID) -> models.Habit:
    """Resume a habit"""
    habit = get_habit(db, user, habit_id)
    if not habit:
        raise ValueError("Habit not found")
    if habit.status != models.HabitStatus.PAUSED:
        raise ValueError("Only paused habits can be resumed")
    habit.status = models.HabitStatus.ACTIVE
    habit.version += 1
    db.commit()
    db.refresh(habit)
    return habit


def archive_habit(db: Session, user: User, habit_id: UUID) -> models.Habit:
    """Archive a habit"""
    habit = get_habit(db, user, habit_id)
    if not habit:
        raise ValueError("Habit not found")
    if habit.status == models.HabitStatus.ARCHIVED:
        raise ValueError("Habit is already archived")
    habit.status = models.HabitStatus.ARCHIVED
    habit.archived_at = datetime.now(pytz.UTC)
    habit.version += 1
    db.commit()
    db.refresh(habit)
    return habit


def get_today_tasks(db: Session, user: User, x_timezone: Optional[str] = None) -> dict:
    """Get tasks for today for the user, optionally using provided timezone"""
    # Determine timezone to use: from header if provided, else from user
    if x_timezone:
        try:
            tz = pytz.timezone(x_timezone)
        except pytz.exceptions.UnknownTimeZoneError:
            logger.warning(f"Unknown timezone {x_timezone} in header, using user's timezone")
            tz = get_user_timezone(user)
    else:
        tz = get_user_timezone(user)
    
    today_local = utc_to_local_date(datetime.now(pytz.UTC), tz)
    
    # Get habits for the user that are active and have a task for today
    # We'll get all active habits and then get or create today's task for each
    habits = db.query(models.Habit).filter(
        models.Habit.user_id == user.id,
        models.Habit.status == models.HabitStatus.ACTIVE
    ).all()
    
    tasks_list = []
    total = 0
    completed = 0
    in_progress = 0
    pending = 0
    
    for habit in habits:
        task = get_or_create_today_task(db, user, habit)
        total += 1
        
        # Compute progress percent if applicable (not for completed or boolean tasks)
        progress_percent = None
        if task.status != models.TaskStatus.COMPLETED:
            if habit.goal_type != models.GoalType.BOOLEAN and task.target_value is not None and task.target_value != 0:
                if task.current_value is not None:
                    progress_percent = int((float(task.current_value) / float(task.target_value)) * 100)
                else:
                    progress_percent = 0
        
        # Determine status string for response
        status_str = task.status.value if hasattr(task.status, 'value') else str(task.status)
        
        task_dict = {
            "taskId": str(task.id),
            "habitId": str(habit.id),
            "title": habit.title,
            "type": habit.type.value if hasattr(habit.type, 'value') else str(habit.type),
            "goalType": habit.goal_type.value if hasattr(habit.goal_type, 'value') else str(habit.goal_type),
            "targetValue": float(habit.target_value) if habit.target_value is not None else None,
            "currentValue": float(task.current_value) if task.current_value is not None else None,
            "unit": habit.unit.value if hasattr(habit.unit, 'value') else str(habit.unit) if habit.unit else None,
            "status": status_str,
            "progressPercent": progress_percent,
            "currentStreak": habit.current_streak,
            # We'll add reminder info later if needed
            # "reminder": {...},
            # "deepLink": f"/habits/task_{task.id}"
        }
        tasks_list.append(task_dict)
        
        # Update counters
        if task.status == models.TaskStatus.COMPLETED:
            completed += 1
        elif task.status == models.TaskStatus.IN_PROGRESS:
            in_progress += 1
        elif task.status == models.TaskStatus.PENDING:
            pending += 1
        # Note: SKIPPED and EXPIRED are not counted in today's tasks? They are still tasks for today.
        # But the spec's example summary only includes total, completed, inProgress, pending.
        # So we'll not count SKIPPED and EXPIRED in those counters.
    
    summary = {
        "total": total,
        "completed": completed,
        "inProgress": in_progress,
        "pending": pending
    }
    
    return {
        "localDate": today_local,
        "timezone": str(tz),
        "summary": summary,
        "items": tasks_list
    }


def get_habit_history(db: Session, user: User, habit_id: UUID, from_date: Optional[date] = None, to_date: Optional[date] = None, limit: int = 30) -> List[models.HabitTask]:
    """Get history of tasks for a habit"""
    query = db.query(models.HabitTask).filter(
        models.HabitTask.habit_id == habit_id,
        models.HabitTask.user_id == user.id
    )
    
    if from_date:
        query = query.filter(models.HabitTask.local_date >= from_date)
    if to_date:
        query = query.filter(models.HabitTask.local_date <= to_date)
    
    tasks = query.order_by(models.HabitTask.local_date.desc()).limit(limit).all()
    return tasks


def expire_old_tasks(db: Session):
    """Mark tasks as EXPIRED if their local_date is yesterday relative to user's timezone and task is not completed/skipped."""
    from datetime import datetime
    import pytz
    from sqlalchemy.orm import aliased
    try:
        now_utc = datetime.now(pytz.UTC)
        today_utc = now_utc.date()
        # Query tasks with local_date < today_utc (UTC date) and not completed/skipped and habit active
        UserAlias = aliased(User)
        HabitAlias = models.Habit
        tasks = db.query(models.HabitTask, UserAlias.timezone).\
            join(HabitAlias, models.HabitTask.habit_id == HabitAlias.id).\
            join(UserAlias, HabitAlias.user_id == UserAlias.id).\
            filter(models.HabitTask.local_date < today_utc)\
            .filter(models.HabitTask.status.not_in([models.TaskStatus.COMPLETED, models.TaskStatus.SKIPPED]))\
            .filter(HabitAlias.status == models.HabitStatus.ACTIVE).all()
        expired_count = 0
        for task, tz_str in tasks:
            try:
                tz = pytz.timezone(tz_str)
            except pytz.exceptions.UnknownTimeZoneError:
                tz = pytz.UTC
            now_local = now_utc.astimezone(tz)
            today_local = now_local.date()
            if task.local_date < today_local:
                task.status = models.TaskStatus.EXPIRED
                task.expired_at = now_utc
                task.version += 1
                db.add(task)
                expired_count += 1
        db.commit()
        logger.info(f"Expired {expired_count} tasks.")
    except Exception as e:
        logger.error(f"Error in expire_old_tasks: {e}")
        db.rollback()
        raise


def generate_tasks_for_tomorrow(db: Session):
    """Generate tasks for tomorrow for all active habits."""
    from datetime import datetime, date, timedelta
    import pytz
    try:
        # Get all active habits
        habits = db.query(models.Habit).filter(
            models.Habit.status == models.HabitStatus.ACTIVE
        ).all()
        
        created_count = 0
        for habit in habits:
            # Get the user to determine their timezone
            user = db.query(User).filter(User.id == habit.user_id).first()
            if not user:
                continue
                
            user_tz = get_user_timezone(user)
            tomorrow_local = utc_to_local_date(datetime.now(pytz.UTC), user_tz) + timedelta(days=1)
            
            # Check if a task already exists for tomorrow for this habit
            existing_task = db.query(models.HabitTask).filter(
                models.HabitTask.habit_id == habit.id,
                models.HabitTask.local_date == tomorrow_local
            ).first()
            
            if not existing_task:
                # Create a new task for tomorrow
                task = models.HabitTask(
                    habit_id=habit.id,
                    user_id=habit.user_id,
                    local_date=tomorrow_local,
                    timezone=habit.timezone,  # Use the habit's timezone
                    target_value=habit.target_value,
                    current_value=None,
                    unit=habit.unit,
                    status=models.TaskStatus.PENDING,
                    version=1
                )
                db.add(task)
                created_count += 1
        
        db.commit()
        logger.info(f"Generated {created_count} tasks for tomorrow.")
    except Exception as e:
        logger.error(f"Error in generate_tasks_for_tomorrow: {e}")
        db.rollback()
        raise

# We'll add functions for reminders and notifications later