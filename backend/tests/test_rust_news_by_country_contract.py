"""Offline compatibility contracts for the Rust country-browse migration."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from httpx import AsyncClient


_REPO_ROOT = Path(__file__).resolve().parents[2]
_INVENTORY_PATH = _REPO_ROOT / "docs/agents/rust-openapi-operation-inventory.json"
_COUNTRY_OPERATIONS = {
    "get_countries_geo_data_route_news_countries_geo_get": "/news/countries/geo",
    "get_article_counts_by_country_news_by_country_get": "/news/by-country",
    "get_news_for_country_news_country__code__get": "/news/country/{code}",
    "list_available_countries_news_countries_list_get": "/news/countries/list",
}


@pytest.fixture(scope="module")
def country_operation_inventory() -> list[dict[str, object]]:
    inventory = json.loads(_INVENTORY_PATH.read_text(encoding="utf-8"))
    return [
        operation
        for operation in inventory["operations"]
        if operation["operation_id"] in _COUNTRY_OPERATIONS
    ]


def test_country_operations_keep_exact_openapi_ids_and_paths(
    country_operation_inventory: list[dict[str, object]],
) -> None:
    observed = {
        operation["operation_id"]: operation["path"]
        for operation in country_operation_inventory
    }
    assert observed == _COUNTRY_OPERATIONS


@pytest.mark.asyncio
async def test_geo_endpoint_is_static_and_provider_free(client: AsyncClient) -> None:
    response = await client.get("/news/countries/geo")

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == len(payload["countries"])
    assert payload["countries"]["US"] == {
        "name": "United States",
        "lat": 37.09,
        "lng": -95.71,
    }


@pytest.mark.asyncio
async def test_persisted_country_counts_keep_mention_and_origin_signals(
    client: AsyncClient,
) -> None:
    response = await client.get("/news/by-country?hours=720")

    assert response.status_code == 200
    payload = response.json()
    assert payload["counts"] == {"CN": 3, "US": 2}
    assert payload["source_counts"] == {"US": 2, "GB": 1, "DE": 1}
    assert payload["total_articles"] == 4
    assert payload["articles_with_country"] == 4
    assert payload["articles_without_country"] == 0
    assert payload["window_hours"] == 720
    assert [signal["id"] for signal in payload["geo_signals"]] == [
        "country_mentions",
        "source_origin",
    ]


@pytest.mark.asyncio
async def test_country_lens_preserves_internal_external_and_fallback_contracts(
    client: AsyncClient,
) -> None:
    internal = await client.get("/news/country/US?view=internal&limit=10&hours=720")
    external = await client.get("/news/country/CN?view=external&limit=10&hours=720")
    fallback = await client.get("/news/country/GB?view=internal&limit=10&hours=720")

    assert internal.status_code == external.status_code == fallback.status_code == 200

    internal_payload = internal.json()
    assert internal_payload["matching_strategy"] == "country_mentions"
    assert {article["id"] for article in internal_payload["articles"]} == {1, 2}
    assert all(article["source_country"] == "US" for article in internal_payload["articles"])

    external_payload = external.json()
    assert external_payload["matching_strategy"] == "country_mentions"
    assert {article["id"] for article in external_payload["articles"]} == {2, 3, 4}
    assert all(article["source_country"] != "CN" for article in external_payload["articles"])
    assert all("CN" in article["mentioned_countries"] for article in external_payload["articles"])

    fallback_payload = fallback.json()
    assert fallback_payload["matching_strategy"] == "source_origin_fallback"
    assert fallback_payload["geo_signal"] == {
        "id": "source_origin",
        "label": "Source origin",
    }
    assert [article["id"] for article in fallback_payload["articles"]] == [3]


@pytest.mark.asyncio
async def test_country_list_is_derived_from_persisted_rows(client: AsyncClient) -> None:
    response = await client.get("/news/countries/list")

    assert response.status_code == 200
    payload = response.json()
    assert payload["total_countries"] == 3
    assert sorted((row["code"], row["article_count"]) for row in payload["countries"]) == [
        ("DE", 1),
        ("GB", 1),
        ("US", 2),
    ]
    assert all(row["latest_article"] for row in payload["countries"])
