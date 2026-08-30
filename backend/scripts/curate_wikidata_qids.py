"""
Wikidata QID curator for RSS sources.

Reads rss_sources.json, searches Wikidata for each source name,
uses embedding cosine similarity for disambiguation, and outputs
candidates for human review.

Usage:
    python backend/scripts/curate_wikidata_qids.py
    python backend/scripts/curate_wikidata_qids.py --source "CNN"
    python backend/scripts/curate_wikidata_qids.py --missing-only
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import httpx

WIKIDATA_API_URL = "https://www.wikidata.org/w/api.php"
WIKIMEDIA_USER_AGENT = "ScoopNewsWikidataCurator/1.0 (https://github.com/anomalyco/Thesis)"
SEARCH_LIMIT = 5


def _load_rss_sources() -> dict[str, Any]:
    sources_path = Path(__file__).resolve().parent.parent / "app" / "data" / "rss_sources.json"
    with sources_path.open("r", encoding="utf-8") as f:
        return json.load(f)


def resolve_package_root() -> str:
    return str(Path(__file__).resolve().parent.parent)


def _load_numpy() -> Any:
    try:
        import numpy as np

        return np
    except ImportError:
        return None


def _get_embedding(text: str) -> Any | None:
    """Get embedding via the project's vector store if available."""
    np = _load_numpy()
    if np is None:
        return None
    try:
        sys.path.insert(0, resolve_package_root())
        from app.vector_store import get_vector_store

        vs = get_vector_store()
        if vs is not None and hasattr(vs, "embedding_model"):
            emb = vs.embedding_model.encode([text])
            return np.array(emb[0])
    except Exception:
        pass
    return None


def cosine_similarity(a: Any, b: Any) -> float:
    if a is None or b is None:
        return 0.0
    try:
        np = _load_numpy()
        if np is None:
            return 0.0
        a_norm = np.linalg.norm(a)
        b_norm = np.linalg.norm(b)
        if a_norm == 0 or b_norm == 0:
            return 0.0
        return float(np.dot(a, b) / (a_norm * b_norm))
    except Exception:
        return 0.0


def _normalize(value: str) -> str:
    return " ".join(value.lower().strip().split())


async def search_wikidata(name: str, http_client: httpx.AsyncClient) -> list[dict[str, Any]]:
    response = await http_client.get(
        WIKIDATA_API_URL,
        params={
            "action": "wbsearchentities",
            "search": name,
            "language": "en",
            "limit": SEARCH_LIMIT,
            "type": "item",
            "format": "json",
        },
        headers={"User-Agent": WIKIMEDIA_USER_AGENT},
    )
    if response.status_code != 200:
        return []
    return response.json().get("search") or []


def _candidate_entry(
    candidate: dict[str, Any], embed_source: Any | None
) -> dict[str, Any]:
    label = candidate.get("label") or candidate.get("display", {}).get("label", {}).get(
        "value", ""
    )
    description = candidate.get("description") or ""
    qid = candidate.get("id") or ""
    url = candidate.get("concepturi") or f"https://www.wikidata.org/wiki/{qid}" if qid else ""
    sim = cosine_similarity(embed_source, _get_embedding(f"{label} {description}"))
    return {
        "qid": qid,
        "label": label,
        "description": description,
        "url": url,
        "similarity": round(sim, 4),
    }


def _best_candidate_action(similarity: float) -> str:
    if similarity > 0.85:
        return "auto_candidate"
    if similarity > 0.5:
        return "review"
    return "needs_manual"


