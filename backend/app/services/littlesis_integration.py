"""LittleSis bulk-data import and reporter cross-reference helpers."""

from __future__ import annotations

import contextlib
import gzip
import json
import os
from collections.abc import Iterator
from pathlib import Path
from typing import Any, TextIO, cast

import httpx

from app.core.logging import get_logger

logger = get_logger("littlesis")

LITTLESIS_BULK_BASE = "https://littlesis.org/database/public_data"
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
    1: "position",
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
    str(Path(__file__).resolve().parent.parent.parent / "data" / "littlesis"),
)
_CHUNK_SIZE = 1 << 20


def _ensure_data_dir() -> str:
    Path(LITTLESIS_DATA_DIR).mkdir(parents=True, exist_ok=True)
    return LITTLESIS_DATA_DIR


def _is_media_entity(entity: dict[str, Any]) -> bool:
    name = str(entity.get("name", "")).lower()
    description = str(
        entity.get("description") or entity.get("blurb") or entity.get("summary") or ""
    ).lower()
    entity_type = str(entity.get("primary_ext", "")).lower()
    text = f"{name} {description} {entity_type}"
    return any(keyword in text for keyword in MEDIA_KEYWORDS)


def _name_tokens(name: str) -> frozenset[str]:
    return frozenset(name.lower().strip().split())


def _read_initial_json_buffer(fileobj: TextIO) -> tuple[str | None, str]:
    buffer = ""
    while True:
        chunk = fileobj.read(_CHUNK_SIZE)
        buffer += chunk
        stripped = buffer.lstrip()
        if stripped:
            mode = "array" if stripped.startswith("[") else "lines"
            return mode, buffer
        if chunk == "":
            return None, buffer


def _decode_json_line(line: str) -> Any | None:
    normalized = line.strip()
    if not normalized:
        return None
    with contextlib.suppress(json.JSONDecodeError):
        return json.loads(normalized)
    return None


def _consume_line_buffer(buffer: str, *, final: bool) -> tuple[list[Any], str]:
    pieces = buffer.split("\n")
    remainder = "" if final else pieces.pop()
    records = [record for line in pieces if (record := _decode_json_line(line)) is not None]
    if final and (record := _decode_json_line(remainder)) is not None:
        records.append(record)
    return records, remainder


def _iter_line_records(fileobj: TextIO, initial_buffer: str) -> Iterator[Any]:
    buffer = initial_buffer
    while True:
        chunk = fileobj.read(_CHUNK_SIZE)
        records, buffer = _consume_line_buffer(buffer + chunk, final=chunk == "")
        yield from records
        if chunk == "":
            return


def _strip_array_delimiters(buffer: str) -> str:
    return buffer.lstrip(" \t\r\n,")


def _consume_array_buffer(
    buffer: str,
    decoder: json.JSONDecoder,
) -> tuple[list[Any], str, bool]:
    records: list[Any] = []
    remainder = _strip_array_delimiters(buffer)
    while remainder:
        if remainder.startswith("]"):
            return records, remainder[1:], True
        try:
            record, end = decoder.raw_decode(remainder)
        except json.JSONDecodeError:
            break
        records.append(record)
        remainder = _strip_array_delimiters(remainder[end:])
    return records, remainder, False


def _array_payload_start(buffer: str) -> str:
    index = buffer.find("[")
    return buffer[index + 1 :] if index >= 0 else buffer


def _iter_array_records(fileobj: TextIO, initial_buffer: str) -> Iterator[Any]:
    decoder = json.JSONDecoder()
    buffer = _array_payload_start(initial_buffer)
    while True:
        records, buffer, done = _consume_array_buffer(buffer, decoder)
        yield from records
        if done:
            return
        chunk = fileobj.read(_CHUNK_SIZE)
        if chunk == "":
            return
        buffer += chunk


def _iter_json_records(fileobj: TextIO) -> Iterator[Any]:
    """Stream records from either a JSON array or newline-delimited JSON dump."""
    mode, initial_buffer = _read_initial_json_buffer(fileobj)
    if mode == "array":
        yield from _iter_array_records(fileobj, initial_buffer)
    elif mode == "lines":
        yield from _iter_line_records(fileobj, initial_buffer)


