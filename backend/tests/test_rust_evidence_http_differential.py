from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import signal
import socket
import subprocess
import tempfile
import uuid
from collections.abc import AsyncIterator
from dataclasses import replace
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, BinaryIO, cast

import httpx
import pytest
from fastapi import APIRouter, FastAPI
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import get_db

ROOT = Path(__file__).resolve().parents[2]
ENDPOINT = "/api/wiki/evidence/claims/evaluate"
POLICIES_ENDPOINT = "/api/wiki/evidence/policies"
CLAIM_ENDPOINT = "/api/wiki/evidence/claims/{}"
RELATIONSHIPS_ENDPOINT = "/api/wiki/evidence/relationships"
INTEREST_ENDPOINT = "/api/wiki/evidence/interest"
RANK_ENDPOINT = "/news/ranked"


def _free_port() -> int:
    with socket.socket() as server_socket:
        server_socket.bind(("127.0.0.1", 0))
        return int(server_socket.getsockname()[1])


def _async_database_url(database_url: str) -> str:
    return database_url.replace("postgresql://", "postgresql+asyncpg://", 1)


def _python_evidence_app() -> FastAPI:
    route_path = ROOT / "backend/app/api/routes/wiki_evidence.py"
    spec = importlib.util.spec_from_file_location("thesis_evidence_reference", route_path)
    if spec is None or spec.loader is None:
        raise AssertionError(f"could not load the existing evidence router at {route_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    python_app = FastAPI()
    python_app.include_router(cast(APIRouter, getattr(module, "router")))
    return python_app


def _python_news_app() -> FastAPI:
    from app.api.routes.news import router

    python_app = FastAPI()
    python_app.include_router(router)
    return python_app


def _python_comparison_app() -> FastAPI:
    from app.api.routes.comparison import router

    python_app = FastAPI()
    python_app.include_router(router)
    return python_app


def _python_debug_app() -> FastAPI:
    from app.api.routes.debug import router

    python_app = FastAPI()
    python_app.include_router(router)
    return python_app


def _python_wiki_app() -> FastAPI:
    from app.api.routes.wiki import router

    python_app = FastAPI()
    python_app.include_router(router)
    return python_app


def _sort_entity_categories(categories: dict[str, list[str]]) -> None:
    for entities in categories.values():
        entities.sort(key=str.casefold)


def _canonicalize_comparison(value: dict[str, Any]) -> dict[str, Any]:
    entities = value["entities"]
    _sort_entity_categories(entities["source_1"])
    _sort_entity_categories(entities["source_2"])
    for category in entities["comparison"].values():
        _sort_entity_categories(category)

    keywords = value["keywords"]["comparison"]
    for group in ("common_keywords", "unique_to_source_1", "unique_to_source_2"):
        keywords[group].sort(key=lambda item: item["keyword"])
    return value


def _canonicalize_claim_record(value: dict[str, Any]) -> dict[str, Any]:
    return {**value, "evidence": sorted(value["evidence"], key=lambda item: item["id"])}


async def _compare_relationship_http_cases(
    python_client: httpx.AsyncClient,
    rust_client: httpx.AsyncClient,
    entity_ids: list[str],
    claim_ids: list[str],
    relationship_ids: list[str],
) -> None:
    as_of = "2025-01-01T00:00:00"
    relationship_params = {"as_of": as_of, "known_at": as_of}
    python_response = await python_client.get(RELATIONSHIPS_ENDPOINT, params=relationship_params)
    rust_response = await rust_client.get(RELATIONSHIPS_ENDPOINT, params=relationship_params)
    assert rust_response.status_code == python_response.status_code == 200
    assert rust_response.json() == python_response.json()
    relationships = rust_response.json()["relationships"]
    assert [record["id"] for record in relationships] == [
        relationship_ids[1],
        relationship_ids[0],
    ]
    assert relationships[1]["claim_ids"] == sorted([claim_ids[0], claim_ids[2]])
    assert [record["evidence_root_count"] for record in relationships] == [1, 3]

    params = {**relationship_params, "predicates": " controls, , owns_equity_in "}
    python_response = await python_client.get(RELATIONSHIPS_ENDPOINT, params=params)
    rust_response = await rust_client.get(RELATIONSHIPS_ENDPOINT, params=params)
    assert rust_response.status_code == python_response.status_code == 200
    assert rust_response.json() == python_response.json()
    assert [record["id"] for record in rust_response.json()["relationships"]] == [
        relationship_ids[1],
        relationship_ids[0],
    ]

    params = {**relationship_params, "entity_id": entity_ids[0]}
    python_response = await python_client.get(RELATIONSHIPS_ENDPOINT, params=params)
    rust_response = await rust_client.get(RELATIONSHIPS_ENDPOINT, params=params)
    assert rust_response.status_code == python_response.status_code == 200
    assert rust_response.json() == python_response.json()
    matched = rust_response.json()["relationships"]
    assert [(row["subject_entity_id"], row["object_entity_id"]) for row in matched] == [
        (entity_ids[1], entity_ids[0]),
        (entity_ids[0], entity_ids[1]),
    ]

    invalid_queries = (
        {**relationship_params, "predicates": "x" * 501},
        {**relationship_params, "entity_id": "x" * 129},
        {"as_of": "not-a-timestamp", "known_at": as_of},
    )
    for params in invalid_queries:
        python_response = await python_client.get(RELATIONSHIPS_ENDPOINT, params=params)
        rust_response = await rust_client.get(RELATIONSHIPS_ENDPOINT, params=params)
        assert rust_response.status_code == python_response.status_code == 422
        python_detail = python_response.json()["detail"][0]
        rust_detail = rust_response.json()["detail"][0]
        assert rust_detail["loc"] == python_detail["loc"]
        assert rust_detail["type"] == python_detail["type"]

    known_at = "2025-01-03T00:00:00"
    params = {"as_of": as_of, "known_at": known_at}
    python_response = await python_client.get(RELATIONSHIPS_ENDPOINT, params=params)
    rust_response = await rust_client.get(RELATIONSHIPS_ENDPOINT, params=params)
    assert rust_response.status_code == python_response.status_code == 200
    assert rust_response.json() == python_response.json()
    relationships = rust_response.json()["relationships"]
    assert [record["id"] for record in relationships] == [
        relationship_ids[1],
        relationship_ids[3],
    ]
    assert relationships[0]["status"] == "historical"


async def _compare_interest_http_cases(
    python_client: httpx.AsyncClient,
    rust_client: httpx.AsyncClient,
    interest_ids: dict[str, str],
) -> None:
    async def compare(params: dict[str, str]) -> dict[str, Any]:
        python_response = await python_client.get(INTEREST_ENDPOINT, params=params)
        rust_response = await rust_client.get(INTEREST_ENDPOINT, params=params)
        assert rust_response.status_code == python_response.status_code == 200
        assert rust_response.json() == python_response.json()
        return rust_response.json()

    chain = await compare(
        {
            "owner_id": interest_ids["chain_owner"],
            "target_id": interest_ids["chain_target"],
            "security_class": "chain",
        }
    )
    assert chain["aggregate"] == {"lower": 30.0, "upper": 30.0}
    assert chain["owner_id"] == interest_ids["chain_owner"]
    assert chain["target_id"] == interest_ids["chain_target"]
    assert chain["interest_type"] == "economic"
    assert chain["security_class"] == "chain"
    assert chain["algorithm_version"] == "ownership-math/2.0"
    assert chain["paths"] == [
        {
            "entity_ids": [
                interest_ids["chain_owner"],
                interest_ids["chain_mid"],
                interest_ids["chain_target"],
            ],
            "claim_ids": [
                interest_ids["chain_first"],
                interest_ids["chain_second"],
            ],
            "interest": {"lower": 30.0, "upper": 30.0},
            "disjoint_group": None,
        }
    ]

    economic_common = await compare(
        {
            "owner_id": interest_ids["filter_owner"],
            "target_id": interest_ids["filter_target"],
            "security_class": "common",
        }
    )
    assert economic_common["aggregate"] == {"lower": 40.0, "upper": 40.0}
    assert economic_common["paths"][0]["claim_ids"] == [interest_ids["filter_economic_common"]]

    voting_common = await compare(
        {
            "owner_id": interest_ids["filter_owner"],
            "target_id": interest_ids["filter_target"],
            "interest_type": "voting",
            "security_class": "common",
        }
    )
    assert voting_common["aggregate"] == {"lower": 70.0, "upper": 70.0}
    assert voting_common["paths"][0]["claim_ids"] == [interest_ids["filter_voting_common"]]

    preferred = await compare(
        {
            "owner_id": interest_ids["filter_owner"],
            "target_id": interest_ids["filter_target"],
            "security_class": "preferred",
        }
    )
    assert preferred["interest_type"] == "economic"
    assert preferred["aggregate"] == {"lower": 20.0, "upper": 20.0}
    assert preferred["paths"][0]["claim_ids"] == [interest_ids["filter_economic_preferred"]]

    cycle = await compare(
        {
            "owner_id": interest_ids["cycle_owner"],
            "target_id": interest_ids["cycle_target"],
            "security_class": "cycle",
        }
    )
    assert cycle["aggregate"] is None
    assert cycle["paths"] == []
    assert cycle["possibly_overlapping"] is False
    assert cycle["cross_holding_unresolved"] is True

    overlap = await compare(
        {
            "owner_id": interest_ids["overlap_owner"],
            "target_id": interest_ids["overlap_target"],
            "security_class": "overlap",
        }
    )
    assert overlap["aggregate"] is None
    assert overlap["possibly_overlapping"] is True
    assert overlap["cross_holding_unresolved"] is False
    assert len(overlap["paths"]) == 2

    disjoint = await compare(
        {
            "owner_id": interest_ids["disjoint_owner"],
            "target_id": interest_ids["disjoint_target"],
            "security_class": "disjoint",
        }
    )
    assert disjoint["aggregate"] == {"lower": 50.0, "upper": 50.0}
    assert disjoint["possibly_overlapping"] is False
    assert disjoint["cross_holding_unresolved"] is False
    assert {path["disjoint_group"] for path in disjoint["paths"]} == {
        "disjoint-a",
        "disjoint-b",
    }

    arbitrary_interest_type = "x" * 32
    arbitrary = await compare(
        {
            "owner_id": interest_ids["filter_owner"],
            "target_id": interest_ids["filter_target"],
            "interest_type": arbitrary_interest_type,
        }
    )
    assert arbitrary["interest_type"] == arbitrary_interest_type
    assert arbitrary["aggregate"] is None
    assert arbitrary["paths"] == []
    assert arbitrary["possibly_overlapping"] is False
    assert arbitrary["cross_holding_unresolved"] is False

    invalid_queries = (
        {"target_id": interest_ids["filter_target"]},
        {"owner_id": interest_ids["filter_owner"]},
        {
            "owner_id": "x" * 129,
            "target_id": interest_ids["filter_target"],
        },
        {
            "owner_id": interest_ids["filter_owner"],
            "target_id": "x" * 129,
        },
        {
            "owner_id": interest_ids["filter_owner"],
            "target_id": interest_ids["filter_target"],
            "interest_type": "x" * 33,
        },
        {
            "owner_id": interest_ids["filter_owner"],
            "target_id": interest_ids["filter_target"],
            "security_class": "x" * 65,
        },
    )
    for params in invalid_queries:
        python_response = await python_client.get(INTEREST_ENDPOINT, params=params)
        rust_response = await rust_client.get(INTEREST_ENDPOINT, params=params)
        assert rust_response.status_code == python_response.status_code == 422
        assert rust_response.json() == python_response.json()


async def _seed_relationships(
    connection: Any,
    prefix: str,
    entity_ids: list[str],
    claim_ids: list[str],
    relationship_ids: list[str],
    as_of: datetime,
    fixture_time: datetime,
) -> None:
    specs = (
        (
            "owns_equity_in",
            entity_ids[0],
            entity_ids[1],
            as_of,
            as_of,
            as_of,
            as_of + timedelta(seconds=1),
            "accepted",
            "current",
        ),
        (
            "controls",
            entity_ids[1],
            entity_ids[0],
            None,
            None,
            as_of,
            None,
            "historical",
            "proposed",
        ),
        (
            "owns_equity_in",
            entity_ids[0],
            entity_ids[1],
            None,
            None,
            as_of,
            as_of,
            "accepted",
            "current",
        ),
        (
            "owns_equity_in",
            entity_ids[0],
            entity_ids[1],
            as_of,
            as_of,
            as_of + timedelta(days=1),
            None,
            "accepted",
            "current",
        ),
        (
            "owns_equity_in",
            entity_ids[0],
            entity_ids[1],
            as_of + timedelta(days=2),
            None,
            as_of + timedelta(days=2),
            None,
            "accepted",
            "current",
        ),
    )
    names = (
        "inclusive_bounds",
        "reverse_direction",
        "retracted_at_bound",
        "recorded_after_as_of",
        "valid_after_as_of",
    )
    for name, relationship_id, spec in zip(names, relationship_ids, specs, strict=True):
        (
            predicate,
            subject_id,
            object_id,
            valid_from,
            valid_to,
            recorded_at,
            retracted_at,
            status,
            lifecycle_state,
        ) = spec
        await connection.exec_driver_sql(
            "INSERT INTO accepted_relationships "
            "(id, subject_entity_id, predicate, object_entity_id, qualifiers, valid_from, valid_to, "
            "recorded_at, retracted_at, materialized_at, materialized_by, "
            "acceptance_policy_version, status, lifecycle_state, relationship_hash) "
            "VALUES ($1, $2, $3, $4, '{}'::json, $5, $6, $7, $8, $7, 'fixture', "
            "'test-policy', $9, $10, $11)",
            (
                relationship_id,
                subject_id,
                predicate,
                object_id,
                valid_from,
                valid_to,
                recorded_at,
                retracted_at,
                status,
                lifecycle_state,
                f"{prefix}-{name}-relationship-hash",
            ),
        )

    for relationship_id, claim_id in (
        (relationship_ids[0], claim_ids[0]),
        (relationship_ids[0], claim_ids[2]),
        (relationship_ids[1], claim_ids[1]),
        (relationship_ids[3], claim_ids[0]),
        (relationship_ids[3], claim_ids[2]),
    ):
        await connection.exec_driver_sql(
            "INSERT INTO relationship_claim_links "
            "(relationship_id, claim_id, derivation_role, added_at) "
            "VALUES ($1, $2, 'supporting', $3)",
            (relationship_id, claim_id, fixture_time),
        )


async def _seed_claims(
    connection: Any,
    prefix: str,
    entity_id: str,
    claim_ids: list[str],
    observation_ids: list[str],
    fixture_time: datetime,
) -> None:
    for name, claim_id in zip(("direct", "catalog", "control"), claim_ids, strict=True):
        predicate = "ultimate_control" if name == "control" else "directly_owns"
        await connection.exec_driver_sql(
            "INSERT INTO evidence_claims "
            "(id, subject_entity_id, predicate, object_value, qualifiers, asserted_by, "
            "evidence_class, status, method_version, claim_hash, recorded_at) "
            "VALUES ($1, $2, $3, '{\"fixture\":true}'::json, '{}'::json, 'test', "
            "'registry_filing', 'candidate', 'test-1', $4, $5)",
            (claim_id, entity_id, predicate, f"{prefix}-{name}-claim-hash", fixture_time),
        )

    observation_links = {
        claim_ids[0]: observation_ids,
        claim_ids[1]: [observation_ids[3]],
        claim_ids[2]: [observation_ids[0]],
    }
    for claim_id, linked_observations in observation_links.items():
        for observation_id in linked_observations:
            await connection.exec_driver_sql(
                "INSERT INTO claim_evidence_links "
                "(claim_id, observation_id, role, created_at) "
                "VALUES ($1, $2, 'supporting', $3)",
                (claim_id, observation_id, fixture_time),
            )


async def _compare_article_http_cases(
    python_client: httpx.AsyncClient,
    rust_client: httpx.AsyncClient,
) -> None:
    cases = (
        {
            "content_1": (
                "Dr. Ada Lovelace met Mayor Grace Hopper in Paris on "
                "January 2, 2025. Officials said the bridge opened today."
            ),
            "content_2": (
                "Dr. Ada Lovelace met Governor Grace Hopper in Paris on "
                "January 3, 2025. Officials said the bridge remained closed today."
            ),
            "title_1": "The bridge opens in Paris",
            "title_2": "Paris bridge remains closed",
        },
        {
            "content_1": "First article has climate policy and reporting.",
            "content_2": "Second article has climate news and reporting.",
            "ignored_extra_field": "FastAPI ignores extra request fields",
        },
        {"content_1": "", "content_2": ""},
    )
    for request in cases:
        python_response = await python_client.post("/compare/articles", json=request)
        rust_response = await rust_client.post("/compare/articles", json=request)
        assert rust_response.status_code == python_response.status_code
        assert _canonicalize_comparison(rust_response.json()) == (
            _canonicalize_comparison(python_response.json())
        )

    for raw_body in (b"{", b'{"content_1":'):
        headers = {"content-type": "application/json"}
        python_response = await python_client.post(
            "/compare/articles", content=raw_body, headers=headers
        )
        rust_response = await rust_client.post(
            "/compare/articles", content=raw_body, headers=headers
        )
        assert rust_response.status_code == python_response.status_code
        assert rust_response.status_code == 422
        for response in (python_response, rust_response):
            error = response.json()["detail"][0]
            assert error["type"] == "json_invalid"
            assert error["loc"][0] == "body"

    invalid_cases = (
        {"content_2": "article"},
        {"content_1": 12, "content_2": "article"},
        {"content_1": "article", "content_2": None},
        {"content_1": "article", "content_2": "body", "title_1": None},
    )
    for request in invalid_cases:
        python_response = await python_client.post("/compare/articles", json=request)
        rust_response = await rust_client.post("/compare/articles", json=request)
        assert rust_response.status_code == python_response.status_code
        assert rust_response.json() == python_response.json()


async def _seed_ownership_interest(
    connection: Any,
    prefix: str,
    entity_ids: list[str],
    relationship_ids: list[str],
    fixture_time: datetime,
) -> dict[str, str]:
    entity_names = (
        "chain_owner",
        "chain_mid",
        "chain_target",
        "filter_owner",
        "filter_target",
        "cycle_owner",
        "cycle_mid",
        "cycle_target",
        "overlap_owner",
        "overlap_left",
        "overlap_right",
        "overlap_target",
        "disjoint_owner",
        "disjoint_left",
        "disjoint_right",
        "disjoint_target",
    )
    ids = {name: f"it-interest-entity-{prefix}-{name}" for name in entity_names}
    for name in entity_names:
        entity_ids.append(ids[name])
        await connection.exec_driver_sql(
            "INSERT INTO evidence_entities "
            "(id, record_kind, entity_kind, canonical_name, status, privacy_scope, "
            "created_at, updated_at) "
            "VALUES ($1, 'legal_entity', 'legal_entity', $2, 'candidate', 'public', $3, $3)",
            (ids[name], f"Ownership interest fixture {name}", fixture_time),
        )

    relationship_names = (
        "chain_first",
        "chain_second",
        "filter_economic_common",
        "filter_economic_preferred",
        "filter_voting_common",
        "filter_retracted",
        "filter_unquantified",
        "filter_non_interest",
        "cycle_owner_mid",
        "cycle_mid_owner",
        "cycle_mid_target",
        "overlap_owner_left",
        "overlap_left_target",
        "overlap_owner_right",
        "overlap_right_target",
        "disjoint_owner_left",
        "disjoint_left_target",
        "disjoint_owner_right",
        "disjoint_right_target",
    )
    relationship_id_by_name = {
        name: f"it-interest-rel-{prefix}-{name}" for name in relationship_names
    }
    relationship_ids.extend(relationship_id_by_name.values())
    ids.update(relationship_id_by_name)

    def qualifiers(
        pct: int | None,
        *,
        interest: str,
        security_class: str,
        disjoint_group: str | None = None,
    ) -> dict[str, object]:
        value: dict[str, object] = {
            "interest": interest,
            "security_class": security_class,
            "direct": True,
        }
        if pct is not None:
            value["pct"] = pct
        if disjoint_group is not None:
            value["disjoint_group"] = disjoint_group
        return value

    future_recorded_at = datetime(2030, 1, 1)
    specs = (
        (
            "chain_first",
            "owns_equity_in",
            "chain_mid",
            "chain_owner",
            qualifiers(50, interest="economic", security_class="chain"),
            datetime(2020, 1, 1),
            datetime(2020, 12, 31),
            None,
            "historical",
            "historical",
        ),
        (
            "chain_second",
            "directly_owns",
            "chain_target",
            "chain_mid",
            qualifiers(60, interest="economic", security_class="chain"),
            None,
            None,
            None,
            "accepted",
            "proposed",
        ),
        (
            "filter_economic_common",
            "owns_equity_in",
            "filter_target",
            "filter_owner",
            qualifiers(40, interest="economic", security_class="common"),
            None,
            None,
            None,
            "accepted",
            "current",
        ),
        (
            "filter_economic_preferred",
            "directly_owns",
            "filter_target",
            "filter_owner",
            qualifiers(20, interest="economic", security_class="preferred"),
            None,
            None,
            None,
            "accepted",
            "current",
        ),
        (
            "filter_voting_common",
            "directly_owns",
            "filter_target",
            "filter_owner",
            qualifiers(70, interest="voting", security_class="common"),
            None,
            None,
            None,
            "accepted",
            "current",
        ),
        (
            "filter_retracted",
            "owns_equity_in",
            "filter_target",
            "filter_owner",
            qualifiers(99, interest="economic", security_class="common"),
            None,
            None,
            fixture_time,
            "accepted",
            "current",
        ),
        (
            "filter_unquantified",
            "owns_equity_in",
            "filter_target",
            "filter_owner",
            qualifiers(None, interest="economic", security_class="common"),
            None,
            None,
            None,
            "accepted",
            "current",
        ),
        (
            "filter_non_interest",
            "controls",
            "filter_target",
            "filter_owner",
            qualifiers(88, interest="economic", security_class="common"),
            None,
            None,
            None,
            "accepted",
            "current",
        ),
        (
            "cycle_owner_mid",
            "owns_equity_in",
            "cycle_mid",
            "cycle_owner",
            qualifiers(50, interest="economic", security_class="cycle"),
            None,
            None,
            None,
            "accepted",
            "current",
        ),
        (
            "cycle_mid_owner",
            "owns_equity_in",
            "cycle_owner",
            "cycle_mid",
            qualifiers(10, interest="economic", security_class="cycle"),
            None,
            None,
            None,
            "accepted",
            "current",
        ),
        (
            "cycle_mid_target",
            "directly_owns",
            "cycle_target",
            "cycle_mid",
            qualifiers(60, interest="economic", security_class="cycle"),
            None,
            None,
            None,
            "accepted",
            "current",
        ),
        (
            "overlap_owner_left",
            "owns_equity_in",
            "overlap_left",
            "overlap_owner",
            qualifiers(50, interest="economic", security_class="overlap"),
            None,
            None,
            None,
            "accepted",
            "current",
        ),
        (
            "overlap_left_target",
            "owns_equity_in",
            "overlap_target",
            "overlap_left",
            qualifiers(50, interest="economic", security_class="overlap"),
            None,
            None,
            None,
            "accepted",
            "current",
        ),
        (
            "overlap_owner_right",
            "owns_equity_in",
            "overlap_right",
            "overlap_owner",
            qualifiers(50, interest="economic", security_class="overlap"),
            None,
            None,
            None,
            "accepted",
            "current",
        ),
        (
            "overlap_right_target",
            "owns_equity_in",
            "overlap_target",
            "overlap_right",
            qualifiers(50, interest="economic", security_class="overlap"),
            None,
            None,
            None,
            "accepted",
            "current",
        ),
        (
            "disjoint_owner_left",
            "owns_equity_in",
            "disjoint_left",
            "disjoint_owner",
            qualifiers(
                50,
                interest="economic",
                security_class="disjoint",
                disjoint_group="disjoint-a",
            ),
            None,
            None,
            None,
            "accepted",
            "current",
        ),
        (
            "disjoint_left_target",
            "owns_equity_in",
            "disjoint_target",
            "disjoint_left",
            qualifiers(
                50,
                interest="economic",
                security_class="disjoint",
                disjoint_group="disjoint-a",
            ),
            None,
            None,
            None,
            "accepted",
            "current",
        ),
        (
            "disjoint_owner_right",
            "owns_equity_in",
            "disjoint_right",
            "disjoint_owner",
            qualifiers(
                50,
                interest="economic",
                security_class="disjoint",
                disjoint_group="disjoint-b",
            ),
            None,
            None,
            None,
            "accepted",
            "current",
        ),
        (
            "disjoint_right_target",
            "owns_equity_in",
            "disjoint_target",
            "disjoint_right",
            qualifiers(
                50,
                interest="economic",
                security_class="disjoint",
                disjoint_group="disjoint-b",
            ),
            None,
            None,
            None,
            "accepted",
            "current",
        ),
    )
    for (
        name,
        predicate,
        subject_name,
        object_name,
        relationship_qualifiers,
        valid_from,
        valid_to,
        retracted_at,
        status,
        lifecycle_state,
    ) in specs:
        await connection.exec_driver_sql(
            "INSERT INTO accepted_relationships "
            "(id, subject_entity_id, predicate, object_entity_id, qualifiers, valid_from, valid_to, "
            "recorded_at, retracted_at, materialized_at, materialized_by, "
            "acceptance_policy_version, status, lifecycle_state, relationship_hash) "
            "VALUES ($1, $2, $3, $4, $5::json, $6, $7, $8, $9, $8, 'fixture', "
            "'test-policy', $10, $11, $12)",
            (
                relationship_id_by_name[name],
                ids[subject_name],
                predicate,
                ids[object_name],
                json.dumps(relationship_qualifiers, separators=(",", ":")),
                valid_from,
                valid_to,
                future_recorded_at,
                retracted_at,
                status,
                lifecycle_state,
                f"{prefix}-interest-{name}-hash",
            ),
        )
    return ids


async def _seed_evidence(
    database_url: str,
) -> tuple[list[str], list[str], list[str], list[str], dict[str, str]]:
    prefix = uuid.uuid4().hex[:12]
    claim_ids = [f"it-claim-{prefix}-{name}" for name in ("direct", "catalog", "control")]
    entity_ids = [f"it-entity-{prefix}-{name}" for name in ("a", "b")]
    document_names = ("root", "copy", "other", "catalog")
    document_ids = [f"it-doc-{prefix}-{name}" for name in document_names]
    observation_ids = [f"it-obs-{prefix}-{name}" for name in document_names]
    relationship_names = (
        "inclusive_bounds",
        "reverse_direction",
        "retracted_at_bound",
        "recorded_after_as_of",
        "valid_after_as_of",
    )
    relationship_ids = [f"it-rel-{prefix}-{name}" for name in relationship_names]
    fixture_time = datetime(2024, 12, 31)
    as_of = datetime(2025, 1, 1)
    engine = create_async_engine(_async_database_url(database_url))
    try:
        async with engine.begin() as connection:
            for suffix, entity_id in zip(("A", "B"), entity_ids, strict=True):
                await connection.exec_driver_sql(
                    "INSERT INTO evidence_entities "
                    "(id, record_kind, entity_kind, canonical_name, status, privacy_scope, created_at, updated_at) "
                    "VALUES ($1, 'legal_entity', 'legal_entity', $2, 'candidate', 'public', $3, $3)",
                    (entity_id, f"Rust differential fixture {suffix}", fixture_time),
                )
            for name, document_id in zip(document_names, document_ids, strict=True):
                await connection.exec_driver_sql(
                    "INSERT INTO evidence_documents "
                    "(id, source_url, document_type, source_class, created_at) "
                    "VALUES ($1, $2, 'filing', $3, $4)",
                    (
                        document_id,
                        f"https://test.invalid/{prefix}/{name}",
                        "third_party_assessment" if name == "catalog" else "registry_filing",
                        fixture_time,
                    ),
                )
                await connection.exec_driver_sql(
                    "INSERT INTO document_snapshots "
                    "(id, document_id, sha256_raw, storage_path, retrieved_at, retriever, "
                    "retriever_version, response_headers, created_at) "
                    "VALUES ($1, $2, $3, $4, $5, 'test', '1', '{}'::json, $5)",
                    (
                        f"it-snapshot-{prefix}-{name}",
                        document_id,
                        f"{prefix}-{name}-sha256",
                        f"/tmp/{prefix}/{name}",
                        fixture_time,
                    ),
                )
                await connection.exec_driver_sql(
                    "INSERT INTO evidence_observations "
                    "(id, snapshot_id, locator, quoted_text, extractor, extractor_version, "
                    "entailment, reviewed_by, created_at) "
                    "VALUES ($1, $2, '{}'::json, 'Reviewed fixture evidence', 'test', '1', "
                    "'reviewed_yes', 'reviewer', $3)",
                    (
                        observation_ids[document_names.index(name)],
                        f"it-snapshot-{prefix}-{name}",
                        fixture_time,
                    ),
                )

            await _seed_claims(
                connection,
                prefix,
                entity_ids[0],
                claim_ids,
                observation_ids,
                fixture_time,
            )
            await connection.exec_driver_sql(
                "INSERT INTO source_lineage "
                "(parent_document_id, child_document_id, relation, created_at) "
                "VALUES ($1, $2, 'mirror', $3)",
                (document_ids[0], document_ids[1], fixture_time),
            )
            await _seed_relationships(
                connection,
                prefix,
                entity_ids,
                claim_ids,
                relationship_ids,
                as_of,
                fixture_time,
            )
            interest_ids = await _seed_ownership_interest(
                connection,
                prefix,
                entity_ids,
                relationship_ids,
                fixture_time,
            )
    finally:
        await engine.dispose()
    return entity_ids, document_ids, claim_ids, relationship_ids, interest_ids


async def _delete_evidence(
    database_url: str,
    entity_ids: list[str],
    document_ids: list[str],
    relationship_ids: list[str],
) -> None:
    engine = create_async_engine(_async_database_url(database_url))
    try:
        async with engine.begin() as connection:
            await connection.exec_driver_sql(
                "DELETE FROM accepted_relationships WHERE id = ANY($1::varchar[])",
                (relationship_ids,),
            )
            await connection.exec_driver_sql(
                "DELETE FROM evidence_entities WHERE id = ANY($1::varchar[])", (entity_ids,)
            )
            await connection.exec_driver_sql(
                "DELETE FROM evidence_documents WHERE id = ANY($1::varchar[])",
                (document_ids,),
            )
    finally:
        await engine.dispose()


def _start_rust_service(
    database_url: str, *, enable_database: bool | None = None
) -> tuple[subprocess.Popen[bytes], str, BinaryIO]:
    binary = ROOT / "backend/target/debug/thesis-server"
    if not binary.is_file():
        raise AssertionError("build backend/crates/thesis-server before the HTTP differential test")
    port = _free_port()
    base_url = f"http://127.0.0.1:{port}"
    log = tempfile.TemporaryFile()
    environment = os.environ | {
        "THESIS_DATABASE_URL": database_url,
        "THESIS_RUST_BIND": f"127.0.0.1:{port}",
        "RUST_LOG": "error",
    }
    if enable_database is not None:
        environment["ENABLE_DATABASE"] = "1" if enable_database else "0"
    process = subprocess.Popen(
        [str(binary)],
        cwd=ROOT,
        env=environment,
        stdout=log,
        stderr=subprocess.STDOUT,
    )
    return process, base_url, log


async def _wait_for_rust_service(
    process: subprocess.Popen[bytes], base_url: str, log: BinaryIO
) -> None:
    async with httpx.AsyncClient() as client:
        for _ in range(100):
            if process.poll() is not None:
                log.seek(0)
                pytest.fail(f"Rust server exited during startup:\n{log.read().decode()}")
            try:
                response = await client.get(f"{base_url}/openapi.json", timeout=0.2)
                if response.status_code == 200:
                    return
            except httpx.ConnectError:
                await asyncio.sleep(0.05)
    pytest.fail("Rust server did not become ready within five seconds")


def _stop_rust_service(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    process.send_signal(signal.SIGINT)
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.terminate()
        process.wait(timeout=5)


def _close_rust_service(process: subprocess.Popen[bytes] | None, log: BinaryIO | None) -> None:
    if process is not None:
        _stop_rust_service(process)
    if log is not None:
        log.close()


def _restore_database_dependency(python_app: FastAPI, previous: object | None) -> None:
    if previous is None:
        python_app.dependency_overrides.pop(get_db, None)
    else:
        python_app.dependency_overrides[get_db] = previous


@pytest.mark.slow
async def test_same_http_requests_match_fastapi_against_migrated_postgres() -> None:
    database_url = os.getenv("THESIS_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("set THESIS_TEST_DATABASE_URL to a disposable Alembic-migrated database")
    python_app = _python_evidence_app()
    python_news_app = _python_news_app()
    python_comparison_app = _python_comparison_app()
    previous_override = python_app.dependency_overrides.get(get_db)
    engine = create_async_engine(_async_database_url(database_url))
    sessions: async_sessionmaker[AsyncSession] = async_sessionmaker(engine, expire_on_commit=False)

    async def test_database_session() -> AsyncIterator[AsyncSession]:
        async with sessions() as session:
            yield session

    python_app.dependency_overrides[get_db] = test_database_session
    process = None
    log = None
    entity_ids: list[str] = []
    document_ids: list[str] = []
    relationship_ids: list[str] = []
    try:
        process, base_url, log = _start_rust_service(database_url)
        await _wait_for_rust_service(process, base_url, log)
        (
            entity_ids,
            document_ids,
            claim_ids,
            relationship_ids,
            interest_ids,
        ) = await _seed_evidence(database_url)
        python_transport = httpx.ASGITransport(app=python_app)
        async with (
            httpx.AsyncClient(
                transport=python_transport, base_url="http://python.test"
            ) as python_client,
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=python_news_app),
                base_url="http://python-news.test",
            ) as python_news_client,
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=python_comparison_app),
                base_url="http://python-comparison.test",
            ) as python_comparison_client,
            httpx.AsyncClient(base_url=base_url) as rust_client,
        ):
            python_policies = await python_client.get(POLICIES_ENDPOINT)
            rust_policies = await rust_client.get(POLICIES_ENDPOINT)
            assert rust_policies.status_code == python_policies.status_code
            assert rust_policies.json() == python_policies.json()
            for claim_id in (*claim_ids, f"it-missing-{uuid.uuid4().hex}"):
                path = CLAIM_ENDPOINT.format(claim_id)
                python_claim = await python_client.get(path)
                rust_claim = await rust_client.get(path)
                assert rust_claim.status_code == python_claim.status_code
                if python_claim.status_code == 200:
                    assert _canonicalize_claim_record(rust_claim.json()) == (
                        _canonicalize_claim_record(python_claim.json())
                    )
                else:
                    assert rust_claim.json() == python_claim.json()
            cases = (
                {"claim_id": claim_ids[0]},
                {"claim_id": claim_ids[1]},
                {"claim_id": claim_ids[2], "complete_control_path": False},
                {"claim_id": claim_ids[2], "complete_control_path": True},
                {"claim_id": f"it-missing-{uuid.uuid4().hex}"},
                {"claim_id": claim_ids[0], "complete_control_path": None},
                {"claim_id": 42},
                {},
                {
                    "claim_id": claim_ids[0],
                    "complete_control_path": "yes",
                    "ignored_extra_field": True,
                },
                {"claim_id": claim_ids[0], "complete_control_path": 2},
            )
            for request in cases:
                python_response = await python_client.post(ENDPOINT, json=request)
                rust_response = await rust_client.post(ENDPOINT, json=request)
                assert rust_response.status_code == python_response.status_code
                assert rust_response.json() == python_response.json()

            await _compare_relationship_http_cases(
                python_client,
                rust_client,
                entity_ids,
                claim_ids,
                relationship_ids,
            )

            await _compare_interest_http_cases(python_client, rust_client, interest_ids)

            rank_cases = (
                {
                    "articles": [
                        {
                            "id": 1,
                            "title": "Climate policy update",
                            "summary": "New climate policy details",
                            "category": "World",
                            "source": "Example Wire",
                            "source_id": "wire",
                            "tags": ["climate"],
                            "image": "https://example.org/article.jpg",
                        },
                        {
                            "id": 2,
                            "title": "Climate policy debate",
                            "summary": "Policy debate details",
                            "category": "World",
                            "source": "Example Wire",
                            "source_id": "wire",
                            "tags": ["policy"],
                            "image": "none",
                        },
                        {
                            "id": 3,
                            "title": "Climate policy response",
                            "summary": "Response details",
                            "category": "World",
                            "source": "Other Outlet",
                            "source_id": "other",
                            "tags": ["response"],
                            "image": "https://example.org/response.jpg",
                        },
                        {"title": "Missing ID is retained"},
                    ],
                    "liked_article_ids": [1],
                    "favorite_source_ids": ["wire"],
                },
                {"articles": []},
                {"articles": [{"id": 9, "title": "Single article"}], "liked_article_ids": [9]},
                {
                    "articles": [{"id": 1, "title": "Coerced ID"}],
                    "liked_article_ids": ["1"],
                    "bookmarked_article_ids": [True],
                },
            )
            for request in rank_cases:
                python_response = await python_news_client.post(RANK_ENDPOINT, json=request)
                rust_response = await rust_client.post(RANK_ENDPOINT, json=request)
                assert rust_response.status_code == python_response.status_code
                assert rust_response.json() == python_response.json()
            invalid_rank_cases = (
                {},
                {"articles": None},
                {"articles": [None]},
                {"articles": [], "liked_article_ids": ["x"]},
                {"articles": [], "liked_article_ids": [1.5]},
                {"articles": [], "favorite_source_ids": [1]},
            )
            for request in invalid_rank_cases:
                python_response = await python_news_client.post(RANK_ENDPOINT, json=request)
                rust_response = await rust_client.post(RANK_ENDPOINT, json=request)
                assert rust_response.status_code == python_response.status_code
                assert rust_response.json() == python_response.json()
            await _compare_article_http_cases(python_comparison_client, rust_client)
            direct = (await rust_client.post(ENDPOINT, json={"claim_id": claim_ids[0]})).json()
            assert direct["accepted"] is True
            assert direct["independent_root_count"] == 2
            catalog = (await rust_client.post(ENDPOINT, json={"claim_id": claim_ids[1]})).json()
            assert catalog["accepted"] is False
            assert catalog["qualifying_observation_count"] == 0
    finally:
        _close_rust_service(process, log)
        _restore_database_dependency(python_app, previous_override)
        await engine.dispose()
        await _delete_evidence(database_url, entity_ids, document_ids, relationship_ids)


