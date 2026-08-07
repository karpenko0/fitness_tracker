"""
Base models for database ORM
"""
from sqlalchemy import Column, DateTime, func
from sqlalchemy.orm import declarative_base
from datetime import datetime

Base = declarative_base()


class BaseModel:
    """Base model with common fields"""

    created_at = Column(
        DateTime(timezone=True),
        default=func.now(),
        nullable=False,
        comment="Время создания записи в UTC"
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=func.now(),
        onupdate=func.now(),
        nullable=False,
        comment="Время последнего обновления в UTC"
    )