def _flatten_jsonapi_record(raw: dict[str, Any]) -> dict[str, Any]:
    """Flatten a JSON:API record while preserving legacy flat records."""
    attributes = raw.get("attributes")
    if not isinstance(attributes, dict):
        return raw
    flat = dict(attributes)
    flat.setdefault("id", raw.get("id"))
    return flat


async def _download_bulk_file(
    http_client: httpx.AsyncClient,
    data_dir: str,
    filename: str,
) -> tuple[str | None, str | None]:
    local_path = str(Path(data_dir) / filename)
    if Path(local_path).exists():
        logger.info("LittleSis file already cached: %s", local_path)
        return local_path, None

    url = f"{LITTLESIS_BULK_BASE}/{filename}"
    logger.info("Downloading %s ...", url)
    try:
        response = await http_client.get(url)
    except httpx.HTTPError as exc:
        return None, f"{filename}: {type(exc).__name__}"
    if response.status_code != 200:
        return None, f"{filename}: HTTP {response.status_code}"

    Path(local_path).write_bytes(response.content)
    logger.info("Downloaded %s -> %s", filename, local_path)
    return local_path, None


async def download_littlesis_bulk(
    client: httpx.AsyncClient | None = None,
) -> dict[str, str]:
    """Download LittleSis bulk data files, skipping files already cached locally."""
    data_dir = _ensure_data_dir()
    owned_client = client is None
    http_client = client or httpx.AsyncClient(timeout=300.0, follow_redirects=True)
    filenames = (LITTLESIS_ENTITIES_FILE, LITTLESIS_RELATIONSHIPS_FILE)
    try:
        results: dict[str, str] = {}
        failures: list[str] = []
        for filename in filenames:
            path, failure = await _download_bulk_file(http_client, data_dir, filename)
            if path:
                results[filename] = path
            if failure:
                failures.append(failure)
        if failures:
            logger.warning(
                "LittleSis bulk download unavailable (offline?), skipping: %s",
                "; ".join(failures),
            )
        return results
    finally:
        if owned_client:
            await http_client.aclose()


def _resolved_bulk_path(filepath: str | None, filename: str) -> str:
    return filepath or str(Path(_ensure_data_dir()) / filename)


def load_littlesis_entities(filepath: str | None = None) -> list[dict[str, Any]]:
    """Load media-related entities from a LittleSis JSON gzip file."""
    resolved = _resolved_bulk_path(filepath, LITTLESIS_ENTITIES_FILE)
    if not Path(resolved).exists():
        logger.warning("LittleSis entities file not found: %s", resolved)
        return []

    logger.info("Loading entities from %s ...", resolved)
    entities: list[dict[str, Any]] = []
    record_num = 0
    with gzip.open(resolved, "rt", encoding="utf-8") as fileobj:
        for record_num, raw in enumerate(_iter_json_records(fileobj), 1):
            entity = _flatten_jsonapi_record(cast(dict[str, Any], raw))
            if _is_media_entity(entity):
                entities.append(entity)
            if record_num % 50000 == 0:
                logger.debug("Parsed %d records, %d media entities found", record_num, len(entities))
    logger.info("Loaded %d media-related entities from %d total records", len(entities), record_num)
    return entities


def _relationship_matches_entities(rel: dict[str, Any], entity_ids: set[int] | None) -> bool:
    if entity_ids is None:
        return True
    return rel.get("entity1_id") in entity_ids or rel.get("entity2_id") in entity_ids


def load_littlesis_relationships(
    filepath: str | None = None,
    entity_ids: set[int] | None = None,
) -> list[dict[str, Any]]:
    """Load LittleSis relationships, optionally restricted to selected entity IDs."""
    resolved = _resolved_bulk_path(filepath, LITTLESIS_RELATIONSHIPS_FILE)
    if not Path(resolved).exists():
        logger.warning("LittleSis relationships file not found: %s", resolved)
        return []

    logger.info("Loading relationships from %s ...", resolved)
    relationships: list[dict[str, Any]] = []
    record_num = 0
    with gzip.open(resolved, "rt", encoding="utf-8") as fileobj:
        for record_num, raw in enumerate(_iter_json_records(fileobj), 1):
            rel = _flatten_jsonapi_record(cast(dict[str, Any], raw))
            if _relationship_matches_entities(rel, entity_ids):
                relationships.append(rel)
            if record_num % 100000 == 0:
                logger.debug(
                    "Parsed %d records, %d matching relationships",
                    record_num,
                    len(relationships),
                )
    logger.info("Loaded %d relationships from %d total records", len(relationships), record_num)
    return relationships


