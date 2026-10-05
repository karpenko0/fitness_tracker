"""Idempotency middleware (SPEC-011 7.1).

- Mutation requests under /api/v1/admin MUST carry an Idempotency-Key (400 otherwise).
- Same key + same request (method, path, body) -> the stored response is replayed.
- Same key + different body -> 409 IDEMPOTENCY_KEY_REUSED.
- Only successful (2xx) responses are stored, so transient auth/validation errors
  can be retried with the same key.
"""
import hashlib
import json
from datetime import datetime, timedelta
from typing import Callable

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.database import SessionLocal
from app.models.idempotency_key import IdempotencyKey
from app.services.auth import decode_access_token

MUTATING_METHODS = ("POST", "PUT", "PATCH", "DELETE")


def _request_hash(method: str, path: str, body: bytes) -> str:
    return hashlib.sha256(f"{method}:{path}:{body}".encode("utf-8")).hexdigest()


def _error_response(status_code: int, code: str, message: str, request: Request) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": code,
                "message": message,
                "details": None,
                "requestId": getattr(request.state, "request_id", None),
            },
            "detail": {"code": code, "message": message},
        },
    )


class IdempotencyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        is_admin = request.url.path.startswith("/api/v1/admin")
        key = request.headers.get("Idempotency-Key")
        body = await request.body()

        # Login/MFA endpoints are exempt from the mandatory key (rate limit protects them);
        # a key is still honoured when present.
        auth_exempt = request.url.path.endswith("/admin/auth/login") or request.url.path.endswith("/admin/auth/mfa/verify")
        if is_admin and request.method in MUTATING_METHODS and not auth_exempt:
            if not key:
                return _error_response(
                    400,
                    "MISSING_IDEMPOTENCY_KEY",
                    "All mutation endpoints require an Idempotency-Key header.",
                    request,
                )
            if len(key) > 255:
                return _error_response(400, "VALIDATION_ERROR", "Idempotency-Key too long (max 255).", request)

        if not key or request.method not in MUTATING_METHODS:
            return await call_next(request)

        req_hash = _request_hash(request.method, request.url.path, body)

        db = SessionLocal()
        try:
            existing = db.query(IdempotencyKey).filter(IdempotencyKey.key == key).first()
            if existing:
                expired = existing.expires_at is not None and existing.expires_at < datetime.utcnow()
                if not expired:
                    same_request = (
                        existing.request_hash is None
                        or (
                            existing.request_hash == req_hash
                            and existing.method == request.method
                            and str(existing.path) == request.url.path
                        )
                    )
                    if same_request:
                        return JSONResponse(
                            status_code=int(existing.response_code or 200),
                            content=json.loads(existing.response_body) if existing.response_body else {},
                        )
                    return _error_response(
                        409, "IDEMPOTENCY_KEY_REUSED", "Idempotency-Key was already used with a different request.", request
                    )

            response = await call_next(request)

            if 200 <= response.status_code < 300:
                resp_body = b""
                async for chunk in response.body_iterator:
                    resp_body += chunk
                try:
                    text = resp_body.decode()
                except Exception:
                    text = str(resp_body)

                now = datetime.utcnow()
                record = IdempotencyKey(
                    key=key,
                    user_id=self._extract_user_id(request),
                    method=request.method,
                    path=str(request.url.path),
                    request_hash=req_hash,
                    response_code=str(response.status_code),
                    response_body=text,
                    created_at=now,
                    expires_at=now + timedelta(hours=24),
                )
                db.add(record)
                db.commit()
                return Response(content=resp_body, status_code=response.status_code, headers=dict(response.headers))

            return response
        finally:
            db.close()

    @staticmethod
    def _extract_user_id(request: Request):
        from uuid import UUID as PyUUID

        authorization = request.headers.get("Authorization")
        if authorization and authorization.startswith("Bearer "):
            try:
                payload = decode_access_token(authorization.split(" ", 1)[1])
                return PyUUID(str(payload.get("sub")))
            except Exception:
                return None
        return None