@pytest.mark.slow
async def test_debug_database_articles_matches_fastapi_against_migrated_postgres(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database_url = os.getenv("THESIS_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("set THESIS_TEST_DATABASE_URL to a disposable Alembic-migrated database")

    from app.api.routes import debug as debug_module

    monkeypatch.setattr(
        debug_module,
        "settings",
        replace(debug_module.settings, enable_database=True),
    )
    engine = create_async_engine(_async_database_url(database_url))
    sessions: async_sessionmaker[AsyncSession] = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(debug_module, "AsyncSessionLocal", sessions)
    python_app = _python_debug_app()

    source = f"it-debug-{uuid.uuid4().hex}"
    base_time = datetime(2025, 1, 1)
    rows = (
        ("Older without embedding", base_time, None, "older content"),
        ("Middle without embedding", base_time + timedelta(days=1), False, None),
        ("Newest embedded", base_time + timedelta(days=2), True, "newest content"),
    )
    article_ids: list[int] = []
    process = None
    log = None
    try:
        async with engine.begin() as connection:
            for index, (title, published_at, embedding_generated, content) in enumerate(rows):
                result = await connection.exec_driver_sql(
                    "INSERT INTO articles "
                    "(title, source, published_at, url, content, image_url, summary, embedding_generated) "
                    "VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
                    (
                        title,
                        source,
                        published_at,
                        f"https://test.invalid/{source}/{index}",
                        content,
                        None,
                        f"summary {index}",
                        embedding_generated,
                    ),
                )
                article_ids.append(int(result.scalar_one()))

        process, base_url, log = _start_rust_service(database_url, enable_database=True)
        await _wait_for_rust_service(process, base_url, log)
        async with (
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=python_app),
                base_url="http://python-debug.test",
            ) as python_client,
            httpx.AsyncClient(base_url=base_url) as rust_client,
        ):

            async def compare_success(params: dict[str, str]) -> dict[str, Any]:
                python_response = await python_client.get("/debug/database/articles", params=params)
                rust_response = await rust_client.get("/debug/database/articles", params=params)
                assert rust_response.status_code == python_response.status_code == 200
                assert rust_response.json() == python_response.json()
                return rust_response.json()

            default_page = await compare_success({"source": source})
            assert default_page["sort_direction"] == "desc"
            assert default_page["articles"][0]["title"] == "Newest embedded"
            assert default_page["total"] == 3

            missing_page = await compare_success(
                {
                    "source": source,
                    "missing_embeddings_only": "true",
                    "sort_direction": "ASC",
                    "limit": "1",
                    "offset": "1",
                }
            )
            assert [article["title"] for article in missing_page["articles"]] == [
                "Middle without embedding"
            ]
            assert missing_page["total"] == 2
            assert missing_page["oldest_published"] == base_time.isoformat()

            inclusive_boundary = (base_time + timedelta(days=1)).isoformat()
            boundary_page = await compare_success(
                {
                    "source": source,
                    "published_after": inclusive_boundary,
                    "published_before": inclusive_boundary,
                }
            )
            assert [article["title"] for article in boundary_page["articles"]] == [
                "Middle without embedding"
            ]
            assert boundary_page["total"] == 1

            invalid_queries = (
                {"source": source, "missing_embeddings_only": " true"},
                {"source": source, "sort_direction": "sideways"},
            )
            for params in invalid_queries:
                python_response = await python_client.get("/debug/database/articles", params=params)
                rust_response = await rust_client.get("/debug/database/articles", params=params)
                assert rust_response.status_code == python_response.status_code == 422
                assert rust_response.json() == python_response.json()
    finally:
        _close_rust_service(process, log)
        try:
            if article_ids:
                async with engine.begin() as connection:
                    await connection.exec_driver_sql(
                        "DELETE FROM articles WHERE id = ANY($1::integer[])", (article_ids,)
                    )
        finally:
            await engine.dispose()


