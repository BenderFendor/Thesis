"""Add materialization audit trail and reviewed_yes reviewer integrity check.

Revision ID: 20260720_0002
Revises: 20260720_0001
Create Date: 2026-07-20
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260720_0002"
down_revision = "20260720_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add accepted_relationships.materialized_by and the reviewer-integrity check."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("accepted_relationships")}
    if "materialized_by" not in columns:
        op.add_column(
            "accepted_relationships",
            sa.Column("materialized_by", sa.String(length=255), nullable=True),
        )
    constraints = {
        constraint["name"]
        for constraint in inspector.get_check_constraints("evidence_observations")
    }
    if "ck_evidence_observation_reviewed_yes_has_reviewer" not in constraints:
        op.create_check_constraint(
            "ck_evidence_observation_reviewed_yes_has_reviewer",
            "evidence_observations",
            "entailment != 'reviewed_yes' OR reviewed_by IS NOT NULL",
        )


def downgrade() -> None:
    """Drop the reviewer-integrity check and the materialization audit column."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    constraints = {
        constraint["name"]
        for constraint in inspector.get_check_constraints("evidence_observations")
    }
    if "ck_evidence_observation_reviewed_yes_has_reviewer" in constraints:
        op.drop_constraint(
            "ck_evidence_observation_reviewed_yes_has_reviewer",
            "evidence_observations",
            type_="check",
        )
    columns = {col["name"] for col in inspector.get_columns("accepted_relationships")}
    if "materialized_by" in columns:
        op.drop_column("accepted_relationships", "materialized_by")
