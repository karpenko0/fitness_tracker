"""Simple rate limiting middleware."""
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Callable

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.config import get_settings

settings = get_settings()


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app):
        super().__init__(app)
        self.requests = defaultdict(list)
        self.limit = settings.RATE_LIMIT_REQUESTS
        self.window_seconds = settings.RATE_LIMIT_WINDOW_SECONDS
        self.enabled = settings.RATE_LIMIT_ENABLED

    async def dispatch(self, request: Request, call_next: Callable):
        if not self.enabled:
            return await call_next(request)

        if request.url.path.startswith("/docs") or request.url.path.startswith("/openapi.json"):
            return await call_next(request)

        identifier = request.client.host if request.client else "anonymous"
        now = datetime.utcnow()
        window_start = now - timedelta(seconds=self.window_seconds)

        timestamps = [ts for ts in self.requests[identifier] if ts > window_start]
        self.requests[identifier] = timestamps

        if len(timestamps) >= self.limit:
            return JSONResponse(
                status_code=429,
                content={
                    "error": {
                        "code": "RATE_LIMIT_EXCEEDED",
                        "message": "Too many requests. Please try again later.",
                        "traceId": request.headers.get("X-Request-ID", "unknown"),
                    }
                },
            )

        self.requests[identifier].append(now)
        return await call_next(request)
