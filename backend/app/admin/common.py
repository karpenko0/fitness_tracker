"""Shared helpers for admin routes (SPEC-011 7.1)."""
import inspect
from typing import Any, Optional

from fastapi import HTTPException, Request, status
from fastapi.params import Depends as FastDepends
from pydantic import BaseModel, ConfigDict, Field


def ok(data: Any) -> dict:
    """Success envelope: { "data": ... } (SPEC-011 7.1)."""
    return {"data": data}


def err_response(code: str, message: str, http_status: int, details: Any = None) -> HTTPException:
    return HTTPException(
        status_code=http_status,
        detail={"code": code, "message": message, "details": details},
    )


class StrictModel(BaseModel):
    """Base for admin DTOs: unknown fields are rejected (SPEC-011 7.1)."""

    model_config = ConfigDict(extra="forbid")


class ConfirmMixin(StrictModel):
    confirm: bool = Field(default=False, description="Explicit approval for critical/bulk actions")


def require_confirm(payload: Any, settings) -> None:
    """Approval gate (SPEC-011 14): critical operations need explicit confirmation."""
    if not settings.APPROVAL_GATE_ENABLED:
        return
    if not getattr(payload, "confirm", False):
        raise err_response("CONFIRMATION_REQUIRED", "Operation requires confirm: true", status.HTTP_400_BAD_REQUEST)


def reject_unknown_query_params(request: Request) -> None:
    """Reject unknown query parameters (SPEC-011 7.1).

    Query params are exactly the endpoint arguments that have a default and are not
    FastAPI dependencies; path params have no defaults; body params are excluded.
    """
    endpoint = request.scope.get("endpoint")
    if endpoint is None:
        return
    try:
        sig = inspect.signature(endpoint)
    except (TypeError, ValueError):
        return
    allowed = set()
    for name, param in sig.parameters.items():
        if param.default is not inspect.Parameter.empty and not isinstance(param.default, FastDepends):
            allowed.add(name)
    for key in request.query_params.keys():
        if key not in allowed:
            raise err_response(
                "UNKNOWN_QUERY_PARAMETER",
                f"Unknown query parameter: {key}",
                status.HTTP_400_BAD_REQUEST,
            )


def paginate_params(page: int = 1, page_size: int = 20, sort: Optional[str] = None) -> tuple:
    if page < 1:
        raise err_response("VALIDATION_ERROR", "page must be >= 1", status.HTTP_400_BAD_REQUEST)
    if page_size < 1 or page_size > 100:
        raise err_response("VALIDATION_ERROR", "pageSize must be between 1 and 100", status.HTTP_400_BAD_REQUEST)
    return page, page_size, sort
