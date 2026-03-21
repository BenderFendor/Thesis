from __future__ import annotations

import math
from dataclasses import dataclass

from hypothesis import assume, given, strategies as st
import numpy as np
import pytest

from app.services.blindspot_viewer import (
    _load_embeddings_for_articles,
    _shares_from_counts,
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