def _entity_name_indexes(
    entities: list[dict[str, Any]],
) -> tuple[dict[str, dict[str, Any]], dict[frozenset[str], dict[str, Any]]]:
    exact: dict[str, dict[str, Any]] = {}
    by_tokens: dict[frozenset[str], dict[str, Any]] = {}
    for entity in entities:
        name = str(entity.get("name", "")).strip().lower()
        if not name:
            continue
        exact[name] = entity
        by_tokens.setdefault(_name_tokens(name), entity)
    return exact, by_tokens


def _reporter_search_names(reporter_name: str, normalized_name: str | None) -> set[str]:
    values = {reporter_name.lower().strip()}
    if normalized_name:
        values.add(normalized_name.lower().strip())
    return {value for value in values if value}


def _match_reporter_entity(
    search_names: set[str],
    exact: dict[str, dict[str, Any]],
    by_tokens: dict[frozenset[str], dict[str, Any]],
) -> tuple[dict[str, Any], str] | None:
    for search_name in search_names:
        entity = exact.get(search_name) or by_tokens.get(_name_tokens(search_name))
        if entity is not None:
            return entity, str(entity.get("name") or search_name).strip().lower()
    return None


def cross_reference_entities_with_reporters(
    entities: list[dict[str, Any]],
    reporter_names: list[tuple[int, str, str | None]],
) -> list[dict[str, Any]]:
    """Match LittleSis entities to Reporter records by normalized name tokens."""
    exact, by_tokens = _entity_name_indexes(entities)
    matches: list[dict[str, Any]] = []
    for reporter_id, reporter_name, normalized_name in reporter_names:
        matched = _match_reporter_entity(
            _reporter_search_names(reporter_name, normalized_name), exact, by_tokens
        )
        if matched is None:
            continue
        entity, match_name = matched
        matches.append(
            {
                "reporter_id": reporter_id,
                "littlesis_entity": entity,
                "match_name": match_name,
                "score": 1.0,
            }
        )
    logger.info(
        "Cross-referenced %d reporter records against %d LS entities -> %d matches",
        len(reporter_names),
        len(entities),
        len(matches),
    )
    return matches


def _entity_reporter_map(matches: list[dict[str, Any]]) -> dict[int, int]:
    mapping: dict[int, int] = {}
    for match in matches:
        entity = match.get("littlesis_entity")
        if not isinstance(entity, dict):
            continue
        entity_id = entity.get("id")
        if entity_id is not None:
            mapping[int(entity_id)] = int(match["reporter_id"])
    return mapping


def _relationship_category(rel: dict[str, Any]) -> str:
    category_id = rel.get("category_id")
    if not isinstance(category_id, (int, str)):
        return "other"
    with contextlib.suppress(ValueError):
        return RELATIONSHIP_CATEGORIES_OF_INTEREST.get(int(category_id), "other")
    return "other"


def _affiliation_for_pair(
    rel: dict[str, Any],
    person_id: object,
    org_id: object,
    entity_id_to_reporter: dict[int, int],
    entities_by_id: dict[int, dict[str, Any]],
) -> dict[str, Any] | None:
    if not isinstance(person_id, int) or person_id not in entity_id_to_reporter:
        return None
    if not isinstance(org_id, int) or org_id not in entities_by_id:
        return None
    org_entity = entities_by_id[org_id]
    org_name = str(org_entity.get("name", "")).strip()
    if not org_name:
        return None
    rel_id = rel.get("id")
    return {
        "reporter_id": entity_id_to_reporter[person_id],
        "category": _relationship_category(rel),
        "organization": org_name,
        "org_type": str(org_entity.get("primary_ext", "")),
        "start_date": rel.get("start_date"),
        "end_date": rel.get("end_date"),
        "source": "littlesis",
        "littlesis_url": f"https://littlesis.org/relationships/{rel_id}" if rel_id else None,
    }


def _relationship_affiliations(
    rel: dict[str, Any],
    entity_id_to_reporter: dict[int, int],
    entities_by_id: dict[int, dict[str, Any]],
) -> list[dict[str, Any]]:
    pairs = (
        (rel.get("entity1_id"), rel.get("entity2_id")),
        (rel.get("entity2_id"), rel.get("entity1_id")),
    )
    return [
        affiliation
        for person_id, org_id in pairs
        if (
            affiliation := _affiliation_for_pair(
                rel,
                person_id,
                org_id,
                entity_id_to_reporter,
                entities_by_id,
            )
        )
        is not None
    ]


