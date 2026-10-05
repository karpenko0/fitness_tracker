"""admin panel SPEC-011: admin/content/billing tables, user & idempotency deltas

Revision ID: 0002_admin_panel_spec_011
Revises: 0001_initial_schema
Create Date: 2026-10-05 00:00:00.000000

The schema is derived from the application's SQLAlchemy metadata
(`Base.metadata`) so the DDL stays in sync with the ORM models:

- every table present in the models but not created by 0001_initial_schema
  is created here (foreign-key order via ``sorted_tables``);
- ``users`` and ``idempotency_keys`` receive the columns added for
  SPEC-011 (admin fields) and the Telegram binding fields.

Columns are re-materialised as unbound ``sa.Column`` objects so that
index creation stays explicit (the index set mirrors ``Table.indexes``
exactly, as ``create_all`` would produce).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# Importing these modules registers every table in Base.metadata.
from app.models import Base  # noqa: E402,F401
from app.admin import models as _admin_models  # noqa: F401  (admin_* tables)
from app.admin import models_billing as _admin_billing  # noqa: F401
from app.admin import models_content as _admin_content  # noqa: F401
from app.habits import models as _habit_models  # noqa: F401  (habits/tasks/deliveries/challenges)

# revision identifiers, used by Alembic.
revision = "0002_admin_panel_spec_011"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None

TABLES_IN_0001 = {"users", "product_features", "plans", "audit_logs", "idempotency_keys"}

# Columns present in 0001 for the modified tables (used to compute deltas).
USERS_COLS_0001 = {
    "id", "email", "password_hash", "first_name", "last_name",
    "role", "timezone", "is_active", "created_at", "updated_at",
}
IDEMPOTENCY_COLS_0001 = {
    "key", "user_id", "method", "path", "response_code", "response_body", "created_at",
}

# Indexes that Base.metadata (create_all) produces for the 0001 tables but
# 0001_initial_schema never created — added here so the migrated schema fully
# matches the ORM metadata (table -> [(columns, unique), ...]).
LEGACY_INDEXES = {
    "users": [(["email"], True), (["role"], False)],
    "plans": [(["code"], True), (["status"], False)],
    "product_features": [(["code"], True), (["enabled"], False)],
    "audit_logs": [(["user_id"], False), (["entity_id"], False), (["created_at"], False)],
    "idempotency_keys": [(["user_id"], False)],
}


def _fresh_column(col: sa.Column) -> sa.Column:
    """Re-materialise a metadata column without table binding/index flags."""
    kwargs: dict = {}
    if col.primary_key:
        kwargs["primary_key"] = True
    if col.nullable is not None:
        kwargs["nullable"] = col.nullable
    if col.server_default is not None:
        kwargs["server_default"] = col.server_default
    new_col = sa.Column(col.name, col.type, **kwargs)
    if col.autoincrement:
        new_col.autoincrement = col.autoincrement
    return new_col


def _new_tables():
    return [t for t in Base.metadata.sorted_tables if t.name not in TABLES_IN_0001]


def upgrade() -> None:
    for table in _new_tables():
        columns = [_fresh_column(c) for c in table.columns]
        constraints = [
            sa.UniqueConstraint(*[col.name for col in c.columns], name=c.name)
            for c in table.constraints
            if c.__class__.__name__ == "UniqueConstraint" and c.name
        ]
        fks = [
            sa.ForeignKeyConstraint(list(c.column_keys), [str(r) for r in c.referred_elements], name=c.name)
            for c in table.foreign_key_constraints
            if c.name
        ]
        op.create_table(table.name, *columns, *constraints, *fks)
        for index in table.indexes:
            op.create_index(
                index.name,
                table.name,
                [c.name for c in index.columns],
                unique=index.unique,
            )

    # --- users: SPEC-011 + Telegram binding columns -------------------------
    users = Base.metadata.tables["users"]
    for col in users.columns:
        if col.name not in USERS_COLS_0001:
            op.add_column("users", _fresh_column(col))
    op.create_index("ix_users_telegram_chat_id", "users", ["telegram_chat_id"], unique=True)

    # --- idempotency_keys: request hash + expiry (SPEC-011 7.2) -------------
    idem = Base.metadata.tables["idempotency_keys"]
    for col in idem.columns:
        if col.name not in IDEMPOTENCY_COLS_0001:
            op.add_column("idempotency_keys", _fresh_column(col))

    # --- legacy indexes for the 0001 tables (create_all parity) -------------
    # Idempotent: 0001's op.create_table auto-creates indexes for columns with
    # index=True on a fresh database, while pre-existing ("production") databases
    # created by the original 0001 run may lack them. Create only what is missing
    # so `upgrade head` works from both starting points.
    for table_name, indexes in LEGACY_INDEXES.items():
        existing = {ix["name"] for ix in inspect(op.get_bind()).get_indexes(table_name)}
        for cols, unique in indexes:
            name = f"ix_{table_name}_{cols[0]}"
            if name not in existing:
                op.create_index(name, table_name, cols, unique=unique)


def downgrade() -> None:
    # Drop only the legacy indexes that exist (mirrors the idempotent upgrade).
    for table_name, indexes in LEGACY_INDEXES.items():
        existing = {ix["name"] for ix in inspect(op.get_bind()).get_indexes(table_name)}
        for cols, _unique in indexes:
            name = f"ix_{table_name}_{cols[0]}"
            if name in existing:
                op.drop_index(name, table_name=table_name)
    for table in reversed(_new_tables()):
        for index in table.indexes:
            op.drop_index(index.name, table_name=table.name)
        op.drop_table(table.name)
    op.drop_index("ix_users_telegram_chat_id", table_name="users")
    users = Base.metadata.tables["users"]
    for col in reversed(list(users.columns)):
        if col.name not in USERS_COLS_0001:
            op.drop_column("users", col.name)
    idem = Base.metadata.tables["idempotency_keys"]
    for col in reversed(list(idem.columns)):
        if col.name not in IDEMPOTENCY_COLS_0001:
            op.drop_column("idempotency_keys", col.name)
