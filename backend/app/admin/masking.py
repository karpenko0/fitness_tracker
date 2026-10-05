"""Masking helpers (SPEC-011 9.3): email, Telegram id, provider transaction id, IP.
Only masked values may appear in admin responses and audit summaries."""
import hashlib


def mask_email(email: str | None) -> str | None:
    if not email or "@" not in email:
        return email
    local, domain = email.rsplit("@", 1)
    visible = local[:1] if local else ""
    return f"{visible}***@{domain}"


def mask_telegram_id(value: str | int | None) -> str | None:
    if value is None:
        return None
    s = str(value)
    if len(s) <= 4:
        return "****"
    return f"***{s[-4:]}"


def mask_transaction_id(value: str | None) -> str | None:
    if value is None:
        return None
    s = str(value)
    if len(s) <= 4:
        return "****"
    return f"****{s[-4:]}"


def ip_hash(ip: str | None, salt: str) -> str | None:
    if not ip:
        return None
    return hashlib.sha256(f"{salt}:{ip}".encode("utf-8")).hexdigest()[:64]


def user_agent_hash(ua: str | None, salt: str) -> str | None:
    if not ua:
        return None
    return hashlib.sha256(f"{salt}:{ua}".encode("utf-8")).hexdigest()[:64]


SENSITIVE_KEY_MARKERS = (
    "password",
    "passwd",
    "secret",
    "token",
    "initdata",
    "init_data",
    "card",
    "cvv",
    "pan",
    "refresh",
    "authorization",
    "email",
    "telegram",
    "transaction_id",
    "phone",
)


def redact(obj):
    """Recursively redact sensitive keys from a dict/JSON structure (audit summaries, exports)."""
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            kl = str(k).lower()
            if any(marker in kl for marker in SENSITIVE_KEY_MARKERS):
                out[k] = "***REDACTED***"
            else:
                out[k] = redact(v)
        return out
    if isinstance(obj, list):
        return [redact(item) for item in obj]
    return obj
