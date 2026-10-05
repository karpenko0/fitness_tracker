"""
Unit tests for habits services
"""
import pytest
from datetime import date, datetime, time, timedelta
from uuid import UUID

from sqlalchemy.orm import Session

from app.models import User
from app.models.user import UserRole
from app.habits.models import HabitTask
from app.habits.schemas import (
    HabitCreate,
    HabitType,
    GoalType,
    ScheduleType,
    TaskProgressUpdate,
    TaskCompleteUpdate,
    TaskSkipUpdate,
    SkipReason
)
from app.habits import schemas
from app.habits.services import (
    create_habit,
    get_habits,
    get_habit,
    update_habit,
    pause_habit,
    resume_habit,
    archive_habit,
    get_or_create_today_task,
    update_task_progress,
    complete_task,
    skip_task,
    update_streak,
    get_today_tasks,
    get_habit_history
)

def test_create_habit(db_session: Session):
    """Test creating a new habit."""
    # Create a user first
    user = User(
        email="test@example.com",
        password_hash="hashed",
        first_name="Test",
        last_name="User",
        role=UserRole.USER.value,
        timezone="UTC",
        is_active=True
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    
    habit_in = HabitCreate(
        title="Test Habit",
        type=HabitType.WATER,
        goal_type=GoalType.QUANTITY,
        target_value=2000,
        unit="ML",
        schedule_type=ScheduleType.DAILY,
        timezone="UTC"
    )
    
    habit = create_habit(db_session, user, habit_in)
    
    assert habit.id is not None
    assert habit.title == "Test Habit"
    assert habit.type == HabitType.WATER
    assert habit.goal_type == GoalType.QUANTITY
    assert habit.target_value == 2000
    assert habit.unit == "ML"
    assert habit.schedule_type == ScheduleType.DAILY
    assert habit.timezone == "UTC"
    assert habit.status == "ACTIVE"
    assert habit.current_streak == 0
    assert habit.best_streak == 0
    assert habit.last_completed_local_date is None
    assert habit.version == 1

def test_create_habit_duplicate_title(db_session: Session):
    """Test creating a habit with duplicate title fails."""
    user = User(
        email="test2@example.com",
        password_hash="hashed",
        first_name="Test",
        last_name="User",
        role=UserRole.USER.value,
        timezone="UTC",
        is_active=True
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    
    habit_in = HabitCreate(
        title="Duplicate Habit",
        type=HabitType.WATER,
        goal_type=GoalType.QUANTITY,
        target_value=2000,
        unit="ML",
        schedule_type=ScheduleType.DAILY,
        timezone="UTC"
    )
    
    # Create first habit
    habit1 = create_habit(db_session, user, habit_in)
    assert habit1 is not None
    
    # Try to create second habit with same title
    with pytest.raises(ValueError, match="Habit with this title already exists"):
        create_habit(db_session, user, habit_in)

def test_get_habits(db_session: Session):
    """Test getting habits with filters."""
    user = User(
        email="test3@example.com",
        password_hash="hashed",
        first_name="Test",
        last_name="User",
        role=UserRole.USER.value,
        timezone="UTC",
        is_active=True
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    
    # Create a few habits
    habit1_in = HabitCreate(
        title="Habit 1",
        type=HabitType.WATER,
        goal_type=GoalType.QUANTITY,
        target_value=2000,
        unit="ML",
        schedule_type=ScheduleType.DAILY,
        timezone="UTC"
    )
    habit2_in = HabitCreate(
        title="Habit 2",
        type=HabitType.STEPS,
        goal_type=GoalType.COUNT,
        target_value=10000,
        unit="STEPS",
        schedule_type=ScheduleType.DAILY,
        timezone="UTC"
    )
    
    habit1 = create_habit(db_session, user, habit1_in)
    habit2 = create_habit(db_session, user, habit2_in)
    
    # Get all habits
    habits = get_habits(db_session, user)
    assert len(habits) == 2
    
    # Get only WATER habits
    water_habits = get_habits(db_session, user, habit_type=HabitType.WATER)
    assert len(water_habits) == 1
    assert water_habits[0].id == habit1.id
    
    # Get only active habits (both are active)
    active_habits = get_habits(db_session, user, status="ACTIVE")
    assert len(active_habits) == 2
    
    # Archive one habit and test status filter
    archive_habit(db_session, user, habit1.id)
    archived_habits = get_habits(db_session, user, status="ARCHIVED")
    assert len(archived_habits) == 1
    assert archived_habits[0].id == habit1.id
    
    active_habits_after = get_habits(db_session, user, status="ACTIVE")
    assert len(active_habits_after) == 1
    assert active_habits_after[0].id == habit2.id

def test_update_habit(db_session: Session):
    """Test updating a habit."""
    user = User(
        email="test4@example.com",
        password_hash="hashed",
        first_name="Test",
        last_name="User",
        role=UserRole.USER.value,
        timezone="UTC",
        is_active=True
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    
    habit_in = HabitCreate(
        title="Old Title",
        type=HabitType.WATER,
        goal_type=GoalType.QUANTITY,
        target_value=2000,
        unit="ML",
        schedule_type=ScheduleType.DAILY,
        timezone="UTC"
    )
    habit = create_habit(db_session, user, habit_in)
    
    # Update the habit
    update_in = schemas.HabitUpdate(
        title="New Title",
        target_value=2500,
        timezone="Europe/Moscow"
    )
    updated_habit = update_habit(db_session, user, habit.id, update_in)
    
    assert updated_habit.title == "New Title"
    assert updated_habit.target_value == 2500
    assert updated_habit.timezone == "Europe/Moscow"
    # Check that unchanged fields are still correct
    assert updated_habit.type == HabitType.WATER
    assert updated_habit.goal_type == GoalType.QUANTITY
    assert updated_habit.unit == "ML"
    assert updated_habit.schedule_type == ScheduleType.DAILY
    assert updated_habit.version == 2  # version incremented

def test_pause_and_resume_habit(db_session: Session):
    """Test pausing and resuming a habit."""
    user = User(
        email="test5@example.com",
        password_hash="hashed",
        first_name="Test",
        last_name="User",
        role=UserRole.USER.value,
        timezone="UTC",
        is_active=True
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    
    habit_in = HabitCreate(
        title="Test Habit",
        type=HabitType.WATER,
        goal_type=GoalType.QUANTITY,
        target_value=2000,
        unit="ML",
        schedule_type=ScheduleType.DAILY,
        timezone="UTC"
    )
    habit = create_habit(db_session, user, habit_in)
    
    # Pause the habit
    paused_habit = pause_habit(db_session, user, habit.id)
    assert paused_habit.status == "PAUSED"
    
    # Resume the habit
    resumed_habit = resume_habit(db_session, user, habit.id)
    assert resumed_habit.status == "ACTIVE"

def test_archive_habit(db_session: Session):
    """Test archiving a habit."""
    user = User(
        email="test6@example.com",
        password_hash="hashed",
        first_name="Test",
        last_name="User",
        role=UserRole.USER.value,
        timezone="UTC",
        is_active=True
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    
    habit_in = HabitCreate(
        title="Test Habit",
        type=HabitType.WATER,
        goal_type=GoalType.QUANTITY,
        target_value=2000,
        unit="ML",
        schedule_type=ScheduleType.DAILY,
        timezone="UTC"
    )
    habit = create_habit(db_session, user, habit_in)
    
    # Archive the habit
    archived_habit = archive_habit(db_session, user, habit.id)
    assert archived_habit.status == "ARCHIVED"
    assert archived_habit.archived_at is not None

def test_get_or_create_today_task(db_session: Session):
    """Test getting or creating today's task for a habit."""
    user = User(
        email="test7@example.com",
        password_hash="hashed",
        first_name="Test",
        last_name="User",
        role=UserRole.USER.value,
        timezone="UTC",
        is_active=True
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    
    habit_in = HabitCreate(
        title="Test Habit",
        type=HabitType.WATER,
        goal_type=GoalType.QUANTITY,
        target_value=2000,
        unit="ML",
        schedule_type=ScheduleType.DAILY,
        timezone="UTC"
    )
    habit = create_habit(db_session, user, habit_in)
    
    # Get today's task (should create it)
    task1 = get_or_create_today_task(db_session, user, habit)
    assert task1 is not None
    assert task1.habit_id == habit.id
    assert task1.user_id == user.id
    assert task1.local_date == date.today()
    assert task1.status == "PENDING"
    assert task1.current_value is None
    assert task1.version == 1
    
    # Get today's task again (should return the same)
    task2 = get_or_create_today_task(db_session, user, habit)
    assert task2.id == task1.id
    assert task2.version == 1  # version should not change

def test_update_task_progress(db_session: Session):
    """Test updating task progress with ADD and SET."""
    user = User(
        email="test8@example.com",
        password_hash="hashed",
        first_name="Test",
        last_name="User",
        role=UserRole.USER.value,
        timezone="UTC",
        is_active=True
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    
    habit_in = HabitCreate(
        title="Water Habit",
        type=HabitType.WATER,
        goal_type=GoalType.QUANTITY,
        target_value=2000,
        unit="ML",
        schedule_type=ScheduleType.DAILY,
        timezone="UTC"
    )
    habit = create_habit(db_session, user, habit_in)
    
    task = get_or_create_today_task(db_session, user, habit)
    
    # Test ADD action
    initial_version = task.version
    update_in = TaskProgressUpdate(version=task.version, action="ADD", value=500)
    updated_task = update_task_progress(db_session, user, task.id, update_in)
    
    assert updated_task.current_value == 500
    assert updated_task.status == "PENDING"  # not yet completed
    assert updated_task.version == initial_version + 1
    
    # Test another ADD
    second_version = updated_task.version
    update_in2 = TaskProgressUpdate(version=updated_task.version, action="ADD", value=1000)
    updated_task2 = update_task_progress(db_session, user, task.id, update_in2)
    
    assert updated_task2.current_value == 1500
    assert updated_task2.status == "PENDING"
    assert updated_task2.version == second_version + 1
    
    # Test SET action
    third_version = updated_task2.version
    update_in3 = TaskProgressUpdate(version=updated_task2.version, action="SET", value=2000)
    updated_task3 = update_task_progress(db_session, user, task.id, update_in3)
    
    assert updated_task3.current_value == 2000
    assert updated_task3.status == "COMPLETED"  # goal reached
    assert updated_task3.completed_at is not None
    assert updated_task3.version == third_version + 1
    
    # Test that we cannot update a completed task
    with pytest.raises(ValueError, match="Task cannot be updated"):
        update_task_progress(db_session, user, task.id, TaskProgressUpdate(version=task.version, action="ADD", value=100))

def test_complete_task(db_session: Session):
    """Test marking a task as completed."""
    user = User(
        email="test9@example.com",
        password_hash="hashed",
        first_name="Test",
        last_name="User",
        role=UserRole.USER.value,
        timezone="UTC",
        is_active=True
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    
    habit_in = HabitCreate(
        title="Reading Habit",
        type=HabitType.CUSTOM,
        goal_type=GoalType.BOOLEAN,
        schedule_type=ScheduleType.DAILY,
        timezone="UTC"
    )
    habit = create_habit(db_session, user, habit_in)
    
    task = get_or_create_today_task(db_session, user, habit)
    
    # Complete the task
    initial_version = task.version
    update_in = TaskCompleteUpdate(version=task.version)
    completed_task = complete_task(db_session, user, task.id, update_in)
    
    assert completed_task.status == "COMPLETED"
    assert completed_task.completed_at is not None
    assert completed_task.version == initial_version + 1
    
    # Check that the habit's streak was updated
    updated_habit = get_habit(db_session, user, habit.id)
    assert updated_habit.current_streak == 1
    assert updated_habit.best_streak == 1
    assert updated_habit.last_completed_local_date == date.today()

def test_skip_task(db_session: Session):
    """Test marking a task as skipped."""
    user = User(
        email="test10@example.com",
        password_hash="hashed",
        first_name="Test",
        last_name="User",
        role=UserRole.USER.value,
        timezone="UTC",
        is_active=True
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    
    habit_in = HabitCreate(
        title="Exercise Habit",
        type=HabitType.CUSTOM,
        goal_type=GoalType.BOOLEAN,
        schedule_type=ScheduleType.DAILY,
        timezone="UTC"
    )
    habit = create_habit(db_session, user, habit_in)
    
    task = get_or_create_today_task(db_session, user, habit)
    
    # Skip the task
    initial_version = task.version
    update_in = TaskSkipUpdate(version=task.version, reason=SkipReason.USER_DECISION)
    skipped_task = skip_task(db_session, user, task.id, update_in)
    
    assert skipped_task.status == "SKIPPED"
    assert skipped_task.skipped_at is not None
    assert skipped_task.skip_reason == SkipReason.USER_DECISION
    assert skipped_task.version == initial_version + 1
    
    # Check that the habit's streak was reset (since skipping breaks streak)
    updated_habit = get_habit(db_session, user, habit.id)
    assert updated_habit.current_streak == 0
    assert updated_habit.best_streak == 0  # best streak remains 0 because we hadn't completed any
    assert updated_habit.last_completed_local_date is None

def test_update_streak(db_session: Session):
    """Test streak calculation."""
    user = User(
        email="test11@example.com",
        password_hash="hashed",
        first_name="Test",
        last_name="User",
        role=UserRole.USER.value,
        timezone="UTC",
        is_active=True
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    
    # Create a habit that repeats on Mondays, Wednesdays, Fridays (1, 3, 5)
    habit_in = HabitCreate(
        title="Gym Habit",
        type=HabitType.CUSTOM,
        goal_type=GoalType.BOOLEAN,
        schedule_type=ScheduleType.WEEKDAYS,
        weekdays=[1, 3, 5],  # Mon, Wed, Fri
        timezone="UTC"
    )
    habit = create_habit(db_session, user, habit_in)
    
    # We'll simulate tasks for the past two weeks
    # We'll set the date to a known Monday for simplicity
    # Let's assume today is 2026-09-18 which is a Friday (we can check, but we'll use a fixed date for testing)
    # We'll use a fixed date in the past to avoid relying on current date.
    # We'll create tasks for specific dates.
    
    # We'll create a helper function to create a task for a specific date
    def create_task_for_date(target_date):
        task = models.HabitTask(
            habit_id=habit.id,
            user_id=user.id,
            local_date=target_date,
            timezone=habit.timezone,
            target_value=habit.target_value,
            current_value=None,
            unit=habit.unit,
            status=models.TaskStatus.PENDING,
            version=1
        )
        db_session.add(task)
        db_session.commit()
        db_session.refresh(task)
        return task
    
    # We'll create tasks for:
    # 2026-09-09 (Monday) - completed
    # 2026-09-10 (Tuesday) - not a scheduled day, so no task created by us, but we won't create one
    # 2026-09-11 (Wednesday) - completed
    # 2026-09-12 (Thursday) - not scheduled
    # 2026-09-13 (Friday) - completed
    # 2026-09-16 (Monday) - completed (this would make streak 4 if we count the previous Monday, Wednesday, Friday)
    
    # But note: we are testing the update_streak function, which looks at all tasks for the habit.
    # We'll create tasks and then call update_streak.
    
# We'll create tasks for the above dates and set their status.
        from app.habits.models import HabitTask
    
    dates_and_status = [
        (date(2026, 9, 9), "COMPLETED"),   # Monday
        (date(2026, 9, 11), "COMPLETED"),  # Wednesday
        (date(2026, 9, 13), "COMPLETED"),  # Friday
        (date(2026, 9, 16), "COMPLETED"),  # Monday (next week)
    ]
    
    for d, status in dates_and_status:
        task = HabitTask(
            habit_id=habit.id,
            user_id=user.id,
            local_date=d,
            timezone=habit.timezone,
            target_value=habit.target_value,
            current_value=None,
            unit=habit.unit,
            status=status,
            version=1
        )
        db_session.add(task)
    
    db_session.commit()
    
    # Now update the streak
    update_streak(db_session, habit)
    
    # Refresh the habit
    db_session.refresh(habit)
    
    # We expect:
    # The streak should be 4 because we have four consecutive completed scheduled days?
    # But note: the definition of streak is consecutive scheduled days that are completed.
    # The scheduled days are Mon, Wed, Fri.
    # The dates we have:
    #   2026-09-09 (Mon) - completed
    #   2026-09-11 (Wed) - completed
    #   2026-09-13 (Fri) - completed
    #   2026-09-16 (Mon) - completed
    # There is a gap: 2026-09-14 (Sat) and 2026-09-15 (Sun) are not scheduled, so they don't break the streak.
    # Then 2026-09-16 is the next scheduled day after 2026-09-13? 
    # Actually, the scheduled days are every Mon, Wed, Fri. So after Fri (13th) comes Mon (16th) -> that's consecutive in the schedule.
    # Therefore, the streak should be 4.
    assert habit.current_streak == 4
    assert habit.best_streak == 4
    assert habit.last_completed_local_date == date(2026, 9, 16)
    
    # Now, let's break the streak by skipping one of the scheduled days.
    # We'll skip the Wednesday (2026-09-18) but note that 2026-09-18 is a Friday? Actually, let's check:
    # 2026-09-18 is a Friday (we assumed earlier). But we already have a task for 2026-09-13 (Friday) and then 2026-09-16 (Monday).
    # We'll create a task for 2026-09-18 (Friday) and mark it as skipped.
    task_fri_18 = HabitTask(
        habit_id=habit.id,
        user_id=user.id,
        local_date=date(2026, 9, 18),
        timezone=habit.timezone,
        target_value=habit.target_value,
        current_value=None,
        unit=habit.unit,
        status="SKIPPED",
        version=1
    )
    db_session.add(task_fri_18)
    db_session.commit()
    
    update_streak(db_session, habit)
    db_session.refresh(habit)
    
    # After a skip, the streak should reset to 0.
    assert habit.current_streak == 0
    # The best streak should remain 4.
    assert habit.best_streak == 4
    # The last completed local date should still be the last completed day before the skip, which is 2026-09-16.
    assert habit.last_completed_local_date == date(2026, 9, 16)
    
    # Now, let's complete a task after the skip to see if streak starts again.
    task_mon_23 = HabitTask(
        habit_id=habit.id,
        user_id=user.id,
        local_date=date(2026, 9, 23),  # Monday after the skipped Friday
        timezone=habit.timezone,
        target_value=habit.target_value,
        current_value=None,
        unit=habit.unit,
        status="COMPLETED",
        version=1
    )
    db_session.add(task_mon_23)
    db_session.commit()
    
    update_streak(db_session, habit)
    db_session.refresh(habit)
    
    # Now the streak should be 1 (only the Monday 23rd)
    assert habit.current_streak == 1
    assert habit.best_streak == 4  # best streak remains the highest
    assert habit.last_completed_local_date == date(2026, 9, 23)

def test_get_today_tasks(db_session: Session):
    """Test getting today's tasks."""
    user = User(
        email="test12@example.com",
        password_hash="hashed",
        first_name="Test",
        last_name="User",
        role=UserRole.USER.value,
        timezone="UTC",
        is_active=True
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    
    # Create two habits
    habit1_in = HabitCreate(
        title="Water",
        type=HabitType.WATER,
        goal_type=GoalType.QUANTITY,
        target_value=2000,
        unit="ML",
        schedule_type=ScheduleType.DAILY,
        timezone="UTC"
    )
    habit2_in = HabitCreate(
        title="Exercise",
        type=HabitType.CUSTOM,
        goal_type=GoalType.BOOLEAN,
        schedule_type=ScheduleType.DAILY,
        timezone="UTC"
    )
    
    habit1 = create_habit(db_session, user, habit1_in)
    habit2 = create_habit(db_session, user, habit2_in)
    
    # Get today's tasks
    today_data = get_today_tasks(db_session, user)
    
    assert today_data["localDate"] == date.today()
    assert today_data["timezone"] == "UTC"
    assert today_data["summary"]["total"] == 2
    assert today_data["summary"]["completed"] == 0
    assert today_data["summary"]["inProgress"] == 0
    assert today_data["summary"]["pending"] == 2
    
    # Complete one task and see if the counts update
    task_for_habit1 = None
    for item in today_data["items"]:
        if item["habitId"] == str(habit1.id):
            task_for_habit1 = item
            break
    
    assert task_for_habit1 is not None
    task_id = task_for_habit1["taskId"]
    
    # Update the task to completed
    from uuid import UUID as _UUID
    # We need to get the task to have its version
    task_obj = db_session.query(HabitTask).filter(HabitTask.id == _UUID(task_id)).first()
    update_in = TaskCompleteUpdate(version=task_obj.version)
    completed_task = complete_task(db_session, user, _UUID(task_id), update_in)
    
    # Get today's tasks again
    today_data2 = get_today_tasks(db_session, user)
    assert today_data2["summary"]["completed"] == 1
    assert today_data2["summary"]["pending"] == 1
    
    # Check that the completed task has progress percent 100 (for BOOLEAN, it's not applicable, but we set to None?)
    # In our implementation, for BOOLEAN we set progress_percent to None.
    completed_item = None
    for item in today_data2["items"]:
        if item["taskId"] == str(completed_task.id):
            completed_item = item
            break
    assert completed_item is not None
    assert completed_item["status"] == "COMPLETED"
    # For BOOLEAN, progress_percent is None
    assert completed_item["progressPercent"] is None

def test_get_habit_history(db_session: Session):
    """Test getting habit history."""
    user = User(
        email="test13@example.com",
        password_hash="hashed",
        first_name="Test",
        last_name="User",
        role=UserRole.USER.value,
        timezone="UTC",
        is_active=True
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    
    habit_in = HabitCreate(
        title="History Test",
        type=HabitType.WATER,
        goal_type=GoalType.QUANTITY,
        target_value=2000,
        unit="ML",
        schedule_type=ScheduleType.DAILY,
        timezone="UTC"
    )
    habit = create_habit(db_session, user, habit_in)
    
    # Create tasks for the past 5 days (including today) with different statuses
    from app.habits.models import HabitTask

    base_date = date.today()
    for i in range(5):
        task_date = base_date - timedelta(days=i)
        status = "COMPLETED" if i % 2 == 0 else "PENDING"  # alternate completed and pending
        task = HabitTask(
            habit_id=habit.id,
            user_id=user.id,
            local_date=task_date,
            timezone=habit.timezone,
            target_value=habit.target_value,
            current_value=2000 if status == "COMPLETED" else None,
            unit=habit.unit,
            status=status,
            version=1
        )
        db_session.add(task)
    
    db_session.commit()
    
    # Get history for the last 3 days
    history = get_habit_history(db_session, user, habit.id, from_date=base_date - timedelta(days=2), to_date=base_date)
    
    # We expect 3 tasks (today, yesterday, day before yesterday)
    assert len(history) == 3
    
    # Check that they are in descending order by date
    assert history[0].local_date == base_date
    assert history[1].local_date == base_date - timedelta(days=1)
    assert history[2].local_date == base_date - timedelta(days=2)
    
    # Check the statuses (today: day0 -> i=0 -> completed, yesterday: day1 -> pending, day before yesterday: day2 -> completed)
    assert history[0].status == "COMPLETED"
    assert history[1].status == "PENDING"
    assert history[2].status == "COMPLETED"