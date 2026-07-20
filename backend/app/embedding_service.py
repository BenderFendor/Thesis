"""Dedicated embedding service with lightweight resource evidence."""

from __future__ import annotations

import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from importlib import import_module
from threading import Lock
from typing import TYPE_CHECKING, cast

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.logging import configure_logging, get_logger
from app.core.process_limits import (
    get_nofile_limits,
    get_open_file_descriptor_count,
    raise_nofile_soft_limit,
)
from app.services.resource_monitor import ResourceMonitor

if TYPE_CHECKING:
    from sentence_transformers import SentenceTransformer


configure_logging()
logger = get_logger("embedding_service")

_model_lock = Lock()
_embedding_model: SentenceTransformer | None = None
resource_monitor = ResourceMonitor(service_name="embedding-worker")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Start resource sampling before model load and stop it on shutdown."""
    raise_nofile_soft_limit(logger)
    soft_nofile, hard_nofile = get_nofile_limits()
    logger.info(
        "Embedding service startup: open_fds=%s soft_nofile=%s hard_nofile=%s",
        get_open_file_descriptor_count(),
        soft_nofile,
        hard_nofile,
    )
    resource_monitor.start()
    load_started = time.perf_counter()
    try:
        _get_embedding_model()
        resource_monitor.record_operation(
            "model_load",
            duration_ms=(time.perf_counter() - load_started) * 1000,
            details={"model": settings.embedding_model_name},
        )
        yield
    finally:
        resource_monitor.stop()


app = FastAPI(
    title="Embedding Service",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)


class EmbedRequest(BaseModel):
    """Embedding request."""

    texts: list[str] = Field(default_factory=list)
    batch_size: int = Field(default=32, ge=1, le=256)


class EmbedResponse(BaseModel):
    """Embedding response."""

    embeddings: list[list[float]]
    model: str
    count: int
    dimension: int


def _get_sentence_transformer_class() -> type[SentenceTransformer]:
    try:
        transformer_module = import_module("sentence_transformers")
    except ImportError as exc:  # pragma: no cover - optional at import time
        raise RuntimeError(
            "sentence-transformers is not installed; cannot generate embeddings."
        ) from exc
    return cast(type["SentenceTransformer"], transformer_module.SentenceTransformer)


def _get_embedding_model() -> SentenceTransformer:
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
    """Return model and resource-monitor health."""
    return {
        "ok": True,
        "model": settings.embedding_model_name,
        "loaded": _embedding_model is not None,
        "resource_monitor_running": resource_monitor.running,
    }


@app.get("/debug/resources")
def resources() -> dict[str, object]:
    """Return a current resource snapshot for direct worker diagnosis."""
    return resource_monitor.collect_snapshot()


@app.post("/embed", response_model=EmbedResponse)
def embed(request: EmbedRequest) -> EmbedResponse:
    """Generate embeddings and record batch-level evidence."""
    if not request.texts:
        raise HTTPException(status_code=400, detail="texts must not be empty")

    started = time.perf_counter()
    try:
        model = _get_embedding_model()
        embeddings_array = model.encode(
            request.texts,
            batch_size=request.batch_size,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        embeddings = cast(list[list[float]], embeddings_array.tolist())
        dimension = len(embeddings[0]) if embeddings else 0
        response = EmbedResponse(
            embeddings=embeddings,
            model=settings.embedding_model_name,
            count=len(embeddings),
            dimension=dimension,
        )
        resource_monitor.record_operation(
            "embedding_batch",
            duration_ms=(time.perf_counter() - started) * 1000,
            details={
                "input_count": len(request.texts),
                "batch_size": request.batch_size,
                "output_count": response.count,
                "dimension": response.dimension,
                "input_characters": sum(len(text) for text in request.texts),
            },
        )
        return response
    except Exception:
        resource_monitor.record_operation(
            "embedding_batch",
            duration_ms=(time.perf_counter() - started) * 1000,
            result="error",
            details={
                "input_count": len(request.texts),
                "batch_size": request.batch_size,
                "input_characters": sum(len(text) for text in request.texts),
            },
        )
        raise
