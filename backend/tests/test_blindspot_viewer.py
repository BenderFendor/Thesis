from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

from hypothesis import assume, given, strategies as st
import numpy as np
import pytest

from app.services.blindspot_viewer import (
    _load_embeddings_for_articles,
    _metadata_counts_for_lens,
    _geography_signals_for_articles,
    _select_preview_articles,
    _shares_from_counts,
    _source_catalog_lookup,
    classify_lane,
)


@given(
    st.integers(min_value=0, max_value=20),
    st.integers(min_value=0, max_value=20),
    st.integers(min_value=0, max_value=20),
)
def test_coverage_shares_stay_bounded(
    pole_a: int,
    shared: int,
    pole_b: int,
) -> None:
    assume(pole_a + shared + pole_b > 0)

    shares = _shares_from_counts({"pole_a": pole_a, "shared": shared, "pole_b": pole_b})

    assert all(0.0 <= value <= 1.0 for value in shares.values())
    assert math.isclose(sum(shares.values()), 1.0, abs_tol=1e-3)


@given(
    st.integers(min_value=2, max_value=20),
    st.integers(min_value=0, max_value=20),
)
def test_balanced_poles_remain_shared(pole_count: int, shared_count: int) -> None:
    lane = classify_lane(
        {
            "pole_a": pole_count,
            "shared": shared_count,
            "pole_b": pole_count,
        }
    )

    assert lane == "shared"


@given(
    st.integers(min_value=2, max_value=20),
    st.integers(min_value=0, max_value=3),
)
def test_opposite_dominance_marks_pole_a_blindspot(
    pole_b_count: int,
    shared_count: int,
) -> None:
    counts = {"pole_a": 0, "shared": shared_count, "pole_b": pole_b_count}
    shares = _shares_from_counts(counts)
    assume(shares["pole_b"] - shares["pole_a"] >= 0.35)

    assert classify_lane(counts) == "pole_a"


@given(
    st.integers(min_value=2, max_value=20),
    st.integers(min_value=0, max_value=3),
)
def test_opposite_dominance_marks_pole_b_blindspot(
    pole_a_count: int,
    shared_count: int,
) -> None:
    counts = {"pole_a": pole_a_count, "shared": shared_count, "pole_b": 0}
    shares = _shares_from_counts(counts)
    assume(shares["pole_a"] - shares["pole_b"] >= 0.35)

    assert classify_lane(counts) == "pole_b"


@dataclass
class _FakeArticle:
    id: int
    title: str
    summary: str


@dataclass
class _FakeMetadataArticle:
    source: str
    source_id: Optional[str] = None
    bias: Optional[str] = None
    credibility: Optional[str] = None
    country: Optional[str] = None


class _FailingCollection:
    def get(self, **kwargs: object) -> object:
        raise RuntimeError("chroma get failed")


class _FakeEmbeddingModel:
    def encode(self, sentences, **kwargs: object) -> np.ndarray:
        values = list(sentences)
        return np.array([[float(index + 1), 9.0] for index, _ in enumerate(values)])


class _FakeVectorStore:
    collection = _FailingCollection()
    embedding_model = _FakeEmbeddingModel()


@pytest.mark.asyncio
async def test_load_embeddings_falls_back_when_chroma_get_fails(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.blindspot_viewer.get_vector_store",
        lambda: _FakeVectorStore(),
    )

    embeddings = await _load_embeddings_for_articles(
        {
            1: _FakeArticle(id=1, title="alpha", summary="beta"),
            2: _FakeArticle(id=2, title="gamma", summary="delta"),
        }
    )

    assert embeddings == {1: [1.0, 9.0], 2: [2.0, 9.0]}


def test_bias_counts_use_source_catalog_fallback(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.blindspot_viewer.get_rss_sources",
        lambda: {
            "Outlet A": {"bias_rating": "Left-Center"},
            "Outlet B": {"bias_rating": "Center"},
            "Outlet C": {"bias_rating": "Right-Center"},
        },
    )
    _source_catalog_lookup.cache_clear()

    counts = _metadata_counts_for_lens(
        "bias",
        [
            _FakeMetadataArticle(source="Outlet A"),
            _FakeMetadataArticle(source="Outlet B"),
            _FakeMetadataArticle(source="Outlet C"),
        ],
    )

    assert counts == {"pole_a": 1, "shared": 1, "pole_b": 1}
    _source_catalog_lookup.cache_clear()


def test_credibility_counts_use_source_catalog_fallback(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.blindspot_viewer.get_rss_sources",
        lambda: {
            "Outlet A": {"factual_reporting": "high"},
            "Outlet B": {"factual_reporting": "unknown"},
            "Outlet C": {"factual_reporting": "very-low"},
        },
    )
    _source_catalog_lookup.cache_clear()

    counts = _metadata_counts_for_lens(
        "credibility",
        [
            _FakeMetadataArticle(source="Outlet A"),
            _FakeMetadataArticle(source="Outlet B"),
            _FakeMetadataArticle(source="Outlet C"),
        ],
    )

    assert counts == {"pole_a": 1, "shared": 1, "pole_b": 1}
    _source_catalog_lookup.cache_clear()


def test_geography_counts_use_global_north_global_south_fallback(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.blindspot_viewer.get_rss_sources",
        lambda: {
            "Outlet A": {"country": "US"},
            "Outlet B": {"country": "BR"},
        },
    )
    _source_catalog_lookup.cache_clear()

    counts = _metadata_counts_for_lens(
        "geography",
        [
            _FakeMetadataArticle(source="Outlet A"),
            _FakeMetadataArticle(source="Outlet B"),
        ],
    )

    assert counts == {"pole_a": 1, "shared": 0, "pole_b": 1}
    _source_catalog_lookup.cache_clear()


def test_geography_counts_consume_snapshot_geo_and_baseline_fields() -> None:
    articles = [
        {
            "source": "Outlet A",
            "geo": {"source_country": "US"},
        },
        {
            "source": "Outlet B",
            "baseline": {"country": "BR"},
        },
        {
            "source": "Outlet C",
            "country": "CA",
        },
    ]

    counts = _metadata_counts_for_lens("geography", articles)
    signals = _geography_signals_for_articles(articles)

    assert counts == {"pole_a": 2, "shared": 0, "pole_b": 1}
    assert signals == [
        {"id": "source_country", "label": "Source country", "count": 1},
        {"id": "baseline_country", "label": "Baseline country", "count": 1},
        {"id": "country", "label": "Article country", "count": 1},
    ]


def test_select_preview_articles_prefers_source_diversity() -> None:
    articles = [
        {
            "id": 1,
            "title": "A1",
            "source": "Outlet A",
            "source_id": "outlet-a",
            "url": "https://example.com/a1",
            "similarity": 1.0,
        },
        {
            "id": 2,
            "title": "A2",
            "source": "Outlet A",
            "source_id": "outlet-a",
            "url": "https://example.com/a2",
            "similarity": 0.9,
        },
        {
            "id": 3,
            "title": "B1",
            "source": "Outlet B",
            "source_id": "outlet-b",
            "url": "https://example.com/b1",
            "similarity": 0.8,
        },
        {
            "id": 4,
            "title": "C1",
            "source": "Outlet C",
            "source_id": "outlet-c",
            "url": "https://example.com/c1",
            "similarity": 0.7,
        },
    ]

    selected = _select_preview_articles(articles, limit=3)

    assert [article["id"] for article in selected] == [1, 3, 4]
