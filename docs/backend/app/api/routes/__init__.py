"""
API route modules
"""
from .product import router as product
from .auth import router as auth
from .user import router as user

__all__ = ["product", "auth", "user"]
