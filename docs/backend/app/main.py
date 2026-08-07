"""
FastAPI Application Main Module
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import logging

from app.config import get_settings
from app.api.routes import product
from app.api.routes import auth
from app.api.routes import user
from app.middleware.idempotency import IdempotencyMiddleware
from app.middleware.rate_limit import RateLimitMiddleware

logger = logging.getLogger(__name__)

settings = get_settings()

# Create FastAPI app
app = FastAPI(
    title=settings.API_TITLE,
    description=settings.API_DESCRIPTION,
    version=settings.API_VERSION,
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=settings.CORS_ALLOW_CREDENTIALS,
    allow_methods=settings.CORS_ALLOW_METHODS,
    allow_headers=settings.CORS_ALLOW_HEADERS,
)

# Include API routes
app.include_router(product, prefix=settings.API_V1_PREFIX)
app.include_router(auth, prefix=settings.API_V1_PREFIX)
app.include_router(user, prefix=settings.API_V1_PREFIX)

# Rate limiting middleware
app.add_middleware(RateLimitMiddleware)

# Idempotency middleware
app.add_middleware(IdempotencyMiddleware)

@app.get("/")
async def root():
    """Root endpoint"""
    return {"message": "Fitness Tracker API", "version": "1.0.0"}

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy"}

@app.get("/api/v1")
async def api_v1_info():
    """API v1 information"""
    return {
        "version": "1.0.0",
        "status": "running",
        "endpoints": {
            "auth": "/api/v1/auth",
            "products": "/api/v1/products",
            "plans": "/api/v1/plans",
            "config": "/api/v1/product/config"
        }
    }

@app.exception_handler(Exception)
async def general_exception_handler(request, exc):
    """Global exception handler"""
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "INTERNAL_SERVER_ERROR",
                "message": "Internal server error",
                "traceId": request.headers.get("X-Request-ID", "unknown")
            }
        }
    )
