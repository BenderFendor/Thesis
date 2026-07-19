"""Durable story lineage construction from topic cluster evidence."""

from __future__ import annotations

import hashlib
import re
from datetime import datetime
from typing import Any, cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import (
    Article,
    ArticleEdge,
    ClaimEdge,
    Correction,
    ExtractedClaim,
    StoryCluster,
    get_utc_now,
)

WIRE_SOURCES = {"ap", "associated press", "reuters", "afp", "agence france-presse"}
STOP_WORDS = {
    "about",
    "after",
    "again",
    "against",
    "also",
    "among",
    "and",
    "are",
    "article",
    "because",
    "been",
    "before",
    "being",
    "between",
    "from",
    "have",
    "into",
    "more",
    "news",
    "over",
    "said",
    "says",
    "that",
    "the",
    "their",
    "this",
    "through",
    "under",
    "will",
    "with",
    "would",
}


def _parse_dt(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _tokens(text: str) -> set[str]:
    return {token for token in re.findall(r"[a-z0-9]{3,}", text.lower()) if token not in STOP_WORDS}


def _text_similarity(left: str, right: str) -> float:
    left_tokens = _tokens(left)
    right_tokens = _tokens(right)
    if not left_tokens or not right_tokens:
        return 0.0
    return len(left_tokens & right_tokens) / len(left_tokens | right_tokens)


def _article_text(article: dict[str, Any]) -> str:
    return " ".join(
        str(article.get(key) or "")
        for key in ("title", "summary", "content")
        if isinstance(article.get(key), str)
    )


def _is_wire_source(source: str) -> bool:
    normalized = source.lower()
    return any(wire in normalized for wire in WIRE_SOURCES)


def _numbers(text: str) -> list[str]:
    return re.findall(r"\b\d+(?:[.,]\d+)?%?\b", text)


def _normalize_claim(text: str) -> str:
    normalized = re.sub(r"\s+", " ", text.lower()).strip()
    normalized = re.sub(r"[^a-z0-9 %.,'-]", "", normalized)
    return normalized[:500]


def _claim_hash(normalized_claim: str) -> str:
    return hashlib.sha256(normalized_claim.encode("utf-8")).hexdigest()[:24]


def _claim_type(text: str) -> str:
    lower = text.lower()
    if '"' in text or "'" in text:
        return "quote"
    if any(term in lower for term in ("lawsuit", "court", "judge", "ruling", "legal")):
        return "legal"
    if any(term in lower for term in ("budget", "inflation", "market", "jobs", "workers")):
        return "economic"
    if _numbers(text):
        return "number"
    return "general"


def _claim_candidates(article: dict[str, Any]) -> list[str]:
    text = _article_text(article)
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]
    candidates: list[str] = []
    for sentence in sentences[:8]:
        if len(sentence) < 35:
            continue
        if (
            _numbers(sentence)
            or '"' in sentence
            or any(
                term in sentence.lower()
                for term in ("said", "announced", "reported", "confirmed", "denied", "ruling")
            )
        ):
            candidates.append(sentence[:500])
    return candidates[:4]


def _edge_relation(
    origin: dict[str, Any], target: dict[str, Any]
) -> tuple[str, float, dict[str, Any]]:
    origin_text = _article_text(origin)
    target_text = _article_text(target)
    similarity = _text_similarity(origin_text, target_text)
    origin_source = str(origin.get("source") or "")
    target_source = str(target.get("source") or "")
    evidence: dict[str, Any] = {
        "shared_text_similarity": round(similarity, 3),
        "origin_source": origin_source,
        "target_source": target_source,
    }
    if origin_source == target_source:
        return "updates", max(0.55, similarity), evidence
    if _is_wire_source(origin_source) or _is_wire_source(target_source):
        return "same_wire_story", max(0.65, similarity), evidence
    if similarity >= 0.55:
        return "likely_source", similarity, evidence
    return "later_variant", max(0.35, similarity), evidence


def _cluster_articles(detail: dict[str, Any]) -> list[dict[str, Any]]:
    raw_articles = detail.get("articles") or []
    articles = [article for article in raw_articles if isinstance(article, dict)]
    return sorted(
        articles,
        key=lambda article: _parse_dt(article.get("published_at")) or datetime.max,
    )


