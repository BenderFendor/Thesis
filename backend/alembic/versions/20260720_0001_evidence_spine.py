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

_TABLES = (
    "evidence_entities", "entity_external_ids", "entity_resolutions", "evidence_documents",
    "document_snapshots", "archive_requests", "evidence_observations", "evidence_claims",
    "claim_evidence_links", "accepted_relationships", "relationship_claim_links", "source_lineage",
    "adjudication_items", "calculation_traces", "evidence_policy_rows", "external_material_events",
    "preregistrations", "measurement_validation_cards", "corpus_coverage_windows", "proof_runs",
)


def upgrade() -> None:
    bind = op.get_bind()
    metadata = evidence_models.Base.metadata
    for table_name in _TABLES:
        metadata.tables[table_name].create(bind, checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    metadata = evidence_models.Base.metadata
    for table_name in reversed(_TABLES):
        metadata.tables[table_name].drop(bind, checkfirst=True)
