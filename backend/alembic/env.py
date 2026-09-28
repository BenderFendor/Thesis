"""Alembic runtime is frozen after the SQLx schema handoff."""

raise RuntimeError(
    "Alembic runtime migrations are disabled; use the explicit SQLx migration "
    "command for schema changes."
)
