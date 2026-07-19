import json
from pathlib import Path

from fastapi import HTTPException

from app.api.routes import sources


def test_validate_rss_source_reports_duplicates(monkeypatch) -> None:
    monkeypatch.setattr(
        sources,
        "parse_feeds_parallel",
        lambda _feeds, _workers: {
            "articles": [
                {
                    "title": "Valid item",
                    "url": "https://example.com/article",
                    "source": "Example",
                }
            ],
            "source_stats": {"Example": {"status": "ok", "article_count": 1}},
        },
    )
    monkeypatch.setattr(
        sources,
        "get_rss_sources",
        lambda: {"Existing": {"url": "https://example.com/rss"}},
    )

    result = sources._validate_rss_feed("https://example.com/feed")

    assert result["success"] is True
    assert result["name"] == "Example"
    assert result["duplicate_candidates"] == [
        {"name": "Existing", "url": "https://example.com/rss"}
    ]


def test_promote_rss_source_writes_reviewed_metadata(monkeypatch, tmp_path: Path) -> None:
    data_path = tmp_path / "rss_sources.json"
    data_path.write_text(json.dumps({}), encoding="utf-8")
    reload_called = False

    def fake_reload() -> None:
        nonlocal reload_called
        reload_called = True

    monkeypatch.setattr(sources, "_DATA_PATH", data_path)
    monkeypatch.setattr(sources, "reload_rss_sources", fake_reload)
    monkeypatch.setattr(sources, "get_rss_sources", lambda: {})
    monkeypatch.setattr(
        sources,
        "parse_feeds_parallel",
        lambda _feeds, _workers: {
            "articles": [{"title": "Valid item", "url": "https://wire.example/a"}],
            "source_stats": {"Wire": {"status": "ok", "article_count": 1}},
        },
    )

    result = sources._promote_rss_source(
        sources.PromoteRssRequest(
            url="https://wire.example/rss",
            name="Reviewed Wire",
            source_type="wire",
            country="GB",
            is_paywalled=True,
        )
    )

    saved = json.loads(data_path.read_text(encoding="utf-8"))
    assert result["promoted"] is True
    assert reload_called is True
    assert saved["Reviewed Wire"]["source_type"] == "wire"
    assert saved["Reviewed Wire"]["country"] == "GB"
    assert saved["Reviewed Wire"]["is_paywalled"] is True


def test_normalize_source_url_rejects_non_http() -> None:
    try:
        sources._normalize_source_url("ftp://example.com/feed")
    except HTTPException as exc:
        assert exc.status_code == 400
    else:
        raise AssertionError("Expected HTTPException")
