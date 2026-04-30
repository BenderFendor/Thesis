"""
LittleSis Integration - Import and cross-reference LittleSis bulk data.

LittleSis is a free, open-source power-research database (CC BY-SA).
It tracks relationships between powerful people and organizations.

Data sources:
- Bulk data download: https://littlesis.org/bulk_data
  - entities.json.gz: ~303K people/org entities
  - relationships.json.gz: ~1.86M relationships
- REST API: https://littlesis.org/api

This module imports LittleSis data to enrich reporter profiles with:
- Employment relationships (person works at organization)
- Board memberships
- Donations
- Affiliations (membership, ownership, family, social)
- Education ties
"""

from __future__ import annotations

import gzip
import json
import os
from typing import Any, Dict, List, Optional, Set, Tuple, cast

import httpx

from app.core.logging import get_logger

logger = get_logger("littlesis")

LITTLESIS_BULK_BASE = "https://littlesis.org/bulk_data"
LITTLESIS_ENTITIES_FILE = "entities.json.gz"
LITTLESIS_RELATIONSHIPS_FILE = "relationships.json.gz"
LITTLESIS_API_BASE = "https://littlesis.org/api"

MEDIA_KEYWORDS = (
    "media",
    "news",
    "press",
    "journalist",
    "reporter",
    "editor",
    "correspondent",
    "columnist",
    "anchor",
    "broadcast",
    "publisher",
    "newspaper",
    "magazine",
)

RELATIONSHIP_CATEGORIES_OF_INTEREST = {
    1: "position",  # Employment
    2: "education",
    3: "membership",
    4: "family",
    5: "donation",
    6: "transaction",
    7: "lobbying",
    8: "social",
    9: "professional",
    10: "ownership",
    11: "hierarchy",
    12: "generic",
}

LITTLESIS_DATA_DIR = os.environ.get(
    "LITTLESIS_DATA_DIR",
    os.path.join(os.path.dirname(__file__), "..", "..", "data", "littlesis"),
)


def _ensure_data_dir() -> str:
    os.makedirs(LITTLESIS_DATA_DIR, exist_ok=True)
    return LITTLESIS_DATA_DIR


def _is_media_entity(entity: Dict[str, Any]) -> bool:
    name = str(entity.get("name", "")).lower()
    description = str(entity.get("description", "")).lower()
    entity_type = str(entity.get("primary_ext", "")).lower()
    text = f"{name} {description} {entity_type}"
    return any(keyword in text for keyword in MEDIA_KEYWORDS)


def _name_tokens(name: str) -> Set[str]:
    return set(name.lower().strip().split())


async def download_littlesis_bulk(
    client: Optional[httpx.AsyncClient] = None,
) -> Dict[str, str]:
    """Download LittleSis bulk data files.

    Returns dict of filename -> local filepath.
    """
    data_dir = _ensure_data_dir()
    owned_client = client is None
    http_client = client or httpx.AsyncClient(timeout=300.0, follow_redirects=True)

    try:
        results: Dict[str, str] = {}
        for filename in [LITTLESIS_ENTITIES_FILE, LITTLESIS_RELATIONSHIPS_FILE]:
            local_path = os.path.join(data_dir, filename)
            url = f"{LITTLESIS_BULK_BASE}/{filename}"

            if os.path.exists(local_path):
                logger.info("LittleSis file already cached: %s", local_path)
                results[filename] = local_path
                continue

            logger.info("Downloading %s ...", url)
            response = await http_client.get(url)
            if response.status_code != 200:
                logger.error(
                    "Failed to download %s: HTTP %d", url, response.status_code
                )
                continue

            with open(local_path, "wb") as f:
                f.write(response.content)
            logger.info("Downloaded %s -> %s", filename, local_path)
            results[filename] = local_path

        return results
    finally:
        if owned_client:
            await http_client.aclose()


