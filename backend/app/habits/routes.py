"""
Habit routes
"""
import logging
from uuid import UUID
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, status, Header
from sqlalchemy.orm import Session
from typing import List, Optional

from app.database import get_db
from app.schemas import SuccessResponse
from app.middleware.rbac import get_current_user
from app.models import User

from . import schemas, services

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/habits", tags=["habits"])


@router.post("", response_model=SuccessResponse, status_code=status.HTTP_201_CREATED)
def create_habit(
    payload: schemas.HabitCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create a new habit"""
    try:
        habit = services.create_habit(db, user, payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"Unexpected error creating habit: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")
    return SuccessResponse(data=schemas.HabitResponse.from_orm(habit))


@router.get("", response_model=SuccessResponse)
def list_habits(
    status: Optional[schemas.HabitStatus] = None,
    type: Optional[schemas.HabitType] = None,
    include_today: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get list of habits"""
    habits = services.get_habits(db, user, status, type, include_today)
    return SuccessResponse(data={
        "items": [schemas.HabitResponse.from_orm(habit) for habit in habits]
    })


@router.get("/{habit_id}", response_model=SuccessResponse)
def get_habit(
    habit_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get a habit by id"""
    habit = services.get_habit(db, user, habit_id)
    if not habit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Habit not found")
    return SuccessResponse(data=schemas.HabitResponse.from_orm(habit))


@router.patch("/{habit_id}", response_model=SuccessResponse)
def update_habit(
    habit_id: UUID,
    payload: schemas.HabitUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Update a habit"""
    try:
        habit = services.update_habit(db, user, habit_id, payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"Unexpected error updating habit: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")
    return SuccessResponse(data=schemas.HabitResponse.from_orm(habit))


@router.post("/{habit_id}/pause", response_model=SuccessResponse)
def pause_habit(
    habit_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Pause a habit"""
    try:
        habit = services.pause_habit(db, user, habit_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"Unexpected error pausing habit: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")
    return SuccessResponse(data=schemas.HabitResponse.from_orm(habit))


@router.post("/{habit_id}/resume", response_model=SuccessResponse)
def resume_habit(
    habit_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Resume a habit"""
    try:
        habit = services.resume_habit(db, user, habit_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"Unexpected error resuming habit: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")
    return SuccessResponse(data=schemas.HabitResponse.from_orm(habit))


@router.post("/{habit_id}/archive", response_model=SuccessResponse)
def archive_habit(
    habit_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Archive a habit"""
    try:
        habit = services.archive_habit(db, user, habit_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"Unexpected error archiving habit: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")
    return SuccessResponse(data=schemas.HabitResponse.from_orm(habit))


@router.get("/today", response_model=SuccessResponse)
def get_today_habits(
    x_timezone: Optional[str] = Header(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get habits for today"""
    try:
        today_data = services.get_today_tasks(db, user, x_timezone)
    except Exception as e:
        logger.error(f"Error getting today's habits: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")
    return SuccessResponse(data=today_data)


@router.patch("/tasks/{task_id}", response_model=SuccessResponse)
def update_task(
    task_id: UUID,
    payload: schemas.TaskProgressUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Update task progress"""
    try:
        task = services.update_task_progress(db, user, task_id, payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"Unexpected error updating task: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")
    return SuccessResponse(data=schemas.HabitTaskResponse.from_orm(task))


@router.post("/tasks/{task_id}/skip", response_model=SuccessResponse)
def skip_task(
    task_id: UUID,
    payload: schemas.TaskSkipUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Skip a task"""
    try:
        task = services.skip_task(db, user, task_id, payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"Unexpected error skipping task: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")
    return SuccessResponse(data=schemas.HabitTaskResponse.from_orm(task))


@router.get("/{habit_id}/history", response_model=SuccessResponse)
def get_habit_history(
    habit_id: UUID,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    cursor: Optional[str] = None,
    limit: int = 30,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get habit history"""
    try:
        tasks = services.get_habit_history(db, user, habit_id, from_date, to_date, limit)
    except Exception as e:
        logger.error(f"Error getting habit history: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")
    return SuccessResponse(data={
        "items": [schemas.HabitTaskResponse.from_orm(task) for task in tasks]
    })


# We'll add more routes for reminders if needed, but the specification doesn't have explicit endpoints for reminders.
# Reminders are created/updated as part of habit creation/update.