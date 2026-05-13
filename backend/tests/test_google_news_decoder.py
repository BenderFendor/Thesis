from __future__ import annotations

import json
from typing import Any

from scripts import google_news_decoder


class _FakeResponse:
    def __init__(self, body: str) -> None:
        self._body = body.encode("utf-8")

    def __enter__(self) -> _FakeResponse:
        return self

    def __exit__(self, *_args: Any) -> None:
        return None

    def read(self) -> bytes:
        return self._body


def test_decode_google_news_url_uses_publisher_response(monkeypatch) -> None:
    html = '<div data-n-a-sg="sig" data-n-a-ts="1778618318"></div>'
    decoded_rows = [
        [
            "wrb.fr",
            "Fbv4je",
            json.dumps(["garturlres", "https://example.com/story", 1]),
            None,
            None,
            None,
            "generic",
        ]
    ]
    batched_response = ")]}'\n\n" + json.dumps(decoded_rows)

    def fake_urlopen(request: Any, timeout: int = 0) -> _FakeResponse:
        url = request.full_url if hasattr(request, "full_url") else str(request)
        if "/articles/" in url:
            return _FakeResponse(html)
        if "batchexecute" in url:
            return _FakeResponse(batched_response)
        raise AssertionError(url)

    monkeypatch.setattr(google_news_decoder.urllib.request, "urlopen", fake_urlopen)

    assert (
        google_news_decoder.decode_google_news_url(
            "https://news.google.com/rss/articles/article123?oc=5"
        )
        == "https://example.com/story"
    )
