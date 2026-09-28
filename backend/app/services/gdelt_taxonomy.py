"""Shared helpers for GDELT labels and compact UI summaries."""

from __future__ import annotations

from collections.abc import Iterable

from app.services.rss_parser_rust_bindings import (
    cameo_root_label_rust,
    dominant_cameo_roots_rust,
    goldstein_bucket_rust,
    normalize_cameo_root_code_rust,
)


def normalize_cameo_root_code(code: str | None) -> str | None:
    """Normalize a GDELT CAMEO root code."""
    return normalize_cameo_root_code_rust(code)


def cameo_root_label(code: str | None) -> str | None:
    """Return the human-readable label for a known CAMEO root code."""
    return cameo_root_label_rust(code)


def goldstein_bucket(value: float | None) -> str | None:
    """Classify a Goldstein scale value using the established cutoffs."""
    return goldstein_bucket_rust(value)


def dominant_cameo_roots(codes: Iterable[str | None], limit: int = 3) -> list[dict[str, object]]:
    """Return the most frequent normalized CAMEO roots."""
    roots = dominant_cameo_roots_rust(list(codes), limit)
    return [{"code": code, "label": label, "count": count} for code, label, count in roots]
