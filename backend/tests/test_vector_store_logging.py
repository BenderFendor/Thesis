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


class _RecordingCollection:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def upsert(self, **kwargs: Any) -> None:
        # Mimic Chroma's real behavior: reject a batch whose `ids` list
        # contains a duplicate value.
        ids = kwargs["ids"]
        if len(ids) != len(set(ids)):
            raise ValueError(f"Expected IDs to be unique, got duplicates: {ids}")
        self.calls.append(kwargs)


def test_batch_add_articles_dedupes_repeated_chroma_id() -> None:
    store = object.__new__(VectorStore)
    store._embedding_model = _EmbeddingModel()
    collection = _RecordingCollection()
    store.collection = collection

    def _payload(title: str) -> dict[str, Any]:
        return {
            "chroma_id": "article-1",
            "title": title,
            "summary": "Summary",
            "content": "Content",
            "metadata": {},
        }

    # Same chroma_id appearing twice in one flush (e.g. overlapping RSS
    # feeds surfacing the same article) must not raise DuplicateIDError, and
    # only the last payload should be stored.
    result = store.batch_add_articles([_payload("First"), _payload("Second")])

    assert result == 1
    assert len(collection.calls) == 1
    call = collection.calls[0]
    assert call["ids"] == ["article-1"]
    assert call["metadatas"][0]["title"] == "Second"


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
