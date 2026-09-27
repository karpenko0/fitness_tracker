"""
Scheduler for habit reminders
"""
import logging
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy.orm import Session

from .database import SessionLocal
from .habits import telegram
from .habits.services import expire_old_tasks, generate_tasks_for_tomorrow

logger = logging.getLogger(__name__)

scheduler = BackgroundScheduler()


def send_reminders_job():
    """Job to send habit reminders."""
    db = SessionLocal()
    try:
        telegram.send_habit_reminders(db)
    finally:
        db.close()


def expire_old_tasks_job():
    """Job to expire old tasks."""
    db = SessionLocal()
    try:
        expire_old_tasks(db)
    finally:
        db.close()


def generate_tasks_for_tomorrow_job():
    """Job to generate tasks for tomorrow."""
    db = SessionLocal()
    try:
        generate_tasks_for_tomorrow(db)
    finally:
        db.close()


def start_scheduler():
    """Start the scheduler."""
    # Send reminders every minute
    scheduler.add_job(
        send_reminders_job,
        trigger=CronTrigger(second="0"),  # At the top of every minute
        id="habit_reminders",
        name="Send habit reminders every minute",
        replace_existing=True,
    )
    # Expire old tasks every minute
    scheduler.add_job(
        expire_old_tasks_job,
        trigger=CronTrigger(second="0"),
        id="habit_expire_old_tasks",
        name="Expire old tasks every minute",
        replace_existing=True,
    )
    # Generate tasks for tomorrow every minute
    scheduler.add_job(
        generate_tasks_for_tomorrow_job,
        trigger=CronTrigger(second="0"),
        id="habit_generate_tomorrow_tasks",
        name="Generate tasks for tomorrow every minute",
        replace_existing=True,
    )
    scheduler.start()
    logger.info("Scheduler started for habit reminders, expiration, and generation")


def shutdown_scheduler():
    """Shutdown the scheduler."""
    scheduler.shutdown()
    logger.info("Scheduler shutdown")