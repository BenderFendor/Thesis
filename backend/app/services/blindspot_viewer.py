"""Build blindspot viewer payloads from precomputed cluster snapshots."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Callable, Literal, Mapping, Optional, TypedDict, cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.data.rss_sources import get_rss_sources
from app.database import Article, get_utc_now
from app.services.cluster_cache import get_latest_snapshot
from app.vector_store import _get_chroma_include, _get_embedding_rows, get_vector_store

logger = logging.getLogger(__name__)

LensId = Literal["bias", "credibility", "geography", "institutional_populist"]
LaneId = Literal["pole_a", "shared", "pole_b"]
BucketId = Literal["pole_a", "shared", "pole_b"]

MIN_CLUSTER_ARTICLES = 3
MIN_CLUSTER_SOURCES = 4
DEFAULT_PER_LANE = 10
BLINDSPOT_SHARE_GAP = 0.35

GLOBAL_NORTH_COUNTRY_CODES = {
    "US",
    "CA",
    "GB",
    "IE",
    "AU",
    "NZ",
    "FR",
    "DE",
    "IT",
    "ES",
    "PT",
    "NL",
    "BE",
    "CH",
    "AT",
    "SE",
    "NO",
    "DK",
    "FI",
    "IS",
    "LU",
    "JP",
    "KR",
    "SG",
    "TW",
    "HK",
    "IL",
}

INSTITUTIONAL_POLE_WORDS = [
    "institution",
    "official",
    "ministry",
    "regulator",
    "authority",
    "policy",
    "diplomat",
    "government",
    "cabinet",
    "parliament",
]

POPULIST_POLE_WORDS = [
    "grassroots",
    "outsider",
    "protest",
    "worker",
    "crowd",
    "local",
    "movement",
    "insurgent",
    "activist",
    "people",
]


class SnapshotArticlePayload(TypedDict, total=False):
    id: int
    title: str
    source: str
    source_id: Optional[str]
    url: str
    image_url: Optional[str]
    published_at: Optional[str]
    summary: Optional[str]
    similarity: float
    country: Optional[str]
    source_country: Optional[str]
    category: Optional[str]
    bias: Optional[str]
    credibility: Optional[str]
    geo: dict[str, Any]
    baseline: dict[str, Any]


class SnapshotClusterPayload(TypedDict, total=False):
    cluster_id: int
    label: Optional[str]
    keywords: list[str]
    article_count: int
    source_diversity: int
    representative_article: Optional[SnapshotArticlePayload]
    articles: list[SnapshotArticlePayload]


class BlindspotLensPayload(TypedDict):
    id: LensId
    label: str
    description: str
    available: bool
    unavailable_reason: Optional[str]


class BlindspotLanePayload(TypedDict):
    id: LaneId
    label: str
    description: str
    cluster_count: int


class BlindspotCoveragePayload(TypedDict):
    pole_a: int
    shared: int
    pole_b: int


class BlindspotSharePayload(TypedDict):
    pole_a: float
    shared: float
    pole_b: float


class BlindspotGeoSignalPayload(TypedDict):
    id: str
    label: str
    count: int


class BlindspotCardPayload(TypedDict):
    cluster_id: int
    cluster_label: str
    keywords: list[str]
    article_count: int
    source_count: int
    lane: LaneId
    blindspot_score: float
    balance_score: float
    published_at: Optional[str]
    explanation: str
    coverage_counts: BlindspotCoveragePayload
    coverage_shares: BlindspotSharePayload
    representative_article: Optional[SnapshotArticlePayload]
    articles: list[SnapshotArticlePayload]
    geography_signals: list[BlindspotGeoSignalPayload]


class BlindspotSummaryPayload(TypedDict):
    window: str
    total_clusters: int
    eligible_clusters: int
    generated_at: str
    category: Optional[str]
    source_filters: list[str]


class BlindspotViewerPayload(TypedDict):
    available_lenses: list[BlindspotLensPayload]
    selected_lens: BlindspotLensPayload
    summary: BlindspotSummaryPayload
    lanes: list[BlindspotLanePayload]
    cards: list[BlindspotCardPayload]
    status: str


@dataclass(frozen=True)
class LensDefinition:
    id: LensId
    label: str
    description: str
    pole_a_name: str
    pole_b_name: str
    pole_a_lane_label: str
    pole_a_lane_description: str
    shared_lane_label: str
    shared_lane_description: str
    pole_b_lane_label: str
    pole_b_lane_description: str


@dataclass(frozen=True)
class ClusterCardCandidate:
    payload: BlindspotCardPayload
    lane_sort_score: float


class SourceCatalogEntry(TypedDict, total=False):
    country: str
    bias_rating: str
    factual_reporting: str


def _slugify_source_name(value: str) -> str:
    return "-".join(value.lower().split())


def _article_value(article: Any, key: str, default: Any = None) -> Any:
    if isinstance(article, Mapping):
        return article.get(key, default)
    return getattr(article, key, default)


def _has_text(value: Any) -> bool:
    return isinstance(value, str) and value.strip() != ""


def _article_source_name(article: Any) -> str:
    source = _article_value(article, "source")
    if _has_text(source):
        return cast(str, source)
    return "unknown-source"


def _normalize_source_filter_values(values: Optional[str]) -> set[str]:
    if values is None or values.strip() == "":
        return set()
    return {
        candidate.strip().lower()
        for candidate in values.split(",")
        if candidate.strip()
    }


def _source_aliases(article: Any) -> set[str]:
    source_name = _article_source_name(article)
    aliases = {source_name.lower(), _slugify_source_name(source_name)}
    source_id = _article_value(article, "source_id")
    if _has_text(source_id):
        aliases.add(cast(str, source_id).strip().lower())
    return aliases


def _matches_selected_sources(article: Any, selected_sources: set[str]) -> bool:
    if not selected_sources:
        return True
    return bool(_source_aliases(article) & selected_sources)


def _matches_category(article: Any, category: Optional[str]) -> bool:
    if category is None or category == "" or category == "all":
        return True
    article_category = _article_value(article, "category")
    return (
        isinstance(article_category, str)
        and article_category.lower() == category.lower()
    )


@lru_cache(maxsize=1)
def _source_catalog_lookup() -> dict[str, SourceCatalogEntry]:
    lookup: dict[str, SourceCatalogEntry] = {}
    for source_name, config in get_rss_sources().items():
        entry: SourceCatalogEntry = {
            "country": str(config.get("country", "")).strip().upper(),
            "bias_rating": str(config.get("bias_rating", "")).strip(),
            "factual_reporting": str(config.get("factual_reporting", "")).strip(),
        }
        lookup[source_name.lower()] = entry
        lookup[_slugify_source_name(source_name)] = entry
    return lookup


def _source_catalog_entry(article: Any) -> Optional[SourceCatalogEntry]:
    lookup = _source_catalog_lookup()
    source_name = _article_source_name(article)
    candidate_keys = [source_name.lower(), _slugify_source_name(source_name)]
    source_id = _article_value(article, "source_id")
    if _has_text(source_id):
        candidate_keys.insert(0, cast(str, source_id).strip().lower())
    for key in candidate_keys:
        entry = lookup.get(key)
        if entry is not None:
            return entry
    return None


def _article_bias_value(article: Any) -> Optional[str]:
    bias = _article_value(article, "bias")
    if _has_text(bias):
        return cast(str, bias)
    source_entry = _source_catalog_entry(article)
    if source_entry is None:
        return None
    return source_entry.get("bias_rating")


def _article_factual_reporting_value(article: Any) -> Optional[str]:
    credibility = _article_value(article, "credibility")
    if _has_text(credibility):
        return cast(str, credibility)
    source_entry = _source_catalog_entry(article)
    if source_entry is None:
        return None
    return source_entry.get("factual_reporting")


def _article_country_code(article: Any) -> Optional[str]:
    source_country = _article_value(article, "source_country")
    if _has_text(source_country):
        return cast(str, source_country)

    country = _article_value(article, "country")
    if _has_text(country):
        return cast(str, country)

    for container_name in ("geo", "geography", "baseline", "geo_baseline"):
        container = _article_value(article, container_name)
        if not isinstance(container, Mapping):
            continue
        for key in (
            "source_country",
            "baseline_country",
            "country_code",
            "country",
        ):
            value = container.get(key)
            if _has_text(value):
                return cast(str, value)

    source_entry = _source_catalog_entry(article)
    if source_entry is None:
        return None
    return source_entry.get("country")


def _geography_signal(article: Any) -> Optional[BlindspotGeoSignalPayload]:
    source_country = _article_value(article, "source_country")
    if _has_text(source_country):
        return {
            "id": "source_country",
            "label": "Source country",
            "count": 1,
        }

    for container_name in ("geo", "geography"):
        container = _article_value(article, container_name)
        if not isinstance(container, Mapping):
            continue
        for key in ("source_country", "country_code"):
            value = container.get(key)
            if _has_text(value):
                return {
                    "id": "source_country",
                    "label": "Source country",
                    "count": 1,
                }

    for container_name in ("baseline", "geo_baseline"):
        container = _article_value(article, container_name)
        if not isinstance(container, Mapping):
            continue
        for key in ("baseline_country", "country_code", "country"):
            value = container.get(key)
            if _has_text(value):
                return {
                    "id": "baseline_country",
                    "label": "Baseline country",
                    "count": 1,
                }

    country = _article_value(article, "country")
    if _has_text(country):
        return {
            "id": "country",
            "label": "Article country",
            "count": 1,
        }
    return None


def _bias_bucket(article: Article) -> Optional[BucketId]:
    normalized = (_article_bias_value(article) or "").strip().lower()
    if normalized in {"left", "left-center", "center-left"}:
        return "pole_a"
    if normalized == "center":
        return "shared"
    if normalized in {"right", "right-center", "center-right", "libertarian"}:
        return "pole_b"
    return None


def _credibility_bucket(article: Article) -> Optional[BucketId]:
    normalized = (_article_factual_reporting_value(article) or "").strip().lower()
    if normalized in {"very-high", "high"}:
        return "pole_a"
    if normalized in {
        "",
        "unknown",
        "mixed",
        "mostly-factual",
        "mostly factual",
        "medium",
    }:
        return "shared"
    if normalized in {"low", "very-low"}:
        return "pole_b"
    return None


def _geography_bucket(article: Article) -> Optional[BucketId]:
    normalized = (_article_country_code(article) or "").strip().upper()
    if not normalized:
        return None
    if normalized in GLOBAL_NORTH_COUNTRY_CODES:
        return "pole_a"
    return "pole_b"


def _empty_counts() -> BlindspotCoveragePayload:
    return {"pole_a": 0, "shared": 0, "pole_b": 0}


def _shares_from_counts(counts: BlindspotCoveragePayload) -> BlindspotSharePayload:
    total = counts["pole_a"] + counts["shared"] + counts["pole_b"]
    if total <= 0:
        return {"pole_a": 0.0, "shared": 0.0, "pole_b": 0.0}
    return {
        "pole_a": round(counts["pole_a"] / total, 4),
        "shared": round(counts["shared"] / total, 4),
        "pole_b": round(counts["pole_b"] / total, 4),
    }


def classify_lane(counts: BlindspotCoveragePayload) -> LaneId:
    total = counts["pole_a"] + counts["shared"] + counts["pole_b"]
    if total <= 0:
        return "shared"

    shares = _shares_from_counts(counts)
    pole_a_gap = shares["pole_b"] - shares["pole_a"]
    pole_b_gap = shares["pole_a"] - shares["pole_b"]

    if (
        counts["pole_b"] >= 2
        and counts["pole_a"] <= 1
        and pole_a_gap >= BLINDSPOT_SHARE_GAP
    ):
        return "pole_a"
    if (
        counts["pole_a"] >= 2
        and counts["pole_b"] <= 1
        and pole_b_gap >= BLINDSPOT_SHARE_GAP
    ):
        return "pole_b"
    return "shared"


def _lane_score(lane: LaneId, counts: BlindspotCoveragePayload) -> float:
    shares = _shares_from_counts(counts)
    total = counts["pole_a"] + counts["shared"] + counts["pole_b"]
    if lane == "pole_a":
        return round((shares["pole_b"] - shares["pole_a"]) * total, 4)
    if lane == "pole_b":
        return round((shares["pole_a"] - shares["pole_b"]) * total, 4)
    return round(min(shares["pole_a"], shares["pole_b"]) * total, 4)


def _balance_score(counts: BlindspotCoveragePayload) -> float:
    shares = _shares_from_counts(counts)
    return round(min(shares["pole_a"], shares["pole_b"]), 4)


def _article_preview(article: SnapshotArticlePayload) -> SnapshotArticlePayload:
    return {
        "id": article.get("id", 0),
        "title": article.get("title", "Untitled article"),
        "source": article.get("source", "Unknown"),
        "url": article.get("url", ""),
        "image_url": article.get("image_url"),
        "published_at": article.get("published_at"),
        "summary": article.get("summary"),
        "similarity": article.get("similarity", 1.0),
    }


def _choose_representative_article(
    articles: list[SnapshotArticlePayload],
) -> Optional[SnapshotArticlePayload]:
    if not articles:
        return None
    with_image = [article for article in articles if article.get("image_url")]
    return _article_preview(with_image[0] if with_image else articles[0])


def _embedding_text(article: Article) -> str:
    return " ".join(
        part.strip()
        for part in [article.title or "", article.summary or ""]
        if part and part.strip()
    )


def _lens_definitions() -> dict[LensId, LensDefinition]:
    return {
        "bias": LensDefinition(
            id="bias",
            label="Left vs Right",
            description="Compare which story clusters the left, center, and right are covering.",
            pole_a_name="left-leaning",
            pole_b_name="right-leaning",
            pole_a_lane_label="For the Left",
            pole_a_lane_description="Stories getting little or no coverage from left-leaning sources.",
            shared_lane_label="Shared Coverage",
            shared_lane_description="Stories drawing coverage from both poles or from center outlets.",
            pole_b_lane_label="For the Right",
            pole_b_lane_description="Stories getting little or no coverage from right-leaning sources.",
        ),
        "credibility": LensDefinition(
            id="credibility",
            label="Credible vs Uncredible",
            description="Compare higher-trust coverage against mixed or low-factual-reporting coverage, with unknown outlets treated as the middle band.",
            pole_a_name="high-credibility",
            pole_b_name="low-credibility",
            pole_a_lane_label="For High Credibility",
            pole_a_lane_description="Stories showing up on lower-trust outlets while higher-trust coverage stays thin.",
            shared_lane_label="Shared Coverage",
            shared_lane_description="Stories carried across trust tiers or concentrated in the unknown middle band.",
            pole_b_lane_label="For Low Credibility",
            pole_b_lane_description="Stories emphasized by higher-credibility outlets but thin on lower-credibility ones.",
        ),
        "geography": LensDefinition(
            id="geography",
            label="Global North vs Global South",
            description="Compare coverage from source countries grouped into an operational Global North and Global South split.",
            pole_a_name="global-north",
            pole_b_name="global-south",
            pole_a_lane_label="For the Global North",
            pole_a_lane_description="Stories drawing Global South coverage while Global North sources stay thin.",
            shared_lane_label="Shared Coverage",
            shared_lane_description="Stories appearing across both regional blocs.",
            pole_b_lane_label="For the Global South",
            pole_b_lane_description="Stories drawing Global North coverage while Global South sources stay thin.",
        ),
        "institutional_populist": LensDefinition(
            id="institutional_populist",
            label="Institutional vs Populist",
            description="A SemAxis lens over article embeddings that compares establishment framing against grassroots and outsider framing.",
            pole_a_name="institutional",
            pole_b_name="populist",
            pole_a_lane_label="For Institutional",
            pole_a_lane_description="Stories leaning populist in framing while institutional coverage stays thin.",
            shared_lane_label="Shared Coverage",
            shared_lane_description="Stories with mixed framing across the cluster.",
            pole_b_lane_label="For Populist",
            pole_b_lane_description="Stories leaning institutional in framing while populist framing stays thin.",
        ),
    }


def _available_lens_payloads() -> list[BlindspotLensPayload]:
    return [
        {
            "id": definition.id,
            "label": definition.label,
            "description": definition.description,
            "available": True,
            "unavailable_reason": None,
        }
        for definition in _lens_definitions().values()
    ]


def _lane_payloads(
    definition: LensDefinition,
    cards: list[BlindspotCardPayload],
) -> list[BlindspotLanePayload]:
    counts = {"pole_a": 0, "shared": 0, "pole_b": 0}
    for card in cards:
        counts[card["lane"]] += 1

    return [
        {
            "id": "pole_a",
            "label": definition.pole_a_lane_label,
            "description": definition.pole_a_lane_description,
            "cluster_count": counts["pole_a"],
        },
        {
            "id": "shared",
            "label": definition.shared_lane_label,
            "description": definition.shared_lane_description,
            "cluster_count": counts["shared"],
        },
        {
            "id": "pole_b",
            "label": definition.pole_b_lane_label,
            "description": definition.pole_b_lane_description,
            "cluster_count": counts["pole_b"],
        },
    ]


def _build_metadata_counts(
    articles: list[Any],
    bucket_resolver: Callable[[Any], Optional[BucketId]],
) -> BlindspotCoveragePayload:
    counts = _empty_counts()
    seen_sources: set[str] = set()

    for article in articles:
        source_id = _article_value(article, "source_id")
        source_key = (
            cast(str, source_id).strip().lower()
            if _has_text(source_id)
            else _slugify_source_name(_article_source_name(article))
        )
        if source_key in seen_sources:
            continue
        seen_sources.add(source_key)
        bucket = bucket_resolver(article)
        if bucket is None:
            continue
        if bucket == "pole_a":
            counts["pole_a"] += 1
        elif bucket == "shared":
            counts["shared"] += 1
        else:
            counts["pole_b"] += 1

    return counts


def _explanation_for_lane(
    definition: LensDefinition,
    lane: LaneId,
    counts: BlindspotCoveragePayload,
) -> str:
    if lane == "pole_a":
        return (
            f"{counts['pole_b']} {definition.pole_b_name} sources covered this story "
            f"versus {counts['pole_a']} {definition.pole_a_name} sources."
        )
    if lane == "pole_b":
        return (
            f"{counts['pole_a']} {definition.pole_a_name} sources covered this story "
            f"versus {counts['pole_b']} {definition.pole_b_name} sources."
        )
    return (
        f"{counts['pole_a']} {definition.pole_a_name}, {counts['shared']} shared, and "
        f"{counts['pole_b']} {definition.pole_b_name} sources covered this story."
    )


def _mean_vector(vectors: list[list[float]]) -> list[float]:
    if not vectors:
        return []
    dimension = len(vectors[0])
    totals = [0.0] * dimension
    for vector in vectors:
        for index, value in enumerate(vector):
            totals[index] += float(value)
    count = float(len(vectors))
    return [value / count for value in totals]


def _subtract_vectors(left: list[float], right: list[float]) -> list[float]:
    return [left[index] - right[index] for index in range(min(len(left), len(right)))]


def _normalize_vector(vector: list[float]) -> list[float]:
    magnitude = sum(value * value for value in vector) ** 0.5
    if magnitude <= 0:
        return []
    return [value / magnitude for value in vector]


def _dot_product(left: list[float], right: list[float]) -> float:
    return sum(left_value * right_value for left_value, right_value in zip(left, right))


def _coerce_embedding_rows(raw_rows: object) -> list[list[float]]:
    rows = cast(list[object], raw_rows)
    vectors: list[list[float]] = []
    for row in rows:
        to_list = getattr(row, "tolist", None)
        if callable(to_list):
            values = cast(list[float], to_list())
            vectors.append([float(value) for value in values])
            continue
        if isinstance(row, list):
            vectors.append([float(value) for value in row])
    return vectors


def _quantile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * percentile
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


async def _load_embeddings_for_articles(
    articles_by_id: Mapping[int, Any],
) -> Optional[dict[int, list[float]]]:
    vector_store = get_vector_store()
    if vector_store is None:
        return None

    article_ids = list(articles_by_id.keys())
    chroma_ids = [f"article_{article_id}" for article_id in article_ids]
    embeddings: dict[int, list[float]] = {}
    try:
        payload = vector_store.collection.get(
            ids=chroma_ids,
            include=_get_chroma_include("embeddings"),
        )
        embedded_ids = cast(list[str], payload.get("ids") or [])
        embedded_rows = _coerce_embedding_rows(_get_embedding_rows(payload))

        for chroma_id, vector in zip(embedded_ids, embedded_rows):
            if not chroma_id.startswith("article_"):
                continue
            article_id = int(chroma_id.replace("article_", ""))
            embeddings[article_id] = vector
    except Exception as exc:  # pragma: no cover - live Chroma boundary
        logger.warning(
            "Blindspot SemAxis falling back to on-demand embeddings after Chroma get failed: %s",
            exc,
        )

    missing_articles = [
        article
        for article_id, article in articles_by_id.items()
        if article_id not in embeddings
    ]
    if not missing_articles:
        return embeddings

    articles_to_encode = [
        article for article in missing_articles if _embedding_text(article) != ""
    ]
    if not articles_to_encode:
        return embeddings

    try:
        encoded = vector_store.embedding_model.encode(
            [_embedding_text(article) for article in articles_to_encode],
            batch_size=max(1, min(32, len(articles_to_encode))),
            show_progress_bar=False,
            convert_to_numpy=False,
        )
        encoded_rows = _coerce_embedding_rows(encoded)
    except Exception as exc:  # pragma: no cover - live embedding boundary
        logger.warning(
            "Blindspot SemAxis could not generate on-demand embeddings: %s",
            exc,
        )
        return embeddings or None

    for article, vector in zip(articles_to_encode, encoded_rows):
        encoded_article_id: Any = getattr(article, "id", None)
        if encoded_article_id is None:
            continue
        embeddings[int(encoded_article_id)] = vector

    return embeddings


async def _build_semaxis_counts_by_cluster(
    filtered_cluster_articles: Mapping[int, list[Any]],
) -> tuple[dict[int, BlindspotCoveragePayload], Optional[str]]:
    all_articles = {
        int(getattr(article, "id")): article
        for articles in filtered_cluster_articles.values()
        for article in articles
        if getattr(article, "id", None) is not None
    }
    if not all_articles:
        return {}, "No articles were available for semantic scoring."

    embeddings_by_article = await _load_embeddings_for_articles(all_articles)
    if not embeddings_by_article:
        return {}, "Stored embeddings were unavailable for the SemAxis lens."

    vector_store = get_vector_store()
    if vector_store is None:
        return {}, "Stored embeddings were unavailable for the SemAxis lens."

    try:
        positive_encoded = vector_store.embedding_model.encode(
            INSTITUTIONAL_POLE_WORDS,
            batch_size=len(INSTITUTIONAL_POLE_WORDS),
            show_progress_bar=False,
            convert_to_numpy=False,
        )
        negative_encoded = vector_store.embedding_model.encode(
            POPULIST_POLE_WORDS,
            batch_size=len(POPULIST_POLE_WORDS),
            show_progress_bar=False,
            convert_to_numpy=False,
        )
    except Exception as exc:  # pragma: no cover - live embedding boundary
        logger.warning(
            "Blindspot SemAxis pole-word embedding generation failed: %s",
            exc,
        )
        return {}, "The SemAxis lens is temporarily unavailable."

    positive_vectors = _coerce_embedding_rows(positive_encoded)
    negative_vectors = _coerce_embedding_rows(negative_encoded)
    axis_vector = _normalize_vector(
        _subtract_vectors(
            _mean_vector(positive_vectors), _mean_vector(negative_vectors)
        )
    )
    if not axis_vector:
        return {}, "Semantic axis construction failed for the SemAxis lens."

    source_scores_by_cluster: dict[int, dict[str, float]] = {}
    all_source_scores: list[float] = []

    for cluster_id, articles in filtered_cluster_articles.items():
        scores_by_source: dict[str, list[float]] = {}
        for article in articles:
            article_id = getattr(article, "id", None)
            if article_id is None:
                continue
            vector = embeddings_by_article.get(article_id)
            if vector is None:
                continue
            normalized = _normalize_vector(vector)
            if not normalized:
                continue
            source_id = _article_value(article, "source_id")
            source_key = (
                cast(str, source_id).strip().lower()
                if _has_text(source_id)
                else _slugify_source_name(_article_source_name(article))
            )
            scores_by_source.setdefault(source_key, []).append(
                _dot_product(normalized, axis_vector)
            )

        averaged_scores: dict[str, float] = {
            source_key: sum(values) / len(values)
            for source_key, values in scores_by_source.items()
            if values
        }
        if averaged_scores:
            source_scores_by_cluster[cluster_id] = averaged_scores
            all_source_scores.extend(averaged_scores.values())

    if len(all_source_scores) < MIN_CLUSTER_SOURCES:
        return {}, "Not enough embedded sources were available for the SemAxis lens."

    low_threshold = _quantile(all_source_scores, 0.3)
    high_threshold = _quantile(all_source_scores, 0.7)
    counts_by_cluster: dict[int, BlindspotCoveragePayload] = {}

    for cluster_id, averaged_scores_by_source in source_scores_by_cluster.items():
        counts = _empty_counts()
        for score in averaged_scores_by_source.values():
            if score <= low_threshold:
                counts["pole_b"] += 1
            elif score >= high_threshold:
                counts["pole_a"] += 1
            else:
                counts["shared"] += 1
        counts_by_cluster[cluster_id] = counts

    return counts_by_cluster, None


def _metadata_counts_for_lens(
    lens: LensId,
    articles: list[Any],
) -> BlindspotCoveragePayload:
    if lens == "bias":
        return _build_metadata_counts(articles, _bias_bucket)
    if lens == "credibility":
        return _build_metadata_counts(articles, _credibility_bucket)
    if lens == "geography":
        return _build_metadata_counts(articles, _geography_bucket)
    return _empty_counts()


def _geography_signals_for_articles(
    articles: list[Any],
) -> list[BlindspotGeoSignalPayload]:
    counts: dict[str, int] = {}
    labels: dict[str, str] = {}
    for article in articles:
        signal = _geography_signal(article)
        if signal is None:
            continue
        counts[signal["id"]] = counts.get(signal["id"], 0) + 1
        labels[signal["id"]] = signal["label"]

    ordered_ids = ["source_country", "baseline_country", "country"]
    return [
        {
            "id": signal_id,
            "label": labels[signal_id],
            "count": counts[signal_id],
        }
        for signal_id in ordered_ids
        if signal_id in counts
    ]


class BlindspotViewerService:
    """Build a multi-lens blindspot viewer payload from topic snapshots."""

    async def build_viewer(
        self,
        session: AsyncSession,
        *,
        lens: LensId,
        window: str,
        category: Optional[str] = None,
        sources: Optional[str] = None,
        per_lane: int = DEFAULT_PER_LANE,
    ) -> BlindspotViewerPayload:
        definitions = _lens_definitions()
        selected_definition = definitions[lens]
        selected_sources = _normalize_source_filter_values(sources)

        snapshot = await get_latest_snapshot(session, window)
        if snapshot is None:
            return {
                "available_lenses": _available_lens_payloads(),
                "selected_lens": {
                    "id": selected_definition.id,
                    "label": selected_definition.label,
                    "description": selected_definition.description,
                    "available": False,
                    "unavailable_reason": "Topic clusters are still initializing.",
                },
                "summary": {
                    "window": window,
                    "total_clusters": 0,
                    "eligible_clusters": 0,
                    "generated_at": get_utc_now().isoformat(),
                    "category": category,
                    "source_filters": sorted(selected_sources),
                },
                "lanes": _lane_payloads(selected_definition, []),
                "cards": [],
                "status": "initializing",
            }

        cluster_payloads = cast(
            list[SnapshotClusterPayload], snapshot.clusters_json or []
        )
        snapshot_articles_by_id: dict[int, SnapshotArticlePayload] = {}
        for cluster in cluster_payloads:
            for article in cluster.get("articles", []):
                article_id = article.get("id")
                if isinstance(article_id, int):
                    snapshot_articles_by_id.setdefault(article_id, article)

        article_ids_needing_db: set[int] = set()
        for article_id, article in snapshot_articles_by_id.items():
            if lens == "institutional_populist":
                article_ids_needing_db.add(article_id)
                continue
            if lens == "bias" and _article_bias_value(article) is None:
                article_ids_needing_db.add(article_id)
            elif (
                lens == "credibility"
                and _article_factual_reporting_value(article) is None
            ):
                article_ids_needing_db.add(article_id)
            elif lens == "geography" and _article_country_code(article) is None:
                article_ids_needing_db.add(article_id)
            if category is not None and not _has_text(
                _article_value(article, "category")
            ):
                article_ids_needing_db.add(article_id)

        articles_by_id: dict[int, Article] = {}
        if article_ids_needing_db:
            article_result = await session.execute(
                select(Article).where(Article.id.in_(sorted(article_ids_needing_db)))
            )
            articles_by_id = {
                article.id: article
                for article in article_result.scalars()
                if article.id is not None
            }

        filtered_cluster_articles: dict[int, list[Any]] = {}
        filtered_cluster_previews: dict[int, list[SnapshotArticlePayload]] = {}
        total_clusters = 0

        for cluster in cluster_payloads:
            cluster_id = cluster.get("cluster_id")
            if not isinstance(cluster_id, int):
                continue
            total_clusters += 1
            matching_articles: list[Any] = []
            preview_articles: list[SnapshotArticlePayload] = []

            for article in cluster.get("articles", []):
                article_id = article.get("id")
                if not isinstance(article_id, int):
                    continue
                db_article = articles_by_id.get(article_id)
                materialized_article: Any = db_article or article
                if (
                    category is not None
                    and _article_value(materialized_article, "category") is None
                    and db_article is None
                ):
                    continue
                if not _matches_category(materialized_article, category):
                    continue
                if not _matches_selected_sources(
                    materialized_article, selected_sources
                ):
                    continue
                matching_articles.append(materialized_article)
                preview_articles.append(_article_preview(article))

            distinct_sources = {
                _article_value(article, "source_id")
                or _slugify_source_name(_article_source_name(article))
                for article in matching_articles
            }
            if (
                len(matching_articles) < MIN_CLUSTER_ARTICLES
                or len(distinct_sources) < MIN_CLUSTER_SOURCES
            ):
                continue

            filtered_cluster_articles[cluster_id] = matching_articles
            filtered_cluster_previews[cluster_id] = preview_articles

        available_lenses = _available_lens_payloads()
        semaxis_counts: dict[int, BlindspotCoveragePayload] = {}
        semaxis_unavailable_reason: Optional[str] = None
        if lens == "institutional_populist":
            (
                semaxis_counts,
                semaxis_unavailable_reason,
            ) = await _build_semaxis_counts_by_cluster(filtered_cluster_articles)

        candidates: list[ClusterCardCandidate] = []
        for cluster in cluster_payloads:
            cluster_id = cluster.get("cluster_id")
            if not isinstance(cluster_id, int):
                continue
            cluster_articles = filtered_cluster_articles.get(cluster_id)
            if cluster_articles is None:
                continue

            if lens == "institutional_populist":
                counts = semaxis_counts.get(cluster_id)
                if counts is None:
                    continue
            else:
                counts = _metadata_counts_for_lens(lens, cluster_articles)

            total_sources = counts["pole_a"] + counts["shared"] + counts["pole_b"]
            if total_sources < MIN_CLUSTER_SOURCES:
                continue

            lane = classify_lane(counts)
            shares = _shares_from_counts(counts)
            preview_articles = filtered_cluster_previews.get(cluster_id, [])
            published_candidates: list[str] = []
            for article in cluster_articles:
                published_at = _article_value(article, "published_at")
                if hasattr(published_at, "isoformat"):
                    published_candidates.append(cast(Any, published_at).isoformat())
                elif isinstance(published_at, str) and published_at.strip():
                    published_candidates.append(published_at)
            card_payload: BlindspotCardPayload = {
                "cluster_id": cluster_id,
                "cluster_label": cluster.get("label") or "Topic",
                "keywords": list(cluster.get("keywords", [])),
                "article_count": len(cluster_articles),
                "source_count": total_sources,
                "lane": lane,
                "blindspot_score": _lane_score(lane, counts),
                "balance_score": _balance_score(counts),
                "published_at": max(published_candidates)
                if published_candidates
                else None,
                "explanation": _explanation_for_lane(selected_definition, lane, counts),
                "coverage_counts": counts,
                "coverage_shares": shares,
                "representative_article": _choose_representative_article(
                    preview_articles
                ),
                "articles": preview_articles[:4],
                "geography_signals": _geography_signals_for_articles(matching_articles)
                if lens == "geography"
                else [],
            }
            candidates.append(
                ClusterCardCandidate(
                    payload=card_payload,
                    lane_sort_score=card_payload["blindspot_score"],
                )
            )

        grouped: dict[LaneId, list[ClusterCardCandidate]] = {
            "pole_a": [],
            "shared": [],
            "pole_b": [],
        }
        for candidate in candidates:
            grouped[candidate.payload["lane"]].append(candidate)

        selected_cards: list[BlindspotCardPayload] = []
        for lane in ("pole_a", "shared", "pole_b"):
            ranked = sorted(
                grouped[lane],
                key=lambda candidate: (
                    candidate.lane_sort_score,
                    candidate.payload["article_count"],
                    candidate.payload["published_at"] or "",
                ),
                reverse=True,
            )
            selected_cards.extend(
                candidate.payload for candidate in ranked[: max(1, per_lane)]
            )

        selected_lens_payload: BlindspotLensPayload = {
            "id": selected_definition.id,
            "label": selected_definition.label,
            "description": selected_definition.description,
            "available": not (
                lens == "institutional_populist"
                and semaxis_unavailable_reason is not None
            ),
            "unavailable_reason": semaxis_unavailable_reason,
        }

        for lens_payload in available_lenses:
            if lens_payload["id"] != "institutional_populist":
                continue
            if semaxis_unavailable_reason is None:
                break
            lens_payload["available"] = False
            lens_payload["unavailable_reason"] = semaxis_unavailable_reason

        return {
            "available_lenses": available_lenses,
            "selected_lens": selected_lens_payload,
            "summary": {
                "window": window,
                "total_clusters": total_clusters,
                "eligible_clusters": len(filtered_cluster_articles),
                "generated_at": snapshot.computed_at.isoformat()
                if snapshot.computed_at
                else get_utc_now().isoformat(),
                "category": category,
                "source_filters": sorted(selected_sources),
            },
            "lanes": _lane_payloads(selected_definition, selected_cards),
            "cards": selected_cards,
            "status": "ok",
        }


_blindspot_viewer_service: Optional[BlindspotViewerService] = None


def get_blindspot_viewer_service() -> BlindspotViewerService:
    global _blindspot_viewer_service
    if _blindspot_viewer_service is None:
        _blindspot_viewer_service = BlindspotViewerService()
    return _blindspot_viewer_service
