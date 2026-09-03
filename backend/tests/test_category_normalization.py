"""Tests for category-parameter normalization."""

from __future__ import annotations

from app.core.filters import normalize_category


def test_normalize_category_drops_all_sentinel() -> None:
    assert normalize_category("all") is None
    assert normalize_category("All") is None
    assert normalize_category(" ALL ") is None


def test_normalize_category_preserves_real_categories() -> None:
    assert normalize_category("general") == "general"
    assert normalize_category("Politics") == "Politics"


def test_normalize_category_handles_none_and_empty() -> None:
    assert normalize_category(None) is None
    assert normalize_category("") is None
