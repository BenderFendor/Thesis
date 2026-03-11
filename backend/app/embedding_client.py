from __future__ import annotations

from collections.abc import Sequence
from typing import TYPE_CHECKING, Any, cast

import httpx

from app.core.config import settings

if TYPE_CHECKING:
    from numpy.typing import NDArray


class EmbeddingServiceClient:
    def __init__(self, base_url: str, timeout_seconds: float) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout_seconds = timeout_seconds

    def embed(self, texts: Sequence[str], batch_size: int) -> list[list[float]]:
        payload = {
            "texts": list(texts),
            "batch_size": batch_size,
        }

        with httpx.Client(
            base_url=self._base_url, timeout=self._timeout_seconds
        ) as client:
            response = client.post("/embed", json=payload)
            response.raise_for_status()
            data = response.json()

        embeddings = data.get("embeddings")
        if not isinstance(embeddings, list):
            raise RuntimeError("Embedding service returned an invalid payload")
        return cast(list[list[float]], embeddings)

    def health(self) -> dict[str, object]:
        with httpx.Client(
            base_url=self._base_url, timeout=self._timeout_seconds
        ) as client:
            response = client.get("/health")
            response.raise_for_status()
            data = response.json()
        return cast(dict[str, object], data)


class RemoteEmbeddingModel:
    def __init__(self, client: EmbeddingServiceClient) -> None:
        self._client = client

    def encode(
        self,
        sentences: str | list[str],
        *,
        batch_size: int = 32,
        show_progress_bar: bool | None = None,
        convert_to_numpy: bool = False,
        **kwargs: object,
    ) -> "NDArray[Any]":
        del show_progress_bar, convert_to_numpy, kwargs

        import numpy as np

        single_input = isinstance(sentences, str)
        texts: list[str]
        if single_input:
            texts = [cast(str, sentences)]
        else:
            texts = list(sentences)
        if not texts:
            return np.array([], dtype=float)

        embeddings = self._client.embed(texts, batch_size=batch_size)
        encoded = np.array(embeddings, dtype=float)
        if single_input:
            return cast("NDArray[Any]", encoded[0])
        return encoded


def create_remote_embedding_model() -> RemoteEmbeddingModel:
    client = EmbeddingServiceClient(
        base_url=settings.embedding_service_url,
        timeout_seconds=settings.embedding_service_timeout_seconds,
    )
    return RemoteEmbeddingModel(client)
