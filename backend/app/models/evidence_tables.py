"""Names owned exclusively by the evidence-spine Alembic revision."""

# Keep this tuple synchronized with
# backend/alembic/versions/20260720_0001_evidence_spine.py.  It lives outside
# the SQLAlchemy model modules so database startup can consult it without
# importing models that depend on ``app.database.Base``.
EVIDENCE_SPINE_TABLES = (
    "evidence_entities",
    "entity_external_ids",
    "entity_resolutions",
    "evidence_documents",
    "document_snapshots",
    "archive_requests",
    "evidence_observations",
    "evidence_claims",
    "claim_evidence_links",
    "accepted_relationships",
    "relationship_claim_links",
    "source_lineage",
    "adjudication_items",
    "calculation_traces",
    "external_material_events",
    "preregistrations",
    "measurement_validation_cards",
    "corpus_coverage_windows",
    "proof_runs",
    "evidence_ingest_runs",
)
