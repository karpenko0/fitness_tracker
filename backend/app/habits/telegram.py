"""
Telegram services for habits
"""
import logging
from datetime import datetime
from typing import Optional, Tuple
import pytz
import hashlib
from telegram import Bot
from telegram.error import TelegramError
from telegram import Update
from sqlalchemy.orm import Session

from ..models import User
from . import models, schemas

logger = logging.getLogger(__name__)

# We'll get the bot token from environment variables
import os
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
if not TELEGRAM_BOT_TOKEN:
    logger.warning("TELEGRAM_BOT_TOKEN not set in environment variables")
else:
    bot = Bot(token=TELEGRAM_BOT_TOKEN)


def send_telegram_message(chat_id: str, text: str) -> Tuple[bool, Optional[int]]:
    """Send a message via Telegram bot.
    Returns a tuple (success, error_code) where error_code is the HTTP status code from TelegramError if available, else None.
    """
    if not TELEGRAM_BOT_TOKEN:
        logger.error("Telegram bot token not configured")
        return False, None
    try:
        bot.send_message(chat_id=chat_id, text=text, parse_mode='HTML')
        logger.info(f"Telegram message sent to chat_id {chat_id}")
        return True, None
    except TelegramError as e:
        error_code = None
        if hasattr(e, 'response') and e.response is not None:
            error_code = e.response.status_code
        logger.error(f"Telegram error: {e}, error_code={error_code}")
        return False, error_code
    except Exception as e:
        logger.error(f"Failed to send Telegram message: {e}")
        return False, None


def format_reminder_message(habit: models.Habit, task: models.HabitTask) -> str:
    """Format the reminder message for a habit task."""
    # We'll use a simple template; later we can use message_template from habit_reminders
    # For now, we'll generate a default message.
    goal_type_display = {
        models.GoalType.BOOLEAN: "Р’С‹РїРѕР»РЅРёС‚СЊ",
        models.GoalType.COUNT: f"{habit.target_value} {habit.unit.value if habit.unit else ''}",
        models.GoalType.DURATION_MINUTES: f"{habit.target_value} РјРёРЅСѓС‚",
        models.GoalType.QUANTITY: f"{habit.target_value} {habit.unit.value if habit.unit else ''}"
    }.get(habit.goal_type, "")
    
    if habit.goal_type == models.GoalType.BOOLEAN:
        text = f"РќР°РїРѕРјРёРЅР°РЅРёРµ: РїСЂРёРІС‹С‡РєР° В«{habit.title}В»\nРЎРµРіРѕРґРЅСЏ РЅСѓР¶РЅРѕ РІС‹РїРѕР»РЅРёС‚СЊ РґРµР№СЃС‚РІРёРµ."
    else:
        current = task.current_value if task.current_value is not None else 0
        target = habit.target_value if habit.target_value is not None else 0
        text = f"РќР°РїРѕРјРёРЅР°РЅРёРµ: РїСЂРёРІС‹С‡РєР° В«{habit.title}В»\nРЎРµРіРѕРґРЅСЏ: {current} / {target} {habit.unit.value if habit.unit else ''}.\nР¦РµР»СЊ: {goal_type_display}." 
    
    return text


