"""Regression test: embedding batch work must not block the event loop.

`persistence._process_embedding_batch` used to call the synchronous
`vector_store.batch_add_articles` (which performs a synchronous HTTP call to
the embedding service) directly on the event loop. A slow embedding batch
froze the entire API for 120+ seconds and gunicorn killed the worker.

The fix routes the sync vector-store calls through `asyncio.to_thread`,
matching the pattern already used in `services/chroma_sync.py`.
"""

from __future__ import annotations

import asyncio
import time

import pytest

from app.services import persistence


class _SlowVectorStore:
    """Fake vector store whose batch add sleeps synchronously, like the real
    remote embedding model call."""

    def __init__(self, sleep_seconds: float) -> None:
        self.sleep_seconds = sleep_seconds
        self.payloads: list[dict[str, object]] = []

    def batch_add_articles(self, payloads: list[dict[str, object]]) -> int:
        self.payloads = list(payloads)
        time.sleep(self.sleep_seconds)
        return len(payloads)

    def delete_article(self, chroma_id: str) -> bool:
        return True


async def _noop_mark(*_args: object, **_kwargs: object) -> None:
    return None


@pytest.mark.asyncio
async def test_embedding_batch_does_not_block_event_loop(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _SlowVectorStore(sleep_seconds=1.0)
    monkeypatch.setattr(persistence, "get_vector_store", lambda: fake)
    monkeypatch.setattr(persistence, "_mark_embeddings_generated", _noop_mark)

    ticks = 0

    async def probe() -> int:
        nonlocal ticks
        deadline = time.monotonic() + 0.5
        while time.monotonic() < deadline:
            await asyncio.sleep(0)
            ticks += 1
        return ticks

    probe_task = asyncio.create_task(probe())
    batch_task = asyncio.create_task(
        persistence._process_embedding_batch(
            [
                persistence.EmbeddingArticlePayload(
                    article_id=1,
                    chroma_id="article_1",
                    title="Title",
                    summary="Summary",
                    content="Content",
                    metadata={},
                )
            ],
            [],
        )
    )

    await asyncio.wait_for(probe_task, timeout=5.0)
    await batch_task

    assert fake.payloads, "batch add must have been called"
    # A blocked loop would let the probe tick only a handful of times before
    # its deadline passed; the to_thread fix lets it tick thousands.
    assert ticks > 50