def load_littlesis_entities(
    filepath: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Load entities from a LittleSis JSON gzip file.

    Returns list of entity dicts filtered to media-related entities.
    """
    if filepath is None:
        filepath = os.path.join(_ensure_data_dir(), LITTLESIS_ENTITIES_FILE)

    if not os.path.exists(filepath):
        logger.error("LittleSis entities file not found: %s", filepath)
        return []

    logger.info("Loading entities from %s ...", filepath)
    entities: List[Dict[str, Any]] = []

    line_num = 0
    with gzip.open(filepath, "rt", encoding="utf-8") as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                entity = cast(Dict[str, Any], json.loads(line))
                if _is_media_entity(entity):
                    entities.append(entity)
            except json.JSONDecodeError:
                continue

            if line_num % 50000 == 0:
                logger.debug(
                    "Parsed %d lines, %d media entities found",
                    line_num,
                    len(entities),
                )

    logger.info(
        "Loaded %d media-related entities from %d total lines",
        len(entities),
        line_num,
    )
    return entities


def load_littlesis_relationships(
    filepath: Optional[str] = None,
    entity_ids: Optional[Set[int]] = None,
) -> List[Dict[str, Any]]:
    """Load relationships from a LittleSis JSON gzip file.

    If entity_ids is provided, filters to relationships involving those entities.
    """
    if filepath is None:
        filepath = os.path.join(_ensure_data_dir(), LITTLESIS_RELATIONSHIPS_FILE)

    if not os.path.exists(filepath):
        logger.error("LittleSis relationships file not found: %s", filepath)
        return []

    logger.info("Loading relationships from %s ...", filepath)
    relationships: List[Dict[str, Any]] = []

    line_num = 0
    with gzip.open(filepath, "rt", encoding="utf-8") as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                rel = cast(Dict[str, Any], json.loads(line))
                if entity_ids is not None:
                    entity1_id = rel.get("entity1_id")
                    entity2_id = rel.get("entity2_id")
                    if entity1_id not in entity_ids and entity2_id not in entity_ids:
                        continue
                relationships.append(rel)
            except json.JSONDecodeError:
                continue

            if line_num % 100000 == 0:
                logger.debug(
                    "Parsed %d lines, %d matching relationships",
                    line_num,
                    len(relationships),
                )

    logger.info(
        "Loaded %d relationships from %d total lines",
        len(relationships),
        line_num,
    )
    return relationships


def cross_reference_entities_with_reporters(
    entities: List[Dict[str, Any]],
    reporter_names: List[Tuple[int, str, Optional[str]]],
) -> List[Dict[str, Any]]:
    """Match LittleSis entities to Reporter records by name.

    Args:
        entities: LittleSis entity dicts
        reporter_names: List of (reporter_id, name, normalized_name)

    Returns list of match dicts with {reporter_id, littlesis_entity, match_name, score}
    """
    matches: List[Dict[str, Any]] = []
    entity_map: Dict[str, Dict[str, Any]] = {}
    for entity in entities:
        name = str(entity.get("name", "")).strip().lower()
        if name:
            entity_map[name] = entity

    for reporter_id, reporter_name, normalized_name in reporter_names:
        search_names = {reporter_name.lower().strip()}
        if normalized_name:
            search_names.add(normalized_name.lower().strip())

        for search_name in search_names:
            if search_name in entity_map:
                matches.append(
                    {
                        "reporter_id": reporter_id,
                        "littlesis_entity": entity_map[search_name],
                        "match_name": search_name,
                        "score": 1.0,
                    }
                )
                break
            for entity_name, entity in entity_map.items():
                tokens_a = _name_tokens(search_name)
                tokens_b = _name_tokens(entity_name)
                if tokens_a == tokens_b:
                    matches.append(
                        {
                            "reporter_id": reporter_id,
                            "littlesis_entity": entity,
                            "match_name": entity_name,
                            "score": 1.0,
                        }
                    )
                    break

    logger.info(
        "Cross-referenced %d reporter records against %d LS entities -> %d matches",
        len(reporter_names),
        len(entities),
        len(matches),
    )
    return matches


def extract_affiliations_from_relationships(
    matches: List[Dict[str, Any]],
    relationships: List[Dict[str, Any]],
    entities_by_id: Dict[int, Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """For each matched reporter, extract their organizational affiliations.

    Returns list of {reporter_id, category, org, start_date, end_date, source_url}
    """
    match_entity_ids: Set[int] = set()
    for match in matches:
        entity = match["littlesis_entity"]
        entity_id = entity.get("id")
        if entity_id:
            match_entity_ids.add(int(entity_id))

    entity_id_to_reporter: Dict[int, int] = {}
    for match in matches:
        entity_id = match["littlesis_entity"].get("id")
        if entity_id:
            entity_id_to_reporter[int(entity_id)] = match["reporter_id"]

    affiliations: List[Dict[str, Any]] = []
    seen: Set[Tuple[int, int, str]] = set()

    for rel in relationships:
        entity1_id = rel.get("entity1_id")
        entity2_id = rel.get("entity2_id")
        category_id = rel.get("category_id")

        category_label = (
            RELATIONSHIP_CATEGORIES_OF_INTEREST.get(int(category_id), "other")
            if isinstance(category_id, (int, str))
            else "other"
        )

        for person_id, org_id in [
            (entity1_id, entity2_id),
            (entity2_id, entity1_id),
        ]:
            if person_id not in entity_id_to_reporter:
                continue
            if not org_id or org_id not in entities_by_id:
                continue

            reporter_id = entity_id_to_reporter[person_id]
            org_entity = entities_by_id[org_id]
            org_name = str(org_entity.get("name", "")).strip()
            if not org_name:
                continue

            key = (reporter_id, person_id, org_name)
            if key in seen:
                continue
            seen.add(key)

            affiliations.append(
                {
                    "reporter_id": reporter_id,
                    "category": category_label,
                    "organization": org_name,
                    "org_type": str(org_entity.get("primary_ext", "")),
                    "start_date": rel.get("start_date"),
                    "end_date": rel.get("end_date"),
                    "source": "littlesis",
                    "littlesis_url": (
                        f"https://littlesis.org/relationships/{rel.get('id')}"
                        if rel.get("id")
                        else None
                    ),
                }
            )

    logger.info(
        "Extracted %d reporter affiliations from relationships", len(affiliations)
    )
    return affiliations
