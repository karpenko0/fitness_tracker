"""
Configuration for Fitness Tracker Backend API
"""
from pydantic_settings import BaseSettings
from functools import lru_cache
import os


class Settings(BaseSettings):
    """Application settings"""

    # API Configuration
    API_V1_PREFIX: str = "/api/v1"
    API_TITLE: str = "Fitness Tracker API"
    API_DESCRIPTION: str = "REST API для приложения Fitness Tracker"
    API_VERSION: str = "1.0.0"

    # Database
    DATABASE_URL: str = "postgresql://fitness_user:fitness_password@localhost:5432/fitness_tracker"
    DATABASE_ECHO: bool = False

    # JWT
    JWT_SECRET_KEY: str = "your-secret-key-change-in-production-min-32-chars"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRATION_HOURS: int = 24

    # Environment
    ENVIRONMENT: str = "development"
    DEBUG: bool = True
    LOG_LEVEL: str = "INFO"

    # CORS
    CORS_ORIGINS: list = [
        "http://localhost:3000",
        "http://localhost:5173",
    ]
    CORS_ALLOW_CREDENTIALS: bool = True
    CORS_ALLOW_METHODS: list = ["*"]
    CORS_ALLOW_HEADERS: list = ["*"]

    # Rate Limiting
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_REQUESTS: int = 100
    RATE_LIMIT_WINDOW_SECONDS: int = 60

    # Admin panel (SPEC-011)
    ADMIN_SESSION_IDLE_MINUTES: int = 30
    ADMIN_TOKEN_HOURS: int = 8
    ADMIN_MFA_ENABLED: bool = False
    # Dev-only: fixed code accepted when ADMIN_MFA_ENABLED and ENVIRONMENT != production.
    # In production without a configured MFA verifier, MFA logins fail closed (501).
    ADMIN_MFA_DEV_CODE: str = ""
    ADMIN_RATE_LIMIT_REQUESTS: int = 60
    ADMIN_RATE_LIMIT_WINDOW_SECONDS: int = 60
    ADMIN_EXPORT_RATE_LIMIT_REQUESTS: int = 10
    ADMIN_EXPORT_RATE_LIMIT_WINDOW_SECONDS: int = 3600
    ADMIN_EXPORT_TTL_MINUTES: int = 15
    ADMIN_EXPORT_MAX_ROWS: int = 100000
    ADMIN_MFA_WINDOW_SECONDS: int = 300
    ADMIN_MFA_MAX_ATTEMPTS: int = 5
    ANALYTICS_MIN_SEGMENT_SIZE: int = 5
    MEDIA_MAX_IMAGE_SIZE: int = 10 * 1024 * 1024
    MEDIA_MAX_VIDEO_SIZE: int = 50 * 1024 * 1024
    MEDIA_STORAGE_DIR: str = "storage/media"
    MEDIA_PRESALT: str = "media-token-salt-change-in-production"
    AUDIT_IP_SALT: str = "ip-hash-salt-change-in-production"
    APPROVAL_GATE_ENABLED: bool = True
    DEMO_DATA_SEED: bool = False

    class Config:
        env_file = ".env"
        case_sensitive = True


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings"""
    return Settings()
