"""Typed dossier and exact-interest API contract regressions."""

from app.models.atlas import (
    AtlasConnectionRecord,
    AtlasDossierSection,
    AtlasDossierStatement,
    AtlasEdge,
    AtlasNode,
)
from app.services.atlas_entity import _build_dossier_sections
from app.services.atlas_graph import _rank_nodes


def test_ranged_interest_is_not_replaced_by_midpoint_float():
    edge = AtlasEdge(
        id="edge:test",
        source_id="organization:owner",
        target_id="outlet:publication",
        relation_type="ownership",
        predicate="owns_equity_in",
        display_group="ownership_control",
        economic_interest={"lower": "49.9", "upper": "50.1"},
        lifecycle_state="current",
    )

    assert edge.ownership_percentage is None
    assert edge.economic_interest == {"lower": "49.9", "upper": "50.1"}
    assert edge.predicate == "owns_equity_in"
    assert edge.relation_type_deprecated is True


def test_unknown_dossier_state_is_explicit():
    section = AtlasDossierSection(
        key="ownership_control",
        title="Ownership and control",
        statements=[
            AtlasDossierStatement(
                label="Current owner or operator",
                answer="The legal chain is incomplete.",
                state="chain_incomplete",
            )
        ],
    )

    assert section.statements[0].state == "chain_incomplete"


def test_directory_node_reports_current_parent_pending_change_and_evidence():
    nodes = [
        AtlasNode(id="outlet:test", entity_type="outlet", label="Test News"),
        AtlasNode(id="organization:current", entity_type="organization", label="Current Corp"),
        AtlasNode(id="organization:pending", entity_type="organization", label="Pending Corp"),
    ]
    edges = [
        AtlasEdge(
            id="current",
            source_id="organization:current",
            target_id="outlet:test",
            relation_type="ownership",
            predicate="directly_owns",
            accepted_fact=True,
            fact_status="accepted",
            lifecycle_state="current",
            evidence_count=2,
        ),
        AtlasEdge(
            id="pending",
            source_id="organization:pending",
            target_id="outlet:test",
            relation_type="ownership",
            predicate="controls",
            lifecycle_state="proposed",
            evidence_count=1,
        ),
    ]

    ranked = _rank_nodes(nodes, edges, None)
    outlet = next(node for node in ranked if node.id == "outlet:test")
    assert outlet.current_parent == "Current Corp"
    assert outlet.pending_change == "proposed: Pending Corp"
    assert outlet.evidence_coverage == "3 cited observations"
    assert outlet.unresolved_gap is None


def test_dossier_reads_projected_brand_direction_and_separates_owner_proposal():
    cnn = AtlasNode(id="outlet:cnn", entity_type="outlet", label="CNN")
    wbd = AtlasNode(id="organization:wbd", entity_type="organization", label="WBD")
    paramount = AtlasNode(
        id="organization:paramount", entity_type="organization", label="Paramount"
    )
    connections = [
        AtlasConnectionRecord(
            entity=wbd,
            edge=AtlasEdge(
                id="brand",
                source_id=wbd.id,
                target_id=cnn.id,
                relation_type="ownership",
                predicate="brand_of",
                accepted_fact=True,
                lifecycle_state="current",
            ),
        ),
        AtlasConnectionRecord(
            entity=paramount,
            edge=AtlasEdge(
                id="proposal",
                source_id=wbd.id,
                target_id=paramount.id,
                relation_type="ownership",
                predicate="successor_of",
                accepted_fact=True,
                lifecycle_state="proposed",
            ),
        ),
    ]

    sections = _build_dossier_sections(cnn.id, {}, connections)
    summary = next(section for section in sections if section.key == "summary")
    ownership = next(section for section in sections if section.key == "ownership_control")

    assert summary.statements[0].answer == "WBD"
    assert summary.statements[0].predicate == "brand_of"
    assert any(statement.answer == "Paramount" for statement in ownership.statements)


def test_directory_propagates_owner_proposal_to_brand():
    nodes = [
        AtlasNode(id="outlet:cnn", entity_type="outlet", label="CNN"),
        AtlasNode(id="organization:wbd", entity_type="organization", label="WBD"),
        AtlasNode(id="organization:paramount", entity_type="organization", label="Paramount"),
    ]
    edges = [
        AtlasEdge(
            id="brand",
            source_id="organization:wbd",
            target_id="outlet:cnn",
            relation_type="ownership",
            predicate="brand_of",
            accepted_fact=True,
            lifecycle_state="current",
        ),
        AtlasEdge(
            id="proposal",
            source_id="organization:wbd",
            target_id="organization:paramount",
            relation_type="ownership",
            predicate="successor_of",
            accepted_fact=True,
            lifecycle_state="proposed",
        ),
    ]

    ranked = _rank_nodes(nodes, edges, None)
    cnn = next(node for node in ranked if node.id == "outlet:cnn")

    assert cnn.current_parent == "WBD"
    assert cnn.pending_change == "proposed: Paramount"
