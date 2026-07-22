"""Add direct subsidiaries to organization research profiles.

Revision ID: 20260721_0004
Revises: 20260720_0003
Create Date: 2026-07-21
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260721_0004"
down_revision = "20260720_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add the nullable JSON subsidiaries profile field when absent."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("organizations")}
    if "subsidiaries" not in columns:
        op.add_column(
            "organizations",
            sa.Column("subsidiaries", sa.JSON(), nullable=True),
        )


def downgrade() -> None:
    """Drop the subsidiaries profile field when present."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("organizations")}
    if "subsidiaries" in columns:
        op.drop_column("organizations", "subsidiaries")
