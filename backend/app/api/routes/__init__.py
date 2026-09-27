"""
API route modules
"""
from .product import router as product
from .auth import router as auth
from .user import router as user
from app.habits.routes import router as habits
from .telegram import router as telegram

__all__ = ["product", "auth", "user", "habits", "telegram"]