async def _upsert_story_cluster(
    session: AsyncSession,
    detail: dict[str, Any],
    articles: list[dict[str, Any]],
) -> StoryCluster:
    cluster_id = int(detail["id"])
    result = await session.execute(
        select(StoryCluster).where(StoryCluster.external_cluster_id == cluster_id)
    )
    story = result.scalars().first()
    first_seen = _parse_dt(detail.get("first_seen"))
    last_seen = _parse_dt(detail.get("last_seen"))
    earliest_article_id = int(articles[0]["id"]) if articles and articles[0].get("id") else None
    if story is None:
        story = StoryCluster(external_cluster_id=cluster_id)
        session.add(story)
    story.label = str(detail.get("label") or "Topic")
    story.keywords = detail.get("keywords") or []
    story.first_seen_at = first_seen
    story.last_seen_at = last_seen
    story.earliest_article_id = earliest_article_id
    story.current_summary = str(detail.get("label") or "")
    story_for_update = cast(Any, story)
    story_for_update.confidence = min(1.0, max(0.1, len({a.get("source") for a in articles}) / 6))
    story.updated_at = get_utc_now()
    await session.flush()
    return story


async def _ensure_article_edges(
    session: AsyncSession,
    story: StoryCluster,
    articles: list[dict[str, Any]],
) -> list[ArticleEdge]:
    if len(articles) < 2:
        return []
    origin = articles[0]
    origin_id = int(origin["id"])
    edges: list[ArticleEdge] = []
    for target in articles[1:]:
        target_id = int(target["id"])
        relation, confidence, evidence = _edge_relation(origin, target)
        result = await session.execute(
            select(ArticleEdge).where(
                ArticleEdge.story_cluster_id == story.id,
                ArticleEdge.from_article_id == origin_id,
                ArticleEdge.to_article_id == target_id,
                ArticleEdge.relation == relation,
            )
        )
        edge = result.scalars().first()
        if edge is None:
            edge = ArticleEdge(
                story_cluster_id=story.id,
                from_article_id=origin_id,
                to_article_id=target_id,
                relation=relation,
            )
            session.add(edge)
        edge.evidence = evidence
        edge_for_update = cast(Any, edge)
        edge_for_update.confidence = round(float(confidence), 3)
        edges.append(edge)
    await session.flush()
    return edges


async def _ensure_claims(
    session: AsyncSession,
    story: StoryCluster,
    articles: list[dict[str, Any]],
) -> list[ExtractedClaim]:
    claims: list[ExtractedClaim] = []
    for article in articles:
        article_id = int(article["id"])
        for claim_text in _claim_candidates(article):
            normalized = _normalize_claim(claim_text)
            claim_hash = _claim_hash(normalized)
            result = await session.execute(
                select(ExtractedClaim).where(
                    ExtractedClaim.article_id == article_id,
                    ExtractedClaim.claim_hash == claim_hash,
                )
            )
            claim = result.scalars().first()
            if claim is None:
                claim = ExtractedClaim(
                    story_cluster_id=story.id,
                    article_id=article_id,
                    claim_hash=claim_hash,
                )
                session.add(claim)
            claim.claim_text = claim_text
            claim.normalized_claim = normalized
            claim.claim_type = _claim_type(claim_text)
            claim.checkability = "high" if _numbers(claim_text) else "medium"
            claim.evidence_span = claim_text
            claim.entities = []
            claim.numbers = _numbers(claim_text)
            claims.append(claim)
    await session.flush()
    return claims


def _claim_relation(left: ExtractedClaim, right: ExtractedClaim) -> tuple[str, float] | None:
    if left.article_id == right.article_id:
        return None
    left_normalized = left.normalized_claim or ""
    right_normalized = right.normalized_claim or ""
    similarity = _text_similarity(left_normalized, right_normalized)
    if similarity < 0.35:
        return None
    left_numbers = set(left.numbers or [])
    right_numbers = set(right.numbers or [])
    if left_numbers and right_numbers and left_numbers != right_numbers:
        return ("contradicts", max(0.65, similarity))
    if similarity >= 0.72:
        return ("equivalent", similarity)
    return ("supports", similarity)


