import math

from app.services.gdelt_aggregates import build_article_gdelt_context
from app.services.gdelt_taxonomy import (
    cameo_root_label,
    dominant_cameo_roots,
    goldstein_bucket,
    normalize_cameo_root_code,
)


def test_normalize_cameo_root_code_and_label_table() -> None:
    assert normalize_cameo_root_code("CAMEO 14.1") == "14"
    assert normalize_cameo_root_code("3") == "03"
    assert normalize_cameo_root_code("١٤") is None
    assert normalize_cameo_root_code("") is None
    assert normalize_cameo_root_code(None) is None
    assert cameo_root_label("01") == "Public statement"
    assert cameo_root_label("20") == "Use unconventional violence"
    assert cameo_root_label("99") is None


def test_goldstein_bucket_preserves_cutoffs_and_nan_behavior() -> None:
    assert goldstein_bucket(-4.0) == "conflict"
    assert goldstein_bucket(math.nextafter(-4.0, math.inf)) == "mixed"
    assert goldstein_bucket(0.0) == "mixed"
    assert goldstein_bucket(math.nextafter(4.0, -math.inf)) == "mixed"
    assert goldstein_bucket(4.0) == "cooperation"
    assert goldstein_bucket(float("nan")) == "mixed"
    assert goldstein_bucket(None) is None


def test_dominant_roots_keep_first_seen_order_for_ties() -> None:
    roots = dominant_cameo_roots(["14", "03", "14.2", None, "05", "03"], 3)

    assert roots == [
        {"code": "14", "label": "Protest", "count": 2},
        {"code": "03", "label": "Intent to cooperate", "count": 2},
        {"code": "05", "label": "Diplomatic engagement", "count": 1},
    ]
    assert dominant_cameo_roots(["14", "03"], -1) == []


def test_gdelt_context_uses_rust_taxonomy_results() -> None:
    context = build_article_gdelt_context(
        [
            {"event_root_code": "14.2", "goldstein_scale": 4.0, "tone": 1.0},
            {"event_root_code": "03", "goldstein_scale": -4.0, "tone": -1.0},
        ]
    )

    assert context is not None
    assert context["goldstein_bucket"] == "mixed"
    assert context["top_cameo"] == [
        {"code": "14", "label": "Protest", "count": 1},
        {"code": "03", "label": "Intent to cooperate", "count": 1},
    ]