def send_habit_reminders(db: Session):
    """Send reminders for habits that need them.
    This function should be called periodically (e.g., every minute) by a scheduler.
    """
    logger.info("Starting Telegram reminder check")
    
    # Get all users who have Telegram notifications enabled and have a chat_id
    users_with_telegram = db.query(User).filter(
        User.telegram_notifications_enabled == True,
        User.telegram_chat_id.isnot(None)
    ).all()
    
    for user in users_with_telegram:
        # Get active habits for this user
        habits = db.query(models.Habit).filter(
            models.Habit.user_id == user.id,
            models.Habit.status == models.HabitStatus.ACTIVE
        ).all()
        
        for habit in habits:
            # Get today's task for the habit
            from .services import get_or_create_today_task
            task = get_or_create_today_task(db, user, habit)
            
            # Check if the task is already completed; if so, no reminder needed
            if task.status == models.TaskStatus.COMPLETED:
                continue
            
            # Check if there are any reminders for this habit that are enabled and match the current time and day
            from .services import get_user_timezone
            user_tz = get_user_timezone(user)
            now_utc = datetime.now(pytz.UTC)
            now_local = now_utc.astimezone(user_tz)
            current_weekday = now_local.isoweekday()  # Monday=1, Sunday=7
            
            # Get reminders for this habit
            reminders = db.query(models.HabitReminder).filter(
                models.HabitReminder.habit_id == habit.id,
                models.HabitReminder.enabled == True
            ).all()
            
            for reminder in reminders:
                # Parse reminder time
                try:
                    reminder_time = datetime.strptime(reminder.time_local, "%H:%M").time()
                except ValueError:
                    logger.warning(f"Invalid time_local for reminder {reminder.id}: {reminder.time_local}")
                    continue
                
                # Check if we should attempt to send (max 3 attempts total)
                # We'll check the latest delivery attempt for this habit-task-reminder
                latest_delivery = db.query(models.NotificationDelivery).filter(
                    models.NotificationDelivery.habit_task_id == task.id,
                    models.NotificationDelivery.reminder_id == reminder.id
                ).order_by(models.NotificationDelivery.attempt_count.desc()).first()
                
                # If we have 3 or more attempts, skip
                if latest_delivery and latest_delivery.attempt_count >= 3:
                    logger.warning(f"Max attempts reached for habit {habit.id}, reminder {reminder.id}, task {task.id}")
                    continue
                
                # Check if the current time matches the reminder time (within a minute window? We'll check exact minute for simplicity)
                # We'll check if the current hour and minute match the reminder time.
                if (now_local.hour == reminder_time.hour and now_local.minute == reminder_time.minute):
                    # Check weekdays
                    if reminder.weekdays is None:
                        # Daily reminder
                        pass
                    else:
                        if current_weekday not in reminder.weekdays:
                            continue
                    
                    # Send the reminder
                    message = format_reminder_message(habit, task)
                    success, error_code = send_telegram_message(user.telegram_chat_id, message)
                    
                    # Record the notification delivery attempt
                    delivery = models.NotificationDelivery(
                        habit_task_id=task.id,
                        reminder_id=reminder.id,
                        user_id=user.id,
                        channel=models.NotificationChannel.TELEGRAM,
                        scheduled_at=now_utc,
                        sent_at=now_utc if success else None,
                        status=models.NotificationStatus.SENT if success else models.NotificationStatus.FAILED,
                        attempt_count=(latest_delivery.attempt_count if latest_delivery else 0) + 1,
                        last_error_code=None if success else f"Telegram API error {error_code}" if error_code else "Telegram API error"
                    )
                    db.add(delivery)
                    
                    if success:
                        logger.info(f"Sent Telegram reminder for habit {habit.id} to user {user.id} (attempt {delivery.attempt_count})")
                    else:
                        logger.error(f"Failed to send Telegram reminder for habit {habit.id} to user {user.id} (attempt {delivery.attempt_count})")
                        
                        # If bot blocked (403) or unauthorized (401), disable notifications for the user
                        if error_code in (403, 401):
                            logger.warning(f"Telegram bot blocked or unauthorized for user {user.id} (error {error_code}). Disabling notifications.")
                            user.telegram_notifications_enabled = False
                            user.telegram_chat_id = None  # Optionally clear chat_id to prevent further attempts
                            db.add(user)
                            # Commit will be handled later
    
    # Commit all notification deliveries and any user updates
    try:
        db.commit()
    except Exception as e:
        logger.error(f"Failed to commit notification deliveries: {e}")
        db.rollback()