async def curate_source(
    source_name: str,
    config: dict[str, Any],
    http_client: httpx.AsyncClient,
    existing_qid: str | None,
    embed_source: Any | None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "source_name": source_name,
        "existing_qid": existing_qid,
        "country": config.get("country", ""),
        "site_url": config.get("site_url", ""),
        "candidates": [],
        "best_candidate_qid": None,
        "best_candidate_label": None,
        "best_candidate_score": 0.0,
        "action": "review",
    }

    if existing_qid:
        result["action"] = "already_tagged"
        return result

    candidates = await search_wikidata(source_name, http_client)
    if not candidates:
        result["action"] = "no_candidates"
        return result

    result["candidates"] = [_candidate_entry(candidate, embed_source) for candidate in candidates]

    if result["candidates"]:
        best = max(result["candidates"], key=lambda c: c["similarity"])
        result["best_candidate_qid"] = best["qid"]
        result["best_candidate_label"] = best["label"]
        result["best_candidate_score"] = best["similarity"]
        result["action"] = _best_candidate_action(best["similarity"])

    return result


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Curate Wikidata QIDs for RSS sources using embedding disambiguation"
    )
    parser.add_argument("--source", type=str, default=None, help="Curate a single source by name")
    parser.add_argument(
        "--missing-only",
        action="store_true",
        help="Only review sources that have no wikidata_qid",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Write JSON output to file (default: stdout)",
    )
    parser.add_argument(
        "--top",
        type=int,
        default=50,
        help="Limit to top N sources (default: 50, 0 = all)",
    )
    return parser.parse_args()


def _select_unique_sources(
    sources: dict[str, Any], *, missing_only: bool
) -> dict[str, dict[str, Any]]:
    unique_sources: dict[str, dict[str, Any]] = {}
    for name, config in sources.items():
        base_name = name.split(" - ")[0].strip()
        existing_qid = config.get("wikidata_qid")
        if missing_only and existing_qid:
            continue
        if base_name not in unique_sources:
            unique_sources[base_name] = {
                "config": config,
                "existing_qid": existing_qid,
            }
    return unique_sources


def _embedding_map(items: list[tuple[str, dict[str, Any]]]) -> dict[str, Any | None]:
    embed_map: dict[str, Any | None] = {}
    for source_name, entry in items:
        config = entry["config"]
        description = (
            f"{source_name} {config.get('country', '')} {config.get('ownership_label', '')}"
        )
        embed_map[source_name] = _get_embedding(description)
    return embed_map


def _actions_summary(results: list[dict[str, Any]]) -> dict[str, int]:
    return {
        action: sum(1 for r in results if r["action"] == action)
        for action in (
            "already_tagged",
            "no_candidates",
            "auto_candidate",
            "review",
            "needs_manual",
            "error",
        )
    }


async def _curate_all(
    items: list[tuple[str, dict[str, Any]]],
    embed_map: dict[str, Any | None],
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=20.0) as client:
        for source_name, entry in items:
            config = entry["config"]
            existing_qid = entry["existing_qid"]
            try:
                results.append(
                    await curate_source(
                        source_name=source_name,
                        config=config,
                        http_client=client,
                        existing_qid=existing_qid,
                        embed_source=embed_map.get(source_name),
                    )
                )
            except Exception as exc:
                results.append(
                    {
                        "source_name": source_name,
                        "existing_qid": existing_qid,
                        "action": "error",
                        "error": str(exc),
                    }
                )
    return results


async def main() -> None:
    args = _parse_args()

    sources = _load_rss_sources()
    if args.source:
        if args.source not in sources:
            print(f"Source '{args.source}' not found in rss_sources.json")
            return
        sources = {args.source: sources[args.source]}

    unique_sources = _select_unique_sources(sources, missing_only=args.missing_only)
    items = sorted(unique_sources.items())
    if args.top > 0:
        items = items[: args.top]

    embed_map = _embedding_map(items)
    results = await _curate_all(items, embed_map)

    output = {
        "total_sources": len(results),
        "actions_summary": _actions_summary(results),
        "results": results,
    }

    if args.output:
        Path(args.output).write_text(json.dumps(output, indent=2), encoding="utf-8")
        print(f"Results written to {args.output}")
    else:
        print(json.dumps(output, indent=2))


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
