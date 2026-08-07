"""Simple idempotency middleware: stores responses for requests with Idempotency-Key"""
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response, JSONResponse
from typing import Callable
from app.database import SessionLocal
from app.models.idempotency_key import IdempotencyKey
from app.services.auth import decode_access_token
import json


class IdempotencyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        key = request.headers.get("Idempotency-Key")
        if not key or request.method not in ("POST", "PUT", "DELETE"):
            return await call_next(request)

        db = SessionLocal()
        try:
            existing = db.query(IdempotencyKey).filter(IdempotencyKey.key == key).first()
            if existing:
                try:
                    body = json.loads(existing.response_body) if existing.response_body else {}
                except Exception:
                    body = existing.response_body
                return JSONResponse(status_code=int(existing.response_code or 200), content=body)

            user_id = None
            authorization = request.headers.get("Authorization")
            if authorization and authorization.startswith("Bearer "):
                token = authorization.split(" ", 1)[1]
                try:
                    payload = decode_access_token(token)
                    user_id = payload.get("sub")
                except Exception:
                    user_id = None

            response = await call_next(request)
            body = b""
            async for chunk in response.body_iterator:
                body += chunk

            text = None
            try:
                text = body.decode()
            except Exception:
                text = str(body)

            record = IdempotencyKey(
                key=key,
                user_id=user_id,
                method=request.method,
                path=str(request.url.path),
                response_code=str(response.status_code),
                response_body=text,
            )
            db.add(record)
            db.commit()

            return Response(content=body, status_code=response.status_code, headers=dict(response.headers))
        finally:
            db.close()
