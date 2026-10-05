"""
FastAPI Application Main Module
"""
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
import logging

from app.config import get_settings
from app.api.routes import product
from app.api.routes import auth
from app.api.routes import user
from app.api.routes import habits
from app.api.routes import telegram
from app.admin.router import admin_router
from app.admin.middleware import AdminRateLimitMiddleware, AdminRequestIdMiddleware
from app.middleware.idempotency import IdempotencyMiddleware
from app.middleware.rate_limit import RateLimitMiddleware
from app.scheduler import start_scheduler, shutdown_scheduler

logger = logging.getLogger(__name__)

settings = get_settings()


def _request_id(request: Request) -> str:
    return getattr(request.state, "request_id", None) or request.headers.get("X-Request-Id", "unknown")


def _error_body(code: str, message: str, request: Request, details=None) -> dict:
    body = {
        "error": {
            "code": code,
            "message": message,
            "details": details,
            "requestId": _request_id(request),
        },
        # Legacy shape kept for existing clients
        "detail": {"code": code, "message": message, "details": details},
    }
    return body


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


# ---- Error handlers: SPEC-011 7.1 { "error": { code, message, details, requestId } } ----

@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    detail = exc.detail
    if isinstance(detail, dict):
        code = detail.get("code", "ERROR")
        message = detail.get("message", str(detail))
        details = detail.get("details")
    else:
        code = "ERROR"
        message = str(detail)
        details = None
    return JSONResponse(status_code=exc.status_code, content=_error_body(code, message, request, details))


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    details = []
    for e in exc.errors():
        loc = ".".join(str(x) for x in e.get("loc", []) if x != "body")
        details.append({"field": loc or None, "msg": e.get("msg")})
    return JSONResponse(
        status_code=400,
        content=_error_body("VALIDATION_ERROR", "Request validation failed", request, details),
    )


# Include API routes
app.include_router(product, prefix=settings.API_V1_PREFIX)
app.include_router(auth, prefix=settings.API_V1_PREFIX)
app.include_router(user, prefix=settings.API_V1_PREFIX)
app.include_router(habits, prefix=settings.API_V1_PREFIX)
app.include_router(telegram, prefix=settings.API_V1_PREFIX)
# The admin sub-routers already carry their /admin prefix
app.include_router(admin_router, prefix=settings.API_V1_PREFIX)

# Rate limiting middleware
app.add_middleware(RateLimitMiddleware)

# Idempotency middleware (SPEC-011: body-hash aware, admin mutations require a key)
app.add_middleware(IdempotencyMiddleware)

# Admin panel middleware (SPEC-011 6.1.4, 9.6)
app.add_middleware(AdminRateLimitMiddleware)
app.add_middleware(AdminRequestIdMiddleware)


@app.on_event("startup")
async def startup_event():
    """Start application resources."""
    start_scheduler()


@app.on_event("shutdown")
async def shutdown_event():
    """Shutdown application resources."""
    shutdown_scheduler()


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
            "habits": "/api/v1/habits",
            "products": "/api/v1/products",
            "plans": "/api/v1/plans",
            "config": "/api/v1/product/config",
            "telegram": "/api/v1/telegram",
            "admin": "/api/v1/admin",
        }
    }


@app.exception_handler(Exception)
async def general_exception_handler(request, exc):
    """Global exception handler (never leaks stack traces or SQL, SPEC-011 9.9)"""
    logger.exception("Unhandled exception on %s", request.url.path)
    return JSONResponse(
        status_code=500,
        content=_error_body("INTERNAL_SERVER_ERROR", "Internal server error", request),
    )
