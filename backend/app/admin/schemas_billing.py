"""Billing admin DTOs."""
from typing import Optional

from pydantic import Field

from .common import ConfirmMixin, StrictModel


class WebhookReplayRequest(ConfirmMixin):
    pass


class ManualPaymentStatusRequest(StrictModel):
    status: str = Field(pattern="^(CREATED|PENDING|PAID|REFUNDED|FAILED|EXPIRED|CANCELLED)$")
    reason: Optional[str] = Field(default=None, max_length=1000)
