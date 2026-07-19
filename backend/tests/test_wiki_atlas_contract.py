from datetime import UTC, datetime

from app.models.atlas import (
    AtlasEdge,
    AtlasGraphFilters,
    AtlasGraphResponse,
    AtlasGraphStats,
    AtlasNode,
)


def test_graph_contract_rejects_unbounded_filter_values() -> None:
    filters = AtlasGraphFilters(limit_nodes=350, limit_edges=1500)
    assert filters.limit_nodes == 350
    assert filters.limit_edges == 1500


def test_graph_contract_keeps_stable_endpoint_ids() -> None:
    node = AtlasNode(id="source:abc", entity_type="source", label="Example")
    edge = AtlasEdge(
        id="edge:1",
        source_id="organization:1",
        target_id=node.id,
        relation_type="ownership",
        confidence=0.9,
        confidence_tier="verified",
    )
    response = AtlasGraphResponse(
        graph_version="v1",
        generated_at=datetime.now(UTC),
        nodes=[node],
        edges=[edge],
        stats=AtlasGraphStats(),
        applied_filters=AtlasGraphFilters(),
    )
    assert response.edges[0].target_id == response.nodes[0].id
    assert response.graph_version == "v1"
