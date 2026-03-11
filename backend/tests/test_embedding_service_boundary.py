from __future__ import annotations

from unittest.mock import MagicMock

import numpy as np
from fastapi.testclient import TestClient

from app.embedding_client import EmbeddingServiceClient, RemoteEmbeddingModel
from app.embedding_service import app, health


class _DummyResponse:
    def __init__(self, payload: dict[str, object]) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, object]:
        return self._payload


class _DummyHttpClient:
    def __init__(self, *args: object, **kwargs: object) -> None:
        self.request_json: dict[str, object] | None = None

    def __enter__(self) -> _DummyHttpClient:
        return self

    def __exit__(self, exc_type: object, exc: object, tb: object) -> None:
        return None

    def post(self, path: str, json: dict[str, object]) -> _DummyResponse:
        assert path == "/embed"
        self.request_json = json
        return _DummyResponse({"embeddings": [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]})


def test_remote_embedding_model_encodes_batches_without_local_model(
    monkeypatch,
) -> None:
    dummy_client = _DummyHttpClient()
    monkeypatch.setattr(
        "app.embedding_client.httpx.Client",
        lambda *args, **kwargs: dummy_client,
    )

    model = RemoteEmbeddingModel(
        EmbeddingServiceClient("http://embedding-service", timeout_seconds=5)
    )

    encoded = model.encode(["alpha", "beta"], batch_size=8)

    assert isinstance(encoded, np.ndarray)
    assert encoded.shape == (2, 3)
    assert dummy_client.request_json == {
        "texts": ["alpha", "beta"],
        "batch_size": 8,
    }


def test_remote_embedding_model_wraps_single_string(monkeypatch) -> None:
    dummy_client = _DummyHttpClient()
    monkeypatch.setattr(
        "app.embedding_client.httpx.Client",
        lambda *args, **kwargs: dummy_client,
    )

    model = RemoteEmbeddingModel(
        EmbeddingServiceClient("http://embedding-service", timeout_seconds=5)
    )

    encoded = model.encode("alpha", batch_size=4)

    assert isinstance(encoded, np.ndarray)
    assert encoded.shape == (3,)
    assert dummy_client.request_json == {
        "texts": ["alpha"],
        "batch_size": 4,
    }


def test_embedding_service_health_reports_lazy_load_state(monkeypatch) -> None:
    monkeypatch.setattr("app.embedding_service._embedding_model", None)
    assert health()["loaded"] is False


def test_embedding_service_embed_loads_single_model_instance(monkeypatch) -> None:
    fake_model = MagicMock()
    fake_model.encode.return_value = np.array([[1.0, 2.0], [3.0, 4.0]])
    load_count = 0

    def _fake_get_embedding_model() -> MagicMock:
        nonlocal load_count
        load_count += 1
        return fake_model

    monkeypatch.setattr(
        "app.embedding_service._get_embedding_model", _fake_get_embedding_model
    )

    client = TestClient(app)
    response = client.post(
        "/embed",
        json={"texts": ["first", "second"], "batch_size": 4},
    )

    assert response.status_code == 200
    assert response.json()["embeddings"] == [[1.0, 2.0], [3.0, 4.0]]
    assert response.json()["count"] == 2
    assert response.json()["dimension"] == 2
    assert load_count == 1
