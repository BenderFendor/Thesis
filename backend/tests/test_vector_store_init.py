from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from app.vector_store import VectorStore


class _DummyStartupMetrics:
    def record_event(self, *args, **kwargs):
        return None

    def add_note(self, *args, **kwargs) -> None:
        return None


def test_vector_store_initializes_cosine_collection(monkeypatch) -> None:
    mock_collection = MagicMock()
    mock_collection.count.return_value = 0
    mock_collection.name = "news_articles"

    mock_client = MagicMock()
    mock_client.heartbeat.return_value = 1
    mock_client.get_collection.side_effect = RuntimeError("missing")
    mock_client.get_or_create_collection.return_value = mock_collection

    monkeypatch.setattr("app.vector_store._create_chroma_client", lambda: mock_client)
    monkeypatch.setattr(
        "app.vector_store._get_startup_metrics", lambda: _DummyStartupMetrics()
    )

    store = VectorStore()

    assert store.collection is mock_collection
    mock_client.get_or_create_collection.assert_called_once_with(
        name="news_articles",
        metadata={"hnsw:space": "cosine"},
    )


def test_vector_store_raises_when_cosine_collection_cannot_be_created(
    monkeypatch,
) -> None:
    mock_client = MagicMock()
    mock_client.heartbeat.return_value = 1
    mock_client.get_collection.side_effect = RuntimeError("missing")
    mock_client.get_or_create_collection.side_effect = RuntimeError("bad metric")

    monkeypatch.setattr("app.vector_store._create_chroma_client", lambda: mock_client)
    monkeypatch.setattr(
        "app.vector_store._get_startup_metrics", lambda: _DummyStartupMetrics()
    )

    with pytest.raises(RuntimeError, match="cosine distance"):
        VectorStore()