@pytest.mark.slow
async def test_wiki_index_status_matches_fastapi_for_aggregates_and_nullable_status() -> None:
    database_url = os.getenv("THESIS_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("set THESIS_TEST_DATABASE_URL to a disposable database with wiki index schema")

    engine = create_async_engine(_async_database_url(database_url))
    sessions: async_sessionmaker[AsyncSession] = async_sessionmaker(engine, expire_on_commit=False)
    python_app = _python_wiki_app()

    async def test_database_session() -> AsyncIterator[AsyncSession]:
        async with sessions() as session:
            yield session

    python_app.dependency_overrides[get_db] = test_database_session
    token = uuid.uuid4().hex
    index_status_ids: list[int] = []
    process = None
    log = None
    try:
        async with engine.begin() as connection:
            existing_nulls = await connection.exec_driver_sql(
                "SELECT count(*) FROM wiki_index_status WHERE status IS NULL"
            )
            if int(existing_nulls.scalar_one()) != 0:
                pytest.skip("disposable database already contains null wiki index statuses")
            baseline_result = await connection.exec_driver_sql(
                "SELECT count(*), "
                "count(*) FILTER (WHERE status = 'complete'), "
                "count(*) FILTER (WHERE status = 'failed'), "
                "count(*) FILTER (WHERE entity_type = 'source'), "
                "count(*) FILTER (WHERE entity_type = 'reporter') "
                "FROM wiki_index_status"
            )
            baseline = baseline_result.one()
            for index, (entity_type, status) in enumerate(
                (("source", "complete"), ("reporter", "failed"))
            ):
                inserted = await connection.exec_driver_sql(
                    "INSERT INTO wiki_index_status (entity_type, entity_name, status) "
                    "VALUES ($1, $2, $3) RETURNING id",
                    (entity_type, f"it-wiki-status-{token}-{index}", status),
                )
                index_status_ids.append(int(inserted.scalar_one()))

        process, base_url, log = _start_rust_service(database_url)
        await _wait_for_rust_service(process, base_url, log)
        async with (
            httpx.AsyncClient(
                transport=httpx.ASGITransport(
                    app=python_app,
                    raise_app_exceptions=False,
                ),
                base_url="http://python-wiki.test",
            ) as python_client,
            httpx.AsyncClient(base_url=base_url) as rust_client,
        ):
            python_success = await python_client.get("/api/wiki/index/status")
            rust_success = await rust_client.get("/api/wiki/index/status")
            assert python_success.status_code == rust_success.status_code == 200
            assert python_success.json() == rust_success.json()
            success_body = rust_success.json()
            assert success_body["total_entries"] == int(baseline[0]) + 2
            assert success_body["by_status"]["complete"] == int(baseline[1]) + 1
            assert success_body["by_status"]["failed"] == int(baseline[2]) + 1
            assert success_body["by_type"]["source"] == int(baseline[3]) + 1
            assert success_body["by_type"]["reporter"] == int(baseline[4]) + 1

            async with engine.begin() as connection:
                inserted_null = await connection.exec_driver_sql(
                    "INSERT INTO wiki_index_status (entity_type, entity_name, status) "
                    "VALUES ($1, $2, $3) RETURNING id",
                    ("source", f"it-wiki-status-null-{token}", None),
                )
                index_status_ids.append(int(inserted_null.scalar_one()))

            python_error = await python_client.get("/api/wiki/index/status")
            rust_error = await rust_client.get("/api/wiki/index/status")
            assert python_error.status_code == rust_error.status_code == 500
    finally:
        _close_rust_service(process, log)
        try:
            if index_status_ids:
                async with engine.begin() as connection:
                    await connection.exec_driver_sql(
                        "DELETE FROM wiki_index_status WHERE id = ANY($1::integer[])",
                        (index_status_ids,),
                    )
        finally:
            await engine.dispose()
