"""Drop the unused evidence_policy_rows table.

`EvidencePolicyRow` was created for future predicate-policy versioning but
was never read by `app.services.evidence_policy`, which is the sole source
of truth for active policies (see `evidence_policy.POLICIES`/`POLICY_VERSION`
and its module docstring). Dropping the table instead of wiring it up avoids
a second, unsynchronized copy of policy state that nothing keeps consistent.

Revision ID: 20260720_0003
Revises: 20260720_0002
Create Date: 2026-07-20
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260720_0003"
down_revision = "20260720_0002"
branch_labels = None
depends_on = None

_TABLE_NAME = "evidence_policy_rows"


def upgrade() -> None:
    """Drop the table (idempotent via checkfirst)."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table(_TABLE_NAME):
        op.drop_table(_TABLE_NAME)


def downgrade() -> None:
    """Recreate the table with its original shape, empty."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table(_TABLE_NAME):
        return
    op.create_table(
        _TABLE_NAME,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("predicate", sa.String(96), nullable=False, index=True),
        sa.Column("version", sa.String(64), nullable=False),
        sa.Column("allowed_evidence_classes", sa.JSON(), nullable=False),
        sa.Column("minimum_independent_roots", sa.Integer(), nullable=False),
        sa.Column("requires_complete_path", sa.Boolean(), nullable=False),
        sa.Column("permits_catalog_only", sa.Boolean(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, index=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("predicate", "version", name="uq_evidence_policy_predicate_version"),
    )
