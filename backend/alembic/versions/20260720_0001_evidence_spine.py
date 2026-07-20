"""Create the bitemporal evidence spine.

Revision ID: 20260720_0001
Revises:
Create Date: 2026-07-20
"""

from __future__ import annotations
from alembic import op
from app.models import evidence as evidence_models

revision = "20260720_0001"
down_revision = None
branch_labels = None
depends_on = None

_TABLES = evidence_models.EVIDENCE_SPINE_TABLES


def upgrade() -> None:
    """Create every evidence-spine table (idempotent via checkfirst)."""
    bind = op.get_bind()
    metadata = evidence_models.Base.metadata
    for table_name in _TABLES:
        metadata.tables[table_name].create(bind, checkfirst=True)


def downgrade() -> None:
    """Drop every evidence-spine table (idempotent via checkfirst)."""
    bind = op.get_bind()
    metadata = evidence_models.Base.metadata
    for table_name in reversed(_TABLES):
        metadata.tables[table_name].drop(bind, checkfirst=True)
