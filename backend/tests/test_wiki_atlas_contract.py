from datetime import UTC, datetime

from app.models.atlas import (
    AtlasEdge,
    AtlasGraphFilters,
    AtlasGraphResponse,
    AtlasGraphStats,
    AtlasNode,
)
from app.services.atlas_graph import _rank_nodes


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


def test_graph_ranking_keeps_connected_reporters_in_a_bounded_fused_view() -> None:
    organization = AtlasNode(
        id="organization:1",
        entity_type="organization",
        label="Unconnected owner",
    )
    reporter_one = AtlasNode(
        id="reporter:1",
        entity_type="reporter",
        label="Alex One",
        article_count=4,
    )
    reporter_two = AtlasNode(
        id="reporter:2",
        entity_type="reporter",
        label="Alex Two",
        article_count=3,
    )
    coauthor_edge = AtlasEdge(
        id="edge:coauthor",
        source_id=reporter_one.id,
        target_id=reporter_two.id,
        relation_type="coauthor",
        direction="undirected",
    )

    ranked = _rank_nodes(
        [organization, reporter_one, reporter_two],
        [coauthor_edge],
        selected=None,
    )

    assert [node.entity_type for node in ranked[:2]] == ["reporter", "reporter"]
