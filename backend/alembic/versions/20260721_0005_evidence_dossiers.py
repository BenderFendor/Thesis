"""Add public entity kinds, relationship lifecycle, and ingest-run ledger.

Revision ID: 20260721_0005
Revises: 20260721_0004
Create Date: 2026-07-21
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260721_0005"
down_revision = "20260721_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Backfill typed public entities and add lifecycle and ingest state."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    entity_columns = {column["name"] for column in inspector.get_columns("evidence_entities")}
    if "entity_kind" not in entity_columns:
        op.add_column("evidence_entities", sa.Column("entity_kind", sa.String(64)))
        op.execute(
            """
            UPDATE evidence_entities SET entity_kind = CASE record_kind
              WHEN 'publication' THEN 'publication_brand'
              WHEN 'digital_property' THEN 'publication_brand'
              WHEN 'feed' THEN 'publication_brand'
              WHEN 'person' THEN 'person'
              WHEN 'organization_without_legal_identity' THEN 'organization'
              ELSE record_kind
            END
            """
        )
        op.alter_column("evidence_entities", "entity_kind", nullable=False)
        op.create_index("ix_evidence_entities_entity_kind", "evidence_entities", ["entity_kind"])

    relationship_columns = {
        column["name"] for column in inspector.get_columns("accepted_relationships")
    }
    if "lifecycle_state" not in relationship_columns:
        op.add_column(
            "accepted_relationships",
            sa.Column("lifecycle_state", sa.String(32), nullable=False, server_default="current"),
        )
        op.create_index(
            "ix_accepted_relationships_lifecycle_state",
            "accepted_relationships",
            ["lifecycle_state"],
        )
        op.create_check_constraint(
            "ck_accepted_relationship_lifecycle_state",
            "accepted_relationships",
            "lifecycle_state IN ('current','historical','proposed','pending','disputed','rejected','superseded')",
        )
        op.alter_column("accepted_relationships", "lifecycle_state", server_default=None)

    if "evidence_ingest_runs" not in inspector.get_table_names():
        op.create_table(
            "evidence_ingest_runs",
            sa.Column("id", sa.String(64), primary_key=True),
            sa.Column("adapter", sa.String(64), nullable=False),
            sa.Column("adapter_version", sa.String(64), nullable=False),
            sa.Column("scope", sa.JSON(), nullable=False),
            sa.Column("started_at", sa.DateTime(), nullable=False),
            sa.Column("completed_at", sa.DateTime()),
            sa.Column("status", sa.String(32), nullable=False),
            sa.Column("network_mode", sa.String(32), nullable=False),
            sa.Column("documents_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("snapshots_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("observations_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("claims_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("accepted_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("candidate_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("failure", sa.Text()),
            sa.Column("retryable", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("missing_credentials", sa.JSON(), nullable=False),
            sa.CheckConstraint(
                "status IN ('running','success','partial','failed','blocked','skipped')",
                name="ck_evidence_ingest_runs_status",
            ),
            sa.CheckConstraint(
                "network_mode IN ('live','offline','disabled')",
                name="ck_evidence_ingest_runs_network_mode",
            ),
        )
        for column in ("adapter", "started_at", "completed_at", "status"):
            op.create_index(f"ix_evidence_ingest_runs_{column}", "evidence_ingest_runs", [column])


def downgrade() -> None:
    """Remove the dossier contract additions."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "evidence_ingest_runs" in inspector.get_table_names():
        op.drop_table("evidence_ingest_runs")
    relationship_columns = {
        column["name"] for column in inspector.get_columns("accepted_relationships")
    }
    if "lifecycle_state" in relationship_columns:
        op.drop_column("accepted_relationships", "lifecycle_state")
    entity_columns = {column["name"] for column in inspector.get_columns("evidence_entities")}
    if "entity_kind" in entity_columns:
        op.drop_column("evidence_entities", "entity_kind")
