"""Offline contracts for the Rust B08 entity and source research boundary."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
INVENTORY_PATH = ROOT / "docs" / "agents" / "rust-openapi-operation-inventory.json"
OPENAPI_PATH = ROOT / "backend" / "openapi.json"

OPERATIONS = {
    (
        "/research/entity/reporter/profile",
        "post",
    ): "profile_reporter_research_entity_reporter_profile_post",
    (
        "/research/entity/reporter/{reporter_id}",
        "get",
    ): "get_reporter_research_entity_reporter__reporter_id__get",
    (
        "/research/entity/organization/research",
        "post",
    ): "research_organization_research_entity_organization_research_post",
    (
        "/research/entity/source/profile",
        "post",
    ): "research_source_profile_research_entity_source_profile_post",
    (
        "/research/entity/source/batch",
        "post",
    ): "research_source_batch_research_entity_source_batch_post",
    (
        "/research/entity/organization/{org_id}",
        "get",
    ): "get_organization_research_entity_organization__org_id__get",
    (
        "/research/entity/organization/{org_name}/ownership-chain",
        "get",
    ): "get_ownership_chain_research_entity_organization__org_name__ownership_chain_get",
    (
        "/research/entity/reporters",
        "get",
    ): "list_reporters_research_entity_reporters_get",
    (
        "/research/entity/organizations",
        "get",
    ): "list_organizations_research_entity_organizations_get",
    (
        "/research/entity/material-context",
        "post",
    ): "analyze_material_context_research_entity_material_context_post",
    (
        "/research/entity/country/{country_code}/economic-profile",
        "get",
    ): "get_country_economic_profile_research_entity_country__country_code__economic_profile_get",
}

REQUEST_SCHEMAS = {
    "/research/entity/reporter/profile": "ReporterProfileRequest",
    "/research/entity/organization/research": "OrganizationResearchRequest",
    "/research/entity/source/profile": "SourceResearchRequest",
    "/research/entity/source/batch": "SourceBatchRequest",
    "/research/entity/material-context": "MaterialContextRequest",
}

RESPONSE_SCHEMAS = {
    "/research/entity/reporter/profile": "ReporterProfileResponse",
    "/research/entity/reporter/{reporter_id}": "ReporterProfileResponse",
    "/research/entity/organization/research": "OrganizationResearchResponse",
    "/research/entity/source/profile": "SourceResearchResponse",
    "/research/entity/source/batch": "SourceBatchResponse",
    "/research/entity/organization/{org_id}": "OrganizationResearchResponse",
    "/research/entity/organization/{org_name}/ownership-chain": "OwnershipChainResponse",
    "/research/entity/reporters": "ReporterProfileResponse",
    "/research/entity/organizations": "OrganizationResearchResponse",
    "/research/entity/material-context": "MaterialContextResponse",
}


def _json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _operation_rows() -> dict[tuple[str, str], str]:
    document = _json(INVENTORY_PATH)
    return {
        (row["path"], row["method"].lower()): row["operation_id"]
        for row in document["operations"]
        if row["batch"] == "B08"
        and row["route_module"] == "backend/app/api/routes/entity_research.py"
    }


def test_inventory_keeps_exact_b08_entity_research_operations() -> None:
    assert _operation_rows() == OPERATIONS



def test_public_entity_research_openapi_contract_is_unchanged() -> None:
    document = _json(OPENAPI_PATH)
    for (path, method), operation_id in OPERATIONS.items():
        operation = document["paths"][path][method]
        assert operation["operationId"] == operation_id
        assert "security" not in operation
        assert set(operation["responses"]) == {"200", "422"}

    for path, schema_name in REQUEST_SCHEMAS.items():
        body = document["paths"][path]["post"]["requestBody"]
        assert body["required"] is True
        assert body["content"]["application/json"]["schema"] == {
            "$ref": f"#/components/schemas/{schema_name}"
        }

    for path, schema_name in RESPONSE_SCHEMAS.items():
        method = "post" if path in REQUEST_SCHEMAS else "get"
        schema = document["paths"][path][method]["responses"]["200"]["content"][
            "application/json"
        ]["schema"]
        if path in {"/research/entity/reporters", "/research/entity/organizations"}:
            assert schema["type"] == "array"
            assert schema["items"] == {"$ref": f"#/components/schemas/{schema_name}"}
        else:
            assert schema == {"$ref": f"#/components/schemas/{schema_name}"}

    country_schema = document["paths"][
        "/research/entity/country/{country_code}/economic-profile"
    ]["get"]["responses"]["200"]["content"]["application/json"]["schema"]
    assert country_schema["type"] == "object"
    assert country_schema["additionalProperties"] is True


def test_public_query_and_path_parameter_contracts_remain_exact() -> None:
    paths = _json(OPENAPI_PATH)["paths"]
    expected = {
        "/research/entity/reporter/profile": {"force_refresh"},
        "/research/entity/organization/research": {"force_refresh"},
        "/research/entity/source/profile": {"force_refresh", "cache_only"},
        "/research/entity/organization/{org_name}/ownership-chain": {"org_name", "max_depth"},
        "/research/entity/reporters": {"limit", "offset"},
        "/research/entity/organizations": {"limit", "offset"},
        "/research/entity/reporter/{reporter_id}": {"reporter_id"},
        "/research/entity/organization/{org_id}": {"org_id"},
        "/research/entity/country/{country_code}/economic-profile": {"country_code"},
    }
    for path, names in expected.items():
        method_key = "get" if "get" in paths[path] else "post"
        actual = {
            parameter["name"]
            for parameter in paths[path][method_key].get("parameters", [])
        }
        assert actual == names


