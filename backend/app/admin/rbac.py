"""Admin RBAC (SPEC-011 6.4): permission matrix, deny-by-default enforcement.

Permission format: resource:action. UI hiding of buttons is never an access control —
every endpoint re-checks the permission here on the backend.
"""
from dataclasses import dataclass, field
from typing import Dict, Set

from app.models.user import ROLE_RANK, UserRole

# Matrix from SPEC-011 6.4. billing:manual_status is intentionally absent for ALL roles:
# payment status changes only via provider webhook or reconciliation job.
PERMISSIONS_BY_ROLE: Dict[str, Set[str]] = {
    UserRole.CONTENT_MANAGER.value: {
        "content:read",
        "content:write",
        "content:publish",  # may require approval workflow (env policy)
        "media:read",
        "media:write",
        "media:delete",
        "notifications:manage",
        "habits:manage",
        "challenges:manage",
        "analytics:read",  # limited: /analytics/content only (enforced in routes)
    },
    UserRole.ADMIN.value: {
        "users:read",
        "users:block",
        "users:export",
        "roles:read",
        "billing:read",
        "billing:replay",
        "content:read",
        "content:write",
        "content:publish",
        "media:read",
        "media:write",
        "media:delete",
        "notifications:manage",
        "habits:manage",
        "challenges:manage",
        "promo:manage",
        "analytics:read",
        "audit:read",
        "exports:create",
        "bulk:execute",
    },
    UserRole.SUPER_ADMIN.value: {
        "users:read",
        "users:block",
        "users:delete",
        "users:export",
        "roles:read",
        "roles:manage",
        "billing:read",
        "billing:replay",
        "content:read",
        "content:write",
        "content:publish",
        "content:force_unpublish",
        "media:read",
        "media:write",
        "media:delete",
        "notifications:manage",
        "habits:manage",
        "challenges:manage",
        "promo:manage",
        "analytics:read",
        "audit:read",
        "settings:manage",
        "exports:create",
        "bulk:execute",
    },
}

# Critical actions require a fresh (non-idle) admin session — step-up authentication (SPEC-011 6.1).
CRITICAL_PERMISSIONS: Set[str] = {
    "users:block",
    "users:delete",
    "users:roles",
    "roles:manage",
    "content:publish",
    "content:force_unpublish",
    "billing:replay",
    "promo:manage",
    "bulk:execute",
    "settings:manage",
    "media:delete",
    "exports:create",
    "notifications:send",
}

PERMISSIONS_BY_ROLE[UserRole.ADMIN.value] = PERMISSIONS_BY_ROLE[UserRole.ADMIN.value] | {"users:roles"}
PERMISSIONS_BY_ROLE[UserRole.SUPER_ADMIN.value] = (
    PERMISSIONS_BY_ROLE[UserRole.SUPER_ADMIN.value] | {"users:roles", "users:admin_session_revoke", "notifications:send"}
)
PERMISSIONS_BY_ROLE[UserRole.CONTENT_MANAGER.value] |= set()


def has_permission(role: str, permission: str) -> bool:
    """Deny-by-default: unknown roles or unknown permissions are rejected."""
    if not role or not permission:
        return False
    return permission in PERMISSIONS_BY_ROLE.get(role, set())


def can_assign_role(actor_role: str, target_role: str) -> bool:
    """ADMIN cannot grant SUPER_ADMIN; nobody grants a role above their own (SPEC-011 6.3)."""
    try:
        return ROLE_RANK.get(target_role, 99) <= ROLE_RANK.get(actor_role, -1)
    except Exception:
        return False


def permission_matrix_for_ui() -> list:
    """Matrix in a form the panel can render (role x permission)."""
    all_perms = sorted({p for perms in PERMISSIONS_BY_ROLE.values() for p in perms})
    return [
        {
            "role": role,
            "permissions": sorted(PERMISSIONS_BY_ROLE.get(role, set())),
        }
        for role in (UserRole.CONTENT_MANAGER.value, UserRole.ADMIN.value, UserRole.SUPER_ADMIN.value)
    ] + [{"allPermissions": all_perms}]
