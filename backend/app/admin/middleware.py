"""Admin middleware (SPEC-011 6.1.4, 9.6):
- X-Request-Id: every admin request gets an id, propagated into the response and audit.
- Admin rate limit: 60 req/min per admin user; separate limit for exports/bulk.
"""
import time
import uuid
from collections import defaultdict
from typing import Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.config import get_settings
from app.services.auth import decode_access_token

settings = get_settings()


class AdminRequestIdMiddleware(BaseHTTPMiddleware):
    """Ensure X-Request-Id on all admin requests/responses."""

    async def dispatch(self, request: Request, call_next: Callable) -> "Response":  # noqa: F821
        request_id = request.headers.get("X-Request-Id") or uuid.uuid4().hex
        request.state.request_id = request_id
        if not request.url.path.startswith("/api/v1/admin"):
            return await call_next(request)
        response = await call_next(request)
        response.headers["X-Request-Id"] = request_id
        return response


class _SlidingWindow:
    def __init__(self):
        self.hits = defaultdict(list)

    def allow(self, key: str, limit: int, window: float) -> bool:
        now = time.monotonic()
        cutoff = now - window
        bucket = [t for t in self.hits[key] if t > cutoff]
        if len(bucket) >= limit:
            self.hits[key] = bucket
            return False
        bucket.append(now)
        self.hits[key] = bucket
        return True


class AdminRateLimitMiddleware(BaseHTTPMiddleware):
    """Rate limit for the admin panel (SPEC-011 9.6)."""

    def __init__(self, app):
        super().__init__(app)
        self.general = _SlidingWindow()
        self.export = _SlidingWindow()
        # Limits are read from settings on every request so tests can tighten them
        self._settings = get_settings()

    async def dispatch(self, request: Request, call_next: Callable):
        path = request.url.path
        if not path.startswith("/api/v1/admin"):
            return await call_next(request)

        # Identify the admin user when possible, otherwise fall back to client IP
        key = None
        authorization = request.headers.get("Authorization")
        if authorization and authorization.startswith("Bearer "):
            try:
                payload = decode_access_token(authorization.split(" ", 1)[1])
                key = f"user:{payload.get('sub')}"
            except Exception:
                key = None
        if key is None:
            key = f"ip:{request.client.host if request.client else 'unknown'}"

        # Login itself must remain reachable (brute force is handled separately by MFA/lockout)
        login_limited = not path.endswith("/auth/login")

        if path.startswith("/api/v1/admin/exports") or "/bulk/" in path:
            allowed = self.export.allow(
                key, self._settings.ADMIN_EXPORT_RATE_LIMIT_REQUESTS, self._settings.ADMIN_EXPORT_RATE_LIMIT_WINDOW_SECONDS
            )
        elif login_limited:
            allowed = self.general.allow(key, self._settings.ADMIN_RATE_LIMIT_REQUESTS, self._settings.ADMIN_RATE_LIMIT_WINDOW_SECONDS)
        else:
            allowed = True

        if not allowed:
            return JSONResponse(
                status_code=429,
                content={
                    "error": {
                        "code": "RATE_LIMITED",
                        "message": "Слишком много запросов. Попробуйте позже.",
                        "requestId": getattr(request.state, "request_id", "unknown"),
                    }
                },
            )
        return await call_next(request)
