"""Admin panel router aggregation (SPEC-011 7). Mount under /api/v1/admin."""
from fastapi import APIRouter

from . import (
    routes_analytics,
    routes_auth,
    routes_billing,
    routes_catalog,
    routes_content,
    routes_dashboard,
    routes_users,
)

admin_router = APIRouter()

admin_router.include_router(routes_auth.router)
admin_router.include_router(routes_dashboard.router)
admin_router.include_router(routes_users.router)
admin_router.include_router(routes_billing.router)
admin_router.include_router(routes_content.router)
admin_router.include_router(routes_catalog.router)
admin_router.include_router(routes_analytics.router)
