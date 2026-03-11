from __future__ import annotations

from importlib import import_module
from threading import Lock
from typing import TYPE_CHECKING, cast

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.logging import configure_logging, get_logger

if TYPE_CHECKING:
    from sentence_transformers import SentenceTransformer


configure_logging()
logger = get_logger("embedding_service")

app = FastAPI(
    title="Embedding Service",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

_model_lock = Lock()
_embedding_model: "SentenceTransformer | None" = None


class EmbedRequest(BaseModel):
    texts: list[str] = Field(default_factory=list)
    batch_size: int = Field(default=32, ge=1, le=256)


class EmbedResponse(BaseModel):
    embeddings: list[list[float]]
    model: str
    count: int
    dimension: int


def _get_sentence_transformer_class() -> type["SentenceTransformer"]:
    try:
        transformer_module = import_module("sentence_transformers")
    except ImportError as exc:  # pragma: no cover - optional at import time
        raise RuntimeError(
            "sentence-transformers is not installed; cannot generate embeddings."
        ) from exc
    return cast(
        type["SentenceTransformer"], getattr(transformer_module, "SentenceTransformer")
    )


def _get_embedding_model() -> "SentenceTransformer":
    global _embedding_model

    if _embedding_model is not None:
        return _embedding_model

    with _model_lock:
        if _embedding_model is None:
            sentence_transformer = _get_sentence_transformer_class()
            logger.info(
                "Loading embedding model in dedicated service: %s",
                settings.embedding_model_name,
            )
            _embedding_model = sentence_transformer(settings.embedding_model_name)

    assert _embedding_model is not None
    return _embedding_model


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "ok": True,
        "model": settings.embedding_model_name,
        "loaded": _embedding_model is not None,
    }


@app.post("/embed", response_model=EmbedResponse)
def embed(request: EmbedRequest) -> EmbedResponse:
    if not request.texts:
        raise HTTPException(status_code=400, detail="texts must not be empty")

    model = _get_embedding_model()
    embeddings_array = model.encode(
        request.texts,
        batch_size=request.batch_size,
        convert_to_numpy=True,
        show_progress_bar=False,
    )
    embeddings = cast(list[list[float]], embeddings_array.tolist())
    dimension = len(embeddings[0]) if embeddings else 0
    return EmbedResponse(
        embeddings=embeddings,
        model=settings.embedding_model_name,
        count=len(embeddings),
        dimension=dimension,
    )
