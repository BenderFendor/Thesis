from __future__ import annotations

import logging
from typing import Any

from app.vector_store import VectorStore


class _EmbeddingModel:
    def encode(self, *_args: Any, **_kwargs: Any) -> list[_EmbeddingRow]:
        return [_EmbeddingRow([0.1, 0.2])]


class _EmbeddingRow(list[float]):
    def tolist(self) -> list[float]:
        return list(self)


class _FailingCollection:
    def upsert(self, **_kwargs: Any) -> None:
        raise RuntimeError("raw-response:" + ("x" * 10_000))


def test_vector_batch_failure_log_is_bounded(caplog) -> None:
    store = object.__new__(VectorStore)
    store._embedding_model = _EmbeddingModel()
    store.collection = _FailingCollection()
    payload = {
        "chroma_id": "article-1",
        "title": "Title",
        "summary": "Summary",
        "content": "Content",
        "metadata": {},
    }

    with caplog.at_level(logging.INFO, logger="app.vector_store"):
        result = store.batch_add_articles([payload])

    messages = [record.getMessage() for record in caplog.records]
    assert result == 0
    assert "Vector batch add failed: 1 articles (RuntimeError)" in messages
    detail = next(
        message for message in messages if message.startswith("Vector batch failure detail")
    )
    assert len(detail) < 4_100
    assert "x" * 5_000 not in detail
