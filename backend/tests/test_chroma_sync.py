from __future__ import annotations

import pytest

from app.services import chroma_sync


class _DummyCollection:
    def __init__(self, count: int):
        self._count = count

    def count(self) -> int:
        return self._count


class _DummyVectorStore:
    def __init__(self, count: int):
        self.collection = _DummyCollection(count)


@pytest.mark.asyncio
async def test_detect_drift_sets_sync_event_when_chroma_already_populated():
    chroma_sync.sync_caught_up.clear()
    chroma_sync._drift_recovery = False

    detected = await chroma_sync._detect_and_fix_chroma_drift(_DummyVectorStore(15_000))

    assert detected is False
    assert chroma_sync._drift_recovery is False
    assert chroma_sync.sync_caught_up.is_set()

    chroma_sync.sync_caught_up.clear()


@pytest.mark.asyncio
async def test_detect_drift_enters_recovery_when_chroma_too_small():
    chroma_sync.sync_caught_up.clear()
    chroma_sync._drift_recovery = False

    detected = await chroma_sync._detect_and_fix_chroma_drift(_DummyVectorStore(100))

    assert detected is True
    assert chroma_sync._drift_recovery is True
    assert chroma_sync.sync_caught_up.is_set()

    chroma_sync._drift_recovery = False
    chroma_sync.sync_caught_up.clear()