def _affiliation_key(affiliation: dict[str, Any]) -> tuple[int, str, str]:
    return (
        int(affiliation["reporter_id"]),
        str(affiliation["organization"]),
        str(affiliation["category"]),
    )


def extract_affiliations_from_relationships(
    matches: list[dict[str, Any]],
    relationships: list[dict[str, Any]],
    entities_by_id: dict[int, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Extract deduplicated organizational affiliations for matched reporters."""
    entity_id_to_reporter = _entity_reporter_map(matches)
    deduped: dict[tuple[int, str, str], dict[str, Any]] = {}
    for rel in relationships:
        for affiliation in _relationship_affiliations(rel, entity_id_to_reporter, entities_by_id):
            deduped.setdefault(_affiliation_key(affiliation), affiliation)
    affiliations = list(deduped.values())
    logger.info("Extracted %d reporter affiliations from relationships", len(affiliations))
    return affiliations


def _default_reporter_lookup_result() -> dict[str, Any]:
    return {
        "littlesis_url": None,
        "institutional_affiliations": [],
        "match_score": 0.0,
    }


def _reporter_matches(
    entities: list[dict[str, Any]], reporter_name: str, employer_name: str | None
) -> list[dict[str, Any]]:
    normalized = reporter_name.lower().strip() or None
    matches = cross_reference_entities_with_reporters(entities, [(0, reporter_name, normalized)])
    if matches or not employer_name:
        return matches
    combined = f"{reporter_name} {employer_name}"
    return cross_reference_entities_with_reporters(
        entities,
        [(0, combined, combined.lower().strip() or None)],
    )


def _entities_by_integer_id(entities: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    mapping: dict[int, dict[str, Any]] = {}
    for entity in entities:
        entity_id = entity.get("id")
        if entity_id is not None:
            with contextlib.suppress(TypeError, ValueError):
                mapping[int(entity_id)] = entity
    return mapping


def _public_affiliation(affiliation: dict[str, Any]) -> dict[str, Any]:
    keys = (
        "organization",
        "category",
        "org_type",
        "start_date",
        "end_date",
        "source",
        "littlesis_url",
    )
    return {key: affiliation.get(key) for key in keys}


def _load_reporter_affiliations(
    entity_id: int,
    matches: list[dict[str, Any]],
    entities: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    relationships_path = str(Path(_ensure_data_dir()) / LITTLESIS_RELATIONSHIPS_FILE)
    if not Path(relationships_path).exists():
        return []
    relationships = load_littlesis_relationships(relationships_path, entity_ids={entity_id})
    affiliations = extract_affiliations_from_relationships(
        matches,
        relationships,
        _entities_by_integer_id(entities),
    )
    return [_public_affiliation(item) for item in affiliations if item.get("reporter_id") == 0]


def get_littlesis_affiliations_for_reporter(
    reporter_name: str,
    employer_name: str | None = None,
    wikidata_qid: str | None = None,
) -> dict[str, Any]:
    """Look up a reporter in cached LittleSis bulk data and return affiliations."""
    del wikidata_qid  # Reserved for a future explicit QID bridge; name matching remains authoritative.
    result = _default_reporter_lookup_result()
    entities_path = str(Path(_ensure_data_dir()) / LITTLESIS_ENTITIES_FILE)
    if not Path(entities_path).exists():
        logger.debug("LittleSis entities file not cached; skipping reporter lookup")
        return result

    entities = load_littlesis_entities(entities_path)
    matches = _reporter_matches(entities, reporter_name, employer_name)
    if not matches:
        return result

    best_match = max(matches, key=lambda match: float(match.get("score", 0.0)))
    match_entity = best_match.get("littlesis_entity") or {}
    entity_id = match_entity.get("id") if isinstance(match_entity, dict) else None
    result["match_score"] = best_match.get("score", 0.0)
    if entity_id is None:
        return result

    numeric_id = int(entity_id)
    result["littlesis_url"] = f"https://littlesis.org/entities/{numeric_id}"
    result["institutional_affiliations"] = _load_reporter_affiliations(
        numeric_id, matches, entities
    )
    return result
