from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services import chroma_sync


class _Collection:
    def __init__(self, ids: list[str]) -> None:
        self.ids = ids

    def get(self, ids: list[str], *, include: list[str]) -> dict[str, list[str]]:
        assert include == []
        return {"ids": [item for item in ids if item in self.ids]}


class _VectorStore:
    def __init__(self, existing_ids: list[str], added: int = 0) -> None:
        self.collection = _Collection(existing_ids)
        self.added = added
        self.payloads: list[dict[str, object]] = []

    def batch_add_articles(self, payloads: list[dict[str, object]]) -> int:
        self.payloads = payloads
        return self.added


def _article(article_id: int) -> SimpleNamespace:
    return SimpleNamespace(
        id=article_id,
        title=f"Article {article_id}",
        summary="Summary",
        content="Body",
        source_id="source-1",
    )


@pytest.mark.asyncio
async def test_recovery_membership_and_missing_articles_preserve_batch_semantics() -> None:
    articles = [_article(1), _article(2), _article(3)]
    vector_store = _VectorStore(["article_1", "article_3"])

    existing = await chroma_sync._existing_recovery_ids(vector_store, articles)
    missing = chroma_sync._missing_recovery_articles(articles, existing or set())

    assert existing == {"article_1", "article_3"}
    assert [article.id for article in missing] == [2]


@pytest.mark.asyncio
async def test_embed_recovery_articles_marks_all_missing_and_unblocks_sync(monkeypatch) -> None:
    articles = [_article(4), _article(5)]
    vector_store = _VectorStore([], added=2)
    mark = AsyncMock()
    monkeypatch.setattr(chroma_sync, "_mark_recovery_articles", mark)
    chroma_sync.sync_caught_up.clear()

    added = await chroma_sync._embed_recovery_articles(vector_store, articles, offset=200)

    assert added == 2
    assert [payload["chroma_id"] for payload in vector_store.payloads] == [
        "article_4",
        "article_5",
    ]
    mark.assert_awaited_once_with([4, 5])
    assert chroma_sync.sync_caught_up.is_set()