async def _ensure_claim_edges(
    session: AsyncSession,
    story: StoryCluster,
    claims: list[ExtractedClaim],
) -> list[ClaimEdge]:
    edges: list[ClaimEdge] = []
    for index, left in enumerate(claims):
        for right in claims[index + 1 :]:
            relation = _claim_relation(left, right)
            if relation is None:
                continue
            relation_name, confidence = relation
            result = await session.execute(
                select(ClaimEdge).where(
                    ClaimEdge.story_cluster_id == story.id,
                    ClaimEdge.from_claim_id == left.id,
                    ClaimEdge.to_claim_id == right.id,
                    ClaimEdge.relation == relation_name,
                )
            )
            edge = result.scalars().first()
            if edge is None:
                edge = ClaimEdge(
                    story_cluster_id=story.id,
                    from_claim_id=left.id,
                    to_claim_id=right.id,
                    relation=relation_name,
                )
                session.add(edge)
            edge_for_update = cast(Any, edge)
            edge_for_update.confidence = round(float(confidence), 3)
            edge.evidence = {
                "left_claim": left.claim_text,
                "right_claim": right.claim_text,
            }
            edges.append(edge)
    await session.flush()
    return edges


async def _corrections_for_story(
    session: AsyncSession,
    story: StoryCluster,
) -> list[Correction]:
    result = await session.execute(
        select(Correction).where(
            Correction.corrected_claim_id.in_(
                select(ExtractedClaim.id).where(ExtractedClaim.story_cluster_id == story.id)
            )
        )
    )
    corrections = list(result.scalars().all())
    if corrections:
        return corrections
    article_result = await session.execute(
        select(Correction).where(Correction.article_id == story.earliest_article_id)
    )
    return list(article_result.scalars().all())


async def build_story_lineage(
    session: AsyncSession,
    detail: dict[str, Any],
) -> dict[str, Any]:
    """Promote a topic cluster into durable lineage tables and return a graph."""
    articles = _cluster_articles(detail)
    if not articles:
        return {
            "status": "insufficient_data",
            "reason": "Cluster has no articles.",
            "story": None,
            "article_edges": [],
            "claims": [],
            "claim_edges": [],
            "corrections": [],
        }

    article_ids = [int(article["id"]) for article in articles if article.get("id") is not None]
    existing_result = await session.execute(select(Article.id).where(Article.id.in_(article_ids)))
    existing_ids = set(existing_result.scalars().all())
    usable_articles = [article for article in articles if int(article["id"]) in existing_ids]
    if not usable_articles:
        usable_articles = articles

    story = await _upsert_story_cluster(session, detail, usable_articles)
    article_edges = await _ensure_article_edges(session, story, usable_articles)
    claims = await _ensure_claims(session, story, usable_articles)
    claim_edges = await _ensure_claim_edges(session, story, claims)
    corrections = await _corrections_for_story(session, story)

    article_lookup = {int(article["id"]): article for article in usable_articles}
    return {
        "status": "ok",
        "reason": None,
        "story": {
            "id": story.id,
            "external_cluster_id": story.external_cluster_id,
            "label": story.label,
            "keywords": story.keywords or [],
            "first_seen_at": story.first_seen_at.isoformat() if story.first_seen_at else None,
            "last_seen_at": story.last_seen_at.isoformat() if story.last_seen_at else None,
            "earliest_article_id": story.earliest_article_id,
            "current_summary": story.current_summary,
            "confidence": story.confidence,
        },
        "article_edges": [
            {
                "id": edge.id,
                "from_article_id": edge.from_article_id,
                "to_article_id": edge.to_article_id,
                "from_title": str(
                    article_lookup.get(int(edge.from_article_id or 0), {}).get("title") or ""
                ),
                "to_title": str(
                    article_lookup.get(int(edge.to_article_id or 0), {}).get("title") or ""
                ),
                "relation": edge.relation,
                "evidence": edge.evidence or {},
                "confidence": edge.confidence,
            }
            for edge in article_edges
        ],
        "claims": [
            {
                "id": claim.id,
                "article_id": claim.article_id,
                "claim_text": claim.claim_text,
                "claim_type": claim.claim_type,
                "checkability": claim.checkability,
                "evidence_span": claim.evidence_span,
                "numbers": claim.numbers or [],
            }
            for claim in claims
        ],
        "claim_edges": [
            {
                "id": edge.id,
                "from_claim_id": edge.from_claim_id,
                "to_claim_id": edge.to_claim_id,
                "relation": edge.relation,
                "evidence": edge.evidence or {},
                "confidence": edge.confidence,
            }
            for edge in claim_edges
        ],
        "corrections": [
            {
                "id": correction.id,
                "source": correction.source,
                "article_id": correction.article_id,
                "correction_url": correction.correction_url,
                "correction_text": correction.correction_text,
                "corrected_claim_id": correction.corrected_claim_id,
                "downstream_article_ids": correction.downstream_article_ids or [],
                "published_at": correction.published_at.isoformat()
                if correction.published_at
                else None,
            }
            for correction in corrections
        ],
    }
