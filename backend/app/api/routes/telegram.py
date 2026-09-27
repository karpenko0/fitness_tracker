"""
Telegram webhook routes
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import SuccessResponse
from app.middleware.rbac import get_current_user, require_role
from app.models import User

from app.habits import telegram

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/telegram", tags=["telegram"])


@router.post("/webhook")
async def telegram_webhook(request: Request, db: Session = Depends(get_db)):
    """Receive updates from Telegram."""
    try:
        data = await request.json()
    except Exception as e:
        logger.error(f"Failed to parse JSON from Telegram webhook: {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid JSON")
    
    logger.debug(f"Received Telegram update: {data}")
    
    # Process the update
    success = telegram.handle_telegram_update(db, data)
    if success:
        return SuccessResponse(data={"status": "processed"})
    else:
        # We still return success to Telegram to avoid retries? 
        # But if we failed to process, we might want to let Telegram retry.
        # However, we don't want to spam the user with errors.
        # We'll return success to Telegram but log the error.
        logger.warning("Failed to process Telegram update, but returning success to avoid retries")
        return SuccessResponse(data={"status": "ignored"})


@router.post("/setwebhook", dependencies=[Depends(require_role("admin"))])
async def set_webhook(url: str, db: Session = Depends(get_db)):
    """Set the webhook for the Telegram bot (admin only)."""
    # We'll use the python-telegram-bot to set the webhook
    from telegram import Bot
    import os
    bot_token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not bot_token:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Telegram bot token not configured")
    
    bot = Bot(token=bot_token)
    try:
        result = bot.set_webhook(url=url)
        if result:
            logger.info(f"Telegram webhook set to {url}")
            return SuccessResponse(data={"status": "webhook set"})
        else:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to set webhook")
    except Exception as e:
        logger.error(f"Error setting Telegram webhook: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.delete("/deletewebhook", dependencies=[Depends(require_role("admin"))])
async def delete_webhook(db: Session = Depends(get_db)):
    """Delete the webhook for the Telegram bot (admin only)."""
    from telegram import Bot
    import os
    bot_token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not bot_token:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Telegram bot token not configured")
    
    bot = Bot(token=bot_token)
    try:
        result = bot.delete_webhook()
        if result:
            logger.info("Telegram webhook deleted")
            return SuccessResponse(data={"status": "webhook deleted"})
        else:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to delete webhook")
    except Exception as e:
        logger.error(f"Error deleting Telegram webhook: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get("/getwebhookinfo", dependencies=[Depends(require_role("admin"))])
async def get_webhook_info(db: Session = Depends(get_db)):
    """Get current webhook info (admin only)."""
    from telegram import Bot
    import os
    bot_token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not bot_token:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Telegram bot token not configured")
    
    bot = Bot(token=bot_token)
    try:
        info = bot.get_webhook_info()
        return SuccessResponse(data={
            "url": info.url,
            "has_custom_certificate": info.has_custom_certificate,
            "pending_update_count": info.pending_update_count,
            "last_error_date": info.last_error_date,
            "last_error_message": info.last_error_message,
            "max_connections": info.max_connections,
            "ip_address": info.ip_address
        })
    except Exception as e:
        logger.error(f"Error getting Telegram webhook info: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))