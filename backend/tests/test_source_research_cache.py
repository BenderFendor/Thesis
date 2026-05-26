"""Regression tests for source research cache behavior."""

from __future__ import annotations

import json


def test_source_profile_cache_rejects_old_schema_version(tmp_path, monkeypatch) -> None:
    from app.services import source_research

    monkeypatch.setattr(source_research, "CACHE_DIR", tmp_path)
    cache_path = source_research._cache_path("Example Source")
    cache_path.write_text(
        json.dumps(
            {
                "name": "Example Source",
                "website": "https://example.com",
                "dossier_sections": [],
            }
        ),
        encoding="utf-8",
    )

    assert source_research._load_cached_profile("Example Source") is None


def test_source_profile_cache_roundtrip_sets_current_schema_version(tmp_path, monkeypatch) -> None:
    from app.services import source_research

    monkeypatch.setattr(source_research, "CACHE_DIR", tmp_path)
    payload = {
        "name": "Example Source",
        "website": "https://example.com",
        "dossier_sections": [],
        "policy_transparency": {
            "checked_pages": 1,
            "available_signals": 1,
            "signals": [],
        },
        "ads_txt": {
            "url": "https://example.com/ads.txt",
            "authorized_sellers": 1,
            "direct_sellers": 1,
            "resellers": 0,
            "duplicate_records": 0,
            "invalid_lines": 0,
            "owner_domains": ["example.com"],
            "manager_domains": [],
            "contact": [],
        },
        "sellers_json": {
            "checked_ad_systems": 1,
            "available_sellers_json": 1,
            "checked_records": 1,
            "matched_records": 1,
            "missing_seller_ids": 0,
            "owner_domain_matches": 1,
            "manager_domain_matches": 0,
            "systems": [],
        },
    }

    source_research._save_cached_profile("Example Source", payload)
    cached = source_research._load_cached_profile("Example Source")

    assert cached is not None
    assert cached["cache_schema_version"] == source_research.SOURCE_PROFILE_CACHE_SCHEMA_VERSION
    assert cached["policy_transparency"]["available_signals"] == 1
    assert cached["ads_txt"]["url"] == "https://example.com/ads.txt"
    assert cached["sellers_json"]["matched_records"] == 1
