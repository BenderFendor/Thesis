"""Offline contracts for the Rust B11 discovery operation boundary."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
OPENAPI_PATH = ROOT / "backend/openapi.json"

B11_OPERATIONS = {
    ("/trending", "get"): "get_trending_trending_get",
    ("/trending/breaking", "get"): "get_breaking_trending_breaking_get",
    ("/trending/clusters", "get"): "get_all_clusters_trending_clusters_get",
    ("/trending/clusters/{cluster_id}", "get"): "get_cluster_detail_trending_clusters__cluster_id__get",
    (
        "/trending/clusters/{cluster_id}/contradictions",
        "get",
    ): "get_cluster_contradictions_trending_clusters__cluster_id__contradictions_get",
    (
        "/trending/clusters/{cluster_id}/lineage",
        "get",
    ): "get_cluster_lineage_trending_clusters__cluster_id__lineage_get",
    ("/trending/stats", "get"): "get_trending_stats_trending_stats_get",
    (
        "/api/similarity/related/{article_id}",
        "get",
    ): "get_related_articles_api_similarity_related__article_id__get",
    (
        "/api/similarity/search-suggestions",
        "get",
    ): "get_search_suggestions_api_similarity_search_suggestions_get",
    (
        "/api/similarity/source-coverage",
        "get",
    ): "get_source_coverage_api_similarity_source_coverage_get",
    (
        "/api/similarity/novelty-score",
        "post",
    ): "compute_novelty_score_api_similarity_novelty_score_post",
    (
        "/api/similarity/article-topics/{article_id}",
        "get",
    ): "get_article_topics_api_similarity_article_topics__article_id__get",
    (
        "/api/similarity/bulk-article-topics",
        "post",
    ): "get_bulk_article_topics_api_similarity_bulk_article_topics_post",
}


def _json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def test_public_b11_openapi_contract_is_unchanged() -> None:
    paths = _json(OPENAPI_PATH)["paths"]
    expected_responses = {
        ("/trending", "get"): {"200", "422"},
        ("/trending/breaking", "get"): {"200", "422"},
        ("/trending/clusters", "get"): {"200", "422"},
        ("/trending/clusters/{cluster_id}", "get"): {"200", "422"},
        ("/trending/clusters/{cluster_id}/contradictions", "get"): {"200", "422"},
        ("/trending/clusters/{cluster_id}/lineage", "get"): {"200", "422"},
        ("/trending/stats", "get"): {"200"},
        ("/api/similarity/related/{article_id}", "get"): {"200", "422"},
        ("/api/similarity/search-suggestions", "get"): {"200", "422"},
        ("/api/similarity/source-coverage", "get"): {"200", "422"},
        ("/api/similarity/novelty-score", "post"): {"200", "422"},
        ("/api/similarity/article-topics/{article_id}", "get"): {"200", "422"},
        ("/api/similarity/bulk-article-topics", "post"): {"200", "422"},
    }
    for (path, method), operation_id in B11_OPERATIONS.items():
        operation = paths[path][method]
        assert operation["operationId"] == operation_id
        assert "security" not in operation
        assert set(operation["responses"]) == expected_responses[(path, method)]


def test_public_b11_query_and_body_bounds_are_preserved() -> None:
    paths = _json(OPENAPI_PATH)["paths"]
    trending = paths["/trending"]["get"]["parameters"]
    assert trending[0]["schema"] == {
        "type": "string",
        "pattern": "^(1d|1w|1m)$",
        "default": "1d",
        "title": "Window",
    }
    assert trending[1]["schema"]["minimum"] == 1
    assert trending[1]["schema"]["maximum"] == 50

    breaking_limit = paths["/trending/breaking"]["get"]["parameters"][0]["schema"]
    assert breaking_limit["minimum"] == 1
    assert breaking_limit["maximum"] == 20

    related = paths["/api/similarity/related/{article_id}"]["get"]["parameters"]
    assert related[0]["in"] == "path"
    assert related[0]["schema"]["type"] == "integer"
    assert related[1]["schema"]["maximum"] == 20
    assert related[1]["schema"]["default"] == 5
    assert related[2]["schema"]["default"] is True

    suggestions = paths["/api/similarity/search-suggestions"]["get"]["parameters"]
    assert suggestions[0]["schema"]["minLength"] == 2
    assert suggestions[1]["schema"]["maximum"] == 10

    coverage = paths["/api/similarity/source-coverage"]["get"]["parameters"]
    assert coverage[0]["required"] is True
    assert coverage[1]["schema"]["maximum"] == 500
    assert coverage[1]["schema"]["default"] == 100

    novelty = paths["/api/similarity/novelty-score"]["post"]
    assert novelty["parameters"][0]["name"] == "article_id"
    assert novelty["requestBody"]["required"] is True
    assert novelty["requestBody"]["content"]["application/json"]["schema"] == {
        "type": "array",
        "items": {"type": "integer"},
        "title": "Reading History",
    }

    bulk = paths["/api/similarity/bulk-article-topics"]["post"]["requestBody"]
    assert bulk["required"] is True
    assert bulk["content"]["application/json"]["schema"] == {
        "items": {"type": "integer"},
        "type": "array",
        "title": "Article Ids",
    }