def process_telegram_callback(db: Session, callback_data: str) -> bool:
    """Process a Telegram callback query.
    callback_data is the string from the callback_query.
    Returns True if processed successfully, False otherwise.
    """
    logger.info(f"Processing Telegram callback: {callback_data}")
    
    # Parse the callback data
    # Expected format: "action:task_id" where action is "complete", "skip", or "open_app"
    # For "open_app", task_id may be omitted.
    parts = callback_data.split(':')
    if len(parts) < 1:
        logger.warning(f"Invalid callback data format: {callback_data}")
        return False
    
    action = parts[0]
    task_id_str = parts[1] if len(parts) > 1 else None
    
    # Get the user from the callback query? We don't have the user directly.
    # We need to find the user by the chat_id associated with the callback query.
    # However, we don't have the chat_id in the callback_data.
    # We need to get the chat_id from the callback query itself, but we don't have the full update.
    # This function should be called from the webhook handler where we have the full update.
    # We'll change the function signature to accept the entire callback_query object or the update.
    # Let's change the design: we'll process the callback in the webhook handler directly.
    # We'll keep this function as a stub and implement the logic in the webhook route.
    # For now, we'll return False to indicate not implemented.
    return False


def handle_telegram_update(db: Session, update_dict: dict) -> bool:
    """Process a Telegram update from the webhook.
    Returns True if processed successfully, False otherwise.
    """
    try:
        update = Update.de_json(update_dict, bot)
    except Exception as e:
        logger.error(f"Failed to parse Telegram update: {e}")
        return False
    
    if update.callback_query:
        callback_query = update.callback_query
        chat_id = str(callback_query.message.chat.id)
        user = db.query(User).filter(User.telegram_chat_id == chat_id).first()
        if not user:
            logger.warning(f"No user found for telegram_chat_id {chat_id}")
            # Answer the callback query to show an error
            try:
                bot.answer_callback_query(callback_query.id, text="РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ РЅР°Р№РґРµРЅ. РџРѕР¶Р°Р»СѓР№СЃС‚Р°, РїСЂРёРІСЏР¶РёС‚Рµ Р°РєРєР°СѓРЅС‚ РІ РїСЂРёР»РѕР¶РµРЅРёРё.", show_alert=True)
            except Exception as e:
                logger.error(f"Failed to answer callback query: {e}")
            return False
        
        data = callback_query.data
        if not data:
            logger.warning("Empty callback data")
            return False
        
        # Parse the callback data
        parts = data.split(':')
        if len(parts) < 1:
            logger.warning(f"Invalid callback data format: {data}")
            return False
        
        action = parts[0]
        task_id_str = parts[1] if len(parts) > 1 else None
        
        if action == "open_app":
            # Just answer the callback query to dismiss the loading animation
            try:
                bot.answer_callback_query(callback_query.id)
            except Exception as e:
                logger.error(f"Failed to answer callback query: {e}")
            return True
        
        if not task_id_str:
            logger.warning(f"No task ID in callback data: {data}")
            return False
        
        try:
            task_id = UUID(task_id_str)
        except ValueError:
            logger.warning(f"Invalid task ID format: {task_id_str}")
            return False
        
        # Get the task
        task = db.query(models.HabitTask).filter(
            models.HabitTask.id == task_id,
            models.HabitTask.user_id == user.id
        ).first()
        if not task:
            logger.warning(f"Task {task_id} not found for user {user.id}")
            try:
                bot.answer_callback_query(callback_query.id, text="Р—Р°РґР°РЅРёРµ РЅРµ РЅР°Р№РґРµРЅРѕ РёР»Рё РЅРµ РїСЂРёРЅР°РґР»РµР¶РёС‚ РІР°Рј.", show_alert=True)
            except Exception as e:
                logger.error(f"Failed to answer callback query: {e}")
            return False
        
        # Check if the task is for today (optional, but we can allow completion only for today?)
        # We'll allow completion regardless of date, but we could restrict to today.
        # We'll allow it.
        
        if action == "complete":
            # Mark task as completed
            from .services import complete_task
            from .schemas import TaskCompleteUpdate
            # We need to get the current version of the task for optimistic locking
            # We'll fetch the task again to get the version, or we can use the task object we have.
            # We'll use the task object and hope it hasn't changed (low risk).
            payload = TaskCompleteUpdate(version=task.version)
            try:
                updated_task = complete_task(db, user, task_id, payload)
                logger.info(f"Task {task_id} marked as completed via Telegram callback")
                # Answer the callback_query.message.edit_text?? We can edit the message to show it's completed.
                # We'll edit the message to add a checkmark.
                try:
                    bot.edit_message_text(
                        text=f"вњ… {callback_query.message.text}",
                        chat_id=chat_id,
                        message_id=callback_query.message.message_id,
                        parse_mode='HTML'
                    )
                except Exception as e:
                    logger.error(f"Failed to edit message: {e}")
                bot.answer_callback_query(callback_query.id, text="Р—Р°РґР°РЅРёРµ РѕС‚РјРµС‡РµРЅРѕ РєР°Рє РІС‹РїРѕР»РЅРµРЅРЅРѕРµ!")
                return True
            except ValueError as e:
                logger.error(f"Validation error completing task: {e}")
                bot.answer_callback_query(callback_query.id, text=str(e), show_alert=True)
                return False
            except Exception as e:
                logger.error(f"Error completing task: {e}")
                bot.answer_callback_query(callback_query.id, text="РџСЂРѕРёР·РѕС€Р»Р° РѕС€РёР±РєР°.", show_alert=True)
                return False
        
        elif action == "skip":
            # Mark task as skipped
            from .services import skip_task
            from .schemas import TaskSkipUpdate
            from .models import SkipReason
            payload = TaskSkipUpdate(version=task.version, reason=SkipReason.USER_DECISION)
            try:
                updated_task = skip_task(db, user, task_id, payload)
                logger.info(f"Task {task_id} marked as skipped via Telegram callback")
                try:
                    bot.edit_message_text(
                        text=f"вЏ­пёЏ {callback_query.message.text}",
                        chat_id=chat_id,
                        message_id=callback_query.message.message_id,
                        parse_mode='HTML'
                    )
                except Exception as e:
                    logger.error(f"Failed to edit message: {e}")
                bot.answer_callback_query(callback_query.id, text="Р—Р°РґР°РЅРёРµ РїСЂРѕРїСѓС‰РµРЅРѕ.")
                return True
            except ValueError as e:
                logger.error(f"Validation error skipping task: {e}")
                bot.answer_callback_query(callback_query.id, text=str(e), show_alert=True)
                return False
            except Exception as e:
                logger.error(f"Error skipping task: {e}")
                bot.answer_callback_query(callback_query.id, text="РџСЂРѕРёР·РѕС€Р»Р° РѕС€РёР±РєР°.", show_alert=True)
                return False
        
        else:
            logger.warning(f"Unknown action in callback data: {action}")
            bot.answer_callback_query(callback_query.id, text="РќРµРёР·РІРµСЃС‚РЅРѕРµ РґРµР№СЃС‚РІРёРµ.", show_alert=True)
            return False
    
    # If we receive a regular message, we might want to handle commands like /start to link account.
    # We'll handle the /start and /bind commands here.
    if update.message:
        # Handle incoming messages
        message = update.message
        chat_id = str(message.chat.id)
        text = message.text.strip()
        logger.info(f"Received message from chat_id {chat_id}: {text}")
        
        # Handle /start command
        if text == "/start":
            help_text = (
                "РџСЂРёРІРµС‚! РЇ Р±РѕС‚ РґР»СЏ РЅР°РїРѕРјРёРЅР°РЅРёР№ Рѕ РїСЂРёРІС‹С‡РєР°С….\n"
                "Р§С‚РѕР±С‹ РїСЂРёРІСЏР·Р°С‚СЊ СЃРІРѕР№ Р°РєРєР°СѓРЅС‚, РїРѕР¶Р°Р»СѓР№СЃС‚Р°, РёСЃРїРѕР»СЊР·СѓР№С‚Рµ С„СѓРЅРєС†РёСЋ РїСЂРёРІСЏР·РєРё РІ РїСЂРёР»РѕР¶РµРЅРёРё.\n"
                "РџРѕСЃР»Рµ РїСЂРёРІСЏР·РєРё РІС‹ Р±СѓРґРµС‚Рµ РїРѕР»СѓС‡Р°С‚СЊ РЅР°РїРѕРјРёРЅР°РЅРёСЏ Рѕ СЃРІРѕРёС… РїСЂРёРІС‹С‡РєР°С…."
            )
            try:
                bot.send_message(chat_id=chat_id, text=help_text, parse_mode='HTML')
            except Exception as e:
                logger.error(f"Failed to send start message: {e}")
            return True
        
        # Handle /bind command for Telegram account linking
        if text.startswith("/bind"):
            parts = text.split()
            if len(parts) != 2:
                # Send usage instructions
                try:
                    bot.send_message(
                        chat_id=chat_id,
                        text="РСЃРїРѕР»СЊР·РѕРІР°РЅРёРµ: /bind <token>\nРџРѕР»СѓС‡РёС‚Рµ С‚РѕРєРµРЅ РІ РїСЂРёР»РѕР¶РµРЅРёРё РІ СЂР°Р·РґРµР»Рµ РїСЂРёРІСЏР·РєРё Telegram.",
                        parse_mode='HTML'
                    )
                except Exception as e:
                    logger.error(f"Failed to send bind usage: {e}")
                return True
            
            token = parts[1]
            # Find the user by chat_id? We don't have the chat_id bound yet.
            # We need to find a user that has a pending binding token that matches the hash of the provided token.
            # We'll search for users where the token hash matches and the token is not expired.
            import hashlib
            from datetime import datetime
            
            hashed_token = hashlib.sha256(token.encode()).hexdigest()
            
            # Find a user with matching token hash and not expired
            user = db.query(User).filter(
                User.telegram_bind_token == hashed_token,
                User.telegram_bind_token_expires_at > datetime.now()
            ).first()
            
            if not user:
                try:
                    bot.send_message(
                        chat_id=chat_id,
                        text="РќРµРґРµР№СЃС‚РІРёС‚РµР»СЊРЅС‹Р№ РёР»Рё РїСЂРѕСЃСЂРѕС‡РµРЅРЅС‹Р№ С‚РѕРєРµРЅ. РџРѕР¶Р°Р»СѓР№СЃС‚Р°, РїРѕР»СѓС‡РёС‚Рµ РЅРѕРІС‹Р№ С‚РѕРєРµРЅ РІ РїСЂРёР»РѕР¶РµРЅРёРё.",
                        parse_mode='HTML'
                    )
                except Exception as e:
                    logger.error(f"Failed to send invalid token message: {e}")
                return True
            
            # Bind the Telegram chat ID to the user
            user.telegram_chat_id = chat_id
            user.telegram_notifications_enabled = True
            # Clear the binding token (it's been used)
            user.telegram_bind_token = None
            user.telegram_bind_token_expires_at = None
            
            db.add(user)
            try:
                db.commit()
                logger.info(f"Telegram account bound for user {user.id} to chat_id {chat_id}")
                try:
                    bot.send_message(
                        chat_id=chat_id,
                        text="Р’Р°С€ Telegram Р°РєРєР°СѓРЅС‚ СѓСЃРїРµС€РЅРѕ РїСЂРёРІСЏР·Р°РЅ! Р’С‹ Р±СѓРґРµС‚Рµ РїРѕР»СѓС‡Р°С‚СЊ РЅР°РїРѕРјРёРЅР°РЅРёСЏ Рѕ СЃРІРѕРёС… РїСЂРёРІС‹С‡РєР°С….",
                        parse_mode='HTML'
                    )
                except Exception as e:
                    logger.error(f"Failed to send success message: {e}")
            except Exception as e:
                logger.error(f"Failed to bind Telegram account: {e}")
                db.rollback()
                try:
                    bot.send_message(
                        chat_id=chat_id,
                        text="РџСЂРѕРёР·РѕС€Р»Р° РѕС€РёР±РєР° РїСЂРё РїСЂРёРІСЏР·РєРµ Р°РєРєР°СѓРЅС‚Р°. РџРѕР¶Р°Р»СѓР№СЃС‚Р°, РїРѕРїСЂРѕР±СѓР№С‚Рµ РїРѕР·Р¶Рµ.",
                        parse_mode='HTML'
                    )
                except Exception as e:
                    logger.error(f"Failed to send error message: {e}")
            return True
    
    return False